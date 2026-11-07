import BetterSqlite3 from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DB } from '../src/main/db/db'
import { runMigrations } from '../src/main/db/migrate'
import { FilerCustomerUpdateSchema } from '../src/shared/schemas'
import { FilerCustomersService } from '../src/main/services/filer-customers.service'
import { FilerCustomerDocumentService } from '../src/main/services/filer-customer-document.service'

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

describe('FilerCustomersService', () => {
  let raw: BetterSqlite3.Database
  let db: DB
  let service: FilerCustomersService
  let userId: number
  let customerId: number
  let documentRoot: string

  beforeEach(() => {
    process.env.MIGRATIONS_DIR = path.join(process.cwd(), 'migrations')
    raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    db = wrapDatabase(raw)
    runMigrations(db)
    userId = Number(raw.prepare(
      "INSERT INTO users (name, username, password_hash, role) VALUES ('Admin', 'admin', 'hash', 'ADMIN')"
    ).run().lastInsertRowid)
    service = new FilerCustomersService(db)
    customerId = service.create({
      customerName: 'Ali Raza',
      cnic: '35201-7654321-2',
      mobile: '0312-9876543',
      filingDate: '2026-11-01',
      category: 'ANNUAL_RETURN',
      totalFee: 2500,
      advancePaid: 1500
    }, userId)
    documentRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filer-customer-docs-'))
  })

  afterEach(() => {
    db.close()
    fs.rmSync(documentRoot, { recursive: true, force: true })
  })

  it('calculates pending balance and status and filters on CNIC, name, or payment status', () => {
    const pending = service.list({ query: '35201', paymentStatus: 'PENDING' })
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      id: customerId,
      customer_name: 'Ali Raza',
      cnic: '35201-7654321-2',
      total_fee: 2500,
      advance_paid: 1500,
      pending_balance: 1000,
      payment_status: 'PENDING'
    })
    expect(service.list({ query: 'ali', paymentStatus: 'DONE' })).toHaveLength(0)
    expect(service.list({ query: '', paymentStatus: undefined })).toHaveLength(1)
  })

  it('updates advance paid and changes the computed status to done', () => {
    service.update(FilerCustomerUpdateSchema.parse({
      customerId,
      customerName: 'Ali Raza',
      cnic: '3520176543212',
      mobile: '0312-9876543',
      filingDate: '2026-11-01',
      category: 'ANNUAL_RETURN',
      totalFee: 2500,
      advancePaid: 2500
    }), userId)

    expect(service.list({ query: 'Ali', paymentStatus: 'DONE' })[0]).toMatchObject({
      cnic: '35201-7654321-2',
      advance_paid: 2500,
      pending_balance: 0,
      payment_status: 'DONE'
    })
    expect(() => FilerCustomerUpdateSchema.parse({
      customerId,
      customerName: 'Ali Raza',
      cnic: '35201-7654321-2',
      mobile: '',
      filingDate: '2026-11-01',
      category: 'ANNUAL_RETURN',
      totalFee: 2000,
      advancePaid: 2500
    })).toThrow()
  })

  it('stores, lists, and reads encrypted filing proof and replaces the active proof', () => {
    const documents = new FilerCustomerDocumentService(db, documentRoot, {
      encrypt: (bytes) => Buffer.from(bytes),
      decrypt: (bytes) => Buffer.from(bytes)
    })
    const first = documents.stage({
      originalFilename: 'proof.pdf',
      mimeType: 'application/pdf',
      contentBase64: Buffer.from('%PDF-1.4 test').toString('base64')
    }, userId)
    const firstSaved = documents.commit(customerId, first.token, userId)
    expect(documents.list(customerId)).toHaveLength(1)
    expect(documents.read(customerId, firstSaved.id, userId).contentBase64).toBe(
      Buffer.from('%PDF-1.4 test').toString('base64')
    )

    const next = documents.stage({
      originalFilename: 'updated.pdf',
      mimeType: 'application/pdf',
      contentBase64: Buffer.from('%PDF-1.5 updated').toString('base64')
    }, userId)
    documents.commit(customerId, next.token, userId)
    expect(documents.list(customerId)).toHaveLength(1)
    expect(documents.list(customerId)[0].original_filename).toBe('updated.pdf')
  })
})
