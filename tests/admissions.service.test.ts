import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DB } from '../src/main/db/db'
import { runMigrations } from '../src/main/db/migrate'
import { setCurrentUser } from '../src/main/services/session'
import { AdmissionsService } from '../src/main/services/admissions.service'
import { AdmissionDocumentService } from '../src/main/services/admission-document.service'

function wrapDatabase(raw: BetterSqlite3.Database): DB {
  return {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => {
      const statement = raw.prepare(sql)
      return {
        get: (...params) => statement.get(...params) as Record<string, unknown> | undefined,
        all: (...params) => statement.all(...params) as Record<string, unknown>[],
        run: (...params) => {
          const result = statement.run(...params)
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        }
      }
    },
    pragma: (clause) => { raw.pragma(clause) },
    transaction: (operation) => raw.transaction(operation) as () => ReturnType<typeof operation>,
    close: () => raw.close()
  }
}

describe('AdmissionsService', () => {
  let raw: BetterSqlite3.Database
  let db: DB
  let service: AdmissionsService
  let userId: number
  let classId: number
  let admissionId: number
  let documentRoot: string

  beforeEach(() => {
    process.env.MIGRATIONS_DIR = `${process.cwd()}\\migrations`
    raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    db = wrapDatabase(raw)
    runMigrations(db)
    documentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'admission-documents-'))
    userId = Number(raw.prepare(
      "INSERT INTO users (name, username, password_hash, role) VALUES ('Admin', 'admin', 'hash', 'ADMIN')"
    ).run().lastInsertRowid)
    setCurrentUser({ id: userId, name: 'Admin', username: 'admin', role: 'ADMIN' })
    service = new AdmissionsService(db)
    classId = service.createClass({
      className: '9th', academicYear: '2026-2027',
      admissionFee: 5000
    }, userId)
    const admission = service.createStudent({
      fullName: 'Test Student', fatherName: 'Test Father', classId,
      admissionDate: '2026-10-01', admissionFee: 5000, admissionDiscount: 500,
      admissionFeeDueDate: '2026-10-15'
    }, userId, 'ADMIN')
    admissionId = admission.admissionId
  })

  afterEach(() => {
    setCurrentUser(null)
    db.close()
    fs.rmSync(documentRoot, { recursive: true, force: true })
  })

  it('creates a student admission and includes original charges in the ledger', () => {
    const detail = service.getAdmission(admissionId)
    expect(detail.student_no).toBe('STD-000001')
    expect(detail.full_name).toBe('Test Student')
    expect(detail.academic_year).toBe('2026-2027')
    expect(detail.total_charges).toBe(5000)
    expect(detail.total_discounts).toBe(500)
    expect(detail.balance).toBe(4500)
    expect(detail.payment_status).toBe('UNPAID')
    expect(detail.charges).toHaveLength(1)
  })

  it('updates and searches roll-slip details and derives payment status', () => {
    raw.prepare("UPDATE admissions SET education_board = 'Punjab Board' WHERE id = ?").run(admissionId)
    service.updateSlipDetails({
      admissionId, subjects: 'Pre-medical', rollNumber: 'R-101',
      registrationNumber: 'REG-2026-101', expectedSlipDate: '2026-10-20',
      slipStatus: 'READY_TO_CALL'
    }, userId)

    expect(service.getAdmission(admissionId)).toMatchObject({
      subjects: 'Pre-medical',
      roll_number: 'R-101',
      registration_number: 'REG-2026-101',
      expected_slip_date: '2026-10-20',
      slip_status: 'READY_TO_CALL'
    })
    expect(service.listStudents('REG-2026-101')).toHaveLength(1)
    expect(service.listStudents('', classId, 'Punjab Board')).toHaveLength(1)
    expect(service.listStudents('', classId, 'Federal Board')).toHaveLength(0)
    expect(service.listStudents('', classId, undefined, 'UNPAID', 'READY_TO_CALL')).toHaveLength(1)
    expect(service.listStudents('', classId, undefined, 'PAID', 'READY_TO_CALL')).toHaveLength(0)

    service.collectPayment({
      admissionId, idempotencyKey: 'ed8c9bbc-35e6-4322-b425-f5f5faf69404',
      amount: 1000, method: 'CASH'
    }, userId)
    expect(service.getAdmission(admissionId).payment_status).toBe('PARTIAL')
    service.collectPayment({
      admissionId, idempotencyKey: '0da20a71-2e96-47f6-bb70-5648a7a4dbe8',
      amount: 3500, method: 'CASH'
    }, userId)
    expect(service.getAdmission(admissionId).payment_status).toBe('PAID')
  })

  it('stores encrypted PDF attachments and supports viewing and removal', () => {
    const documents = new AdmissionDocumentService(db, documentRoot, {
      encrypt: (bytes) => Buffer.concat([Buffer.from('encrypted:'), bytes]),
      decrypt: (bytes) => bytes.subarray(Buffer.byteLength('encrypted:'))
    })
    const content = Buffer.from('%PDF-1.4 admission form')
    const staged = documents.stage({
      category: 'ADMISSION_FORM',
      originalFilename: 'form.pdf',
      mimeType: 'application/pdf',
      contentBase64: content.toString('base64')
    }, userId)
    const saved = documents.commit(admissionId, staged.token, userId)
    expect(fs.readFileSync(path.join(documentRoot, 'admissions', String(admissionId),
      fs.readdirSync(path.join(documentRoot, 'admissions', String(admissionId)))[0])).subarray(0, 10).toString())
      .toBe('encrypted:')
    expect(documents.list(admissionId)).toHaveLength(1)
    expect(Buffer.from(documents.read(admissionId, saved.id, userId).contentBase64, 'base64')).toEqual(content)
    documents.remove(admissionId, saved.id, userId)
    expect(documents.list(admissionId)).toHaveLength(0)
  })

  it('prevents cashiers from overriding configured admission fees or adding a discount', () => {
    const base = {
      fullName: 'Restricted Test', fatherName: 'Guardian', classId,
      admissionDate: '2026-10-02', admissionFee: 5000, admissionDiscount: 0
    }
    expect(() => service.createStudent({ ...base, admissionFee: 6000 }, userId, 'CASHIER'))
      .toThrow('Only Admin or Manager can change admission fees or discounts')
    expect(() => service.createStudent({ ...base, admissionDiscount: 500 }, userId, 'CASHIER'))
      .toThrow('Only Admin or Manager can change admission fees or discounts')
    expect(service.listStudents('Restricted')).toHaveLength(0)
  })

  it('only accepts one-time admission charges and posts an idempotent payment with a receipt', () => {
    expect(() => raw.prepare(`
      INSERT INTO admission_fee_charges (admission_id, fee_type, amount, created_by)
      VALUES (?, 'TUITION', 3000, ?)
    `).run(admissionId, userId)).toThrow('Only one-time admission fee charges are supported')
    const input = {
      admissionId, idempotencyKey: 'aa55f269-e1ae-4d38-a250-a20db52a0e44',
      amount: 2000, method: 'CASH' as const, referenceNumber: '', notes: ''
    }
    expect(() => service.collectPayment({ ...input, amount: 5000 }, userId))
      .toThrow('Payment cannot exceed the outstanding admission fee')
    const first = service.collectPayment(input, userId)
    const retry = service.collectPayment(input, userId)
    expect(first.receiptNumber).toMatch(/^ADM-\d{8}-0001$/)
    expect(retry.receiptNumber).toBe(first.receiptNumber)
    expect(first.balance).toBe(2500)

    const detail = service.getAdmission(admissionId)
    expect(detail.payments).toHaveLength(1)
    expect(detail.payments[0].balance_after).toBe(2500)
    expect(detail.charges).toHaveLength(1)
    expect(detail.total_paid).toBe(2000)
  })
})
