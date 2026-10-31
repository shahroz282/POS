import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DB } from '../src/main/db/db'
import { runMigrations } from '../src/main/db/migrate'
import { setCurrentUser } from '../src/main/services/session'
import { AdmissionsService } from '../src/main/services/admissions.service'

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

  beforeEach(() => {
    process.env.MIGRATIONS_DIR = `${process.cwd()}\\migrations`
    raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    db = wrapDatabase(raw)
    runMigrations(db)
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
  })

  it('creates a student admission and includes original charges in the ledger', () => {
    const detail = service.getAdmission(admissionId)
    expect(detail.student_no).toBe('STD-000001')
    expect(detail.full_name).toBe('Test Student')
    expect(detail.academic_year).toBe('2026-2027')
    expect(detail.total_charges).toBe(5000)
    expect(detail.total_discounts).toBe(500)
    expect(detail.balance).toBe(4500)
    expect(detail.charges).toHaveLength(1)
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
