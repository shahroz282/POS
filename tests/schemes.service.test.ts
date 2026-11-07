import BetterSqlite3 from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DB } from '../src/main/db/db'
import { runMigrations } from '../src/main/db/migrate'
import { SchemesService } from '../src/main/services/schemes.service'
import { SchemeDocumentService } from '../src/main/services/scheme-document.service'

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

describe('SchemesService', () => {
  let raw: BetterSqlite3.Database
  let db: DB
  let service: SchemesService
  let userId: number
  let schemeId: number
  let applicationId: number

  beforeEach(() => {
    process.env.MIGRATIONS_DIR = path.join(process.cwd(), 'migrations')
    raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    db = wrapDatabase(raw)
    runMigrations(db)
    userId = Number(raw.prepare(
      "INSERT INTO users (name, username, password_hash, role) VALUES ('Admin', 'admin', 'hash', 'ADMIN')"
    ).run().lastInsertRowid)
    service = new SchemesService(db)
    schemeId = service.createScheme({
      name: 'Housing Support', schemeCode: 'HS26', category: 'Housing', defaultFee: 2000,
      startDate: '2026-01-01', endDate: '', lifecycleStatus: 'ACTIVE'
    }, userId)
    const application = service.createApplication({
      schemeId, applicantName: 'Test Applicant', fatherName: 'Test Parent',
      cnic: '12345-1234567-1', mobile: '03001234567', address: 'Main Road',
      city: 'Lahore', district: 'Lahore', category: 'Residential', purpose: 'Housing',
      applicationDate: '2026-11-01', discountAmount: 200,
      customFields: {}, remarks: ''
    }, userId, 'ADMIN')
    applicationId = application.applicationId
  })

  afterEach(() => {
    db.close()
  })

  it('creates permanent scheme-specific application numbers and status history', () => {
    const detail = service.getApplication(applicationId)
    expect(detail.application_no).toBe('SCH-HS26-2026-0001')
    expect(detail.status).toBe('RECEIVED')
    expect(detail.application_fee).toBe(2000)
    expect(detail.discount_amount).toBe(200)
    expect(detail.balance).toBe(1800)
    expect(detail.status_history).toHaveLength(1)
    expect(() => service.createApplication({
      schemeId, applicantName: 'Fee override', cnic: '12345-1234567-2',
      applicationDate: '2026-11-01', applicationFee: 3000, discountAmount: 0, customFields: {}
    }, userId, 'CASHIER')).toThrow('Only Admin or Manager')
  })

  it('saves partial payments idempotently and rejects overpayment', () => {
    const input = {
      applicationId, idempotencyKey: '2b220cf8-5ecc-4de7-b9e6-889360debb1c',
      amount: 800, method: 'OTHER' as const, referenceNumber: 'ref-1', notes: 'counter'
    }
    expect(() => service.collectPayment({ ...input, amount: 1801 }, userId))
      .toThrow('Payment cannot exceed the outstanding application fee')
    const first = service.collectPayment(input, userId)
    const retry = service.collectPayment(input, userId)
    expect(first.receiptNumber).toMatch(/^SCHR-\d{8}-0001$/)
    expect(retry.receiptNumber).toBe(first.receiptNumber)
    expect(first.balance).toBe(1000)
    expect(service.getApplication(applicationId).payments).toHaveLength(1)
    expect(service.summary().recentPayments).toEqual([
      expect.objectContaining({
        receipt_no: first.receiptNumber,
        application_no: 'SCH-HS26-2026-0001',
        amount: 800,
        method: 'OTHER',
        reversed: 0
      })
    ])
  })

  it('enforces status transitions and preserves reversed payment history', () => {
    service.updateStatus(applicationId, 'UNDER_REVIEW', '', userId)
    expect(() => service.updateStatus(applicationId, 'COMPLETED', '', userId))
      .toThrow('Application status cannot change')
    const payment = service.collectPayment({
      applicationId, idempotencyKey: '192fe460-2d13-4026-8bc0-ccfe7daa55b0',
      amount: 500, method: 'CASH'
    }, userId)
    const savedPayment = service.getApplication(applicationId).payments[0]
    expect(savedPayment.receipt_no).toBe(payment.receiptNumber)
    service.reversePayment(savedPayment.id, 'Duplicate tender', userId)
    const detail = service.getApplication(applicationId)
    expect(detail.payments[0].reversed).toBe(1)
    expect(detail.balance).toBe(1800)
    expect(detail.payments).toHaveLength(1)
    expect(() => service.collectPayment({
      applicationId, idempotencyKey: '192fe460-2d13-4026-8bc0-ccfe7daa55b0',
      amount: 500, method: 'CASH'
    }, userId)).toThrow('This payment was reversed')
  })

  it('validates scheme-defined fields and supports encrypted document records', () => {
    service.createCustomField({
      schemeId, fieldKey: 'property_type', label: 'Property type',
      fieldType: 'SELECT', options: ['Residential', 'Commercial'], isRequired: true, sortOrder: 0
    }, userId)
    const requirementId = service.createDocumentRequirement({
      schemeId, name: 'CNIC copy', isRequired: true
    }, userId)
    expect(() => service.createApplication({
      schemeId, applicantName: 'Missing value', cnic: '12345-1234567-3',
      applicationDate: '2026-11-01', discountAmount: 0, customFields: {}
    }, userId, 'ADMIN')).toThrow('Property type is required')

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saqib-scheme-docs-'))
    try {
      const documents = new SchemeDocumentService(db, root, { encrypt: (bytes) => bytes, decrypt: (bytes) => bytes })
      const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
      const staged = documents.stage({
        category: 'CNIC_FRONT', originalFilename: 'front.png', mimeType: 'image/png',
        contentBase64: png.toString('base64')
      }, userId)
      const saved = documents.commit(applicationId, staged.token, userId)
      expect(documents.list(applicationId)).toHaveLength(1)
      expect(documents.read(applicationId, saved.id, userId).contentBase64).toBe(png.toString('base64'))
      expect(() => documents.stage({
        category: 'OTHER', originalFilename: 'fake.png', mimeType: 'image/png',
        contentBase64: Buffer.from('not a png').toString('base64')
      }, userId)).toThrow('does not match')
      documents.remove(applicationId, saved.id, userId)
      expect(documents.list(applicationId)).toHaveLength(0)
      service.updateStatus(applicationId, 'UNDER_REVIEW', '', userId)
      expect(() => service.updateStatus(applicationId, 'SUBMITTED', '', userId))
        .toThrow('Required documents are missing: CNIC copy')
      const requiredUpload = documents.stage({
        category: 'CNIC_FRONT', originalFilename: 'cnic.png', mimeType: 'image/png',
        contentBase64: png.toString('base64')
      }, userId)
      documents.commit(applicationId, requiredUpload.token, userId, undefined, requirementId)
      service.updateStatus(applicationId, 'SUBMITTED', '', userId)
      expect(service.getApplication(applicationId).status).toBe('SUBMITTED')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
