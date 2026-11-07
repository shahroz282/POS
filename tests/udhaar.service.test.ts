import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DB } from '../src/main/db/db'
import { runMigrations } from '../src/main/db/migrate'
import {
  UdhaarCustomerCreateSchema, UdhaarEntryCreateSchema, UdhaarRepaymentCreateSchema
} from '../src/shared/schemas'
import { UdhaarService } from '../src/main/services/udhaar.service'

function receiptDay(): string {
  const date = new Date()
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

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

describe('UdhaarService', () => {
  let raw: BetterSqlite3.Database
  let db: DB
  let service: UdhaarService
  let userId: number
  let customerId: number

  beforeEach(() => {
    process.env.MIGRATIONS_DIR = `${process.cwd()}\\migrations`
    raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    db = wrapDatabase(raw)
    runMigrations(db)
    userId = Number(raw.prepare(
      "INSERT INTO users (name, username, password_hash, role) VALUES ('Admin', 'admin', 'hash', 'ADMIN')"
    ).run().lastInsertRowid)
    service = new UdhaarService(db)
    customerId = service.createCustomer(UdhaarCustomerCreateSchema.parse({
      name: 'Ali Raza', phone: '0300-1234567', address: 'Main Road'
    }), userId)
  })

  afterEach(() => db.close())

  it('creates manual charges, computes balances and filters customer accounts', () => {
    const charge = UdhaarEntryCreateSchema.parse({
      customerId, idempotencyKey: '2a881ac4-65b9-4ad0-8656-9e7bba2b0ef2',
      amount: 1500, note: 'Photocopies', entryDate: '2026-11-08'
    })
    expect(service.createCharge(charge, userId).balance).toBe(1500)
    expect(service.createCharge(charge, userId).balance).toBe(1500)
    expect(service.listCustomers({ query: '0300', status: 'OUTSTANDING' })[0]).toMatchObject({
      name: 'Ali Raza', total_charges: 1500, total_repayments: 0, balance: 1500
    })
    expect(service.entries(customerId)[0]).toMatchObject({
      type: 'CHARGE', amount: 1500, sale_id: null, note: 'Photocopies'
    })
  })

  it('records repayments, prints numbered receipts, limits overpayment and counts cash in', () => {
    service.createCharge(UdhaarEntryCreateSchema.parse({
      customerId, idempotencyKey: '1941ef7a-0602-43fa-a984-6dca3e893ca4',
      amount: 1200, note: 'Credit sale', entryDate: '2026-11-08'
    }), userId)
    const input = UdhaarRepaymentCreateSchema.parse({
      customerId, idempotencyKey: 'ee21b4d2-8e0d-4081-a4c6-d89c99ce127d',
      amount: 500, method: 'CASH', referenceNumber: '', note: 'Part payment',
      entryDate: '2026-11-08'
    })
    const repayment = service.createRepayment(input, userId)
    expect(repayment).toMatchObject({
      receiptNumber: `UDH-${receiptDay()}-0001`, amount: 500, balance: 700,
      method: 'CASH', customerName: 'Ali Raza'
    })
    expect(service.createRepayment(input, userId).receiptNumber).toBe(repayment.receiptNumber)
    expect(db.prepare("SELECT amount FROM cash_entries WHERE type = 'CASH_IN'").get()).toEqual({ amount: 500 })
    expect(service.listCustomers({ query: 'Ali', status: 'OUTSTANDING' })[0]).toMatchObject({
      total_charges: 1200, total_repayments: 500, balance: 700
    })
    expect(() => service.createRepayment(UdhaarRepaymentCreateSchema.parse({
      ...input, idempotencyKey: '366bc7f7-821d-4787-9e9a-3b165fa19aa2', amount: 701
    }), userId)).toThrow('Repayment cannot exceed the outstanding balance')
  })

  it('rejects ledger changes on a locked entry date', () => {
    db.prepare(`
      INSERT INTO daily_closings (closing_date, opening_cash, is_locked)
      VALUES ('2026-11-08', 0, 1)
    `).run()
    expect(() => service.createCharge(UdhaarEntryCreateSchema.parse({
      customerId, idempotencyKey: '34a35a2a-a58e-4ab8-82fd-6e51026aa6d2',
      amount: 100, entryDate: '2026-11-08'
    }), userId)).toThrow('date is closed')
  })

  it('groups outstanding Udhaar, admissions, schemes, stamp, and filer records without duplicating sale credit', () => {
    const sharedCnic = '3520112345671'
    const sharedPhone = '03001234567'
    const creditCustomerId = Number(db.prepare(
      'INSERT INTO customers (name, phone) VALUES (?, ?)'
    ).run('Shared Customer', sharedPhone).lastInsertRowid)
    service.createCharge(UdhaarEntryCreateSchema.parse({
      customerId: creditCustomerId,
      idempotencyKey: '38bff3a8-977e-4e07-84aa-107793e2e415',
      amount: 300, note: 'Sale credit', entryDate: '2026-11-08'
    }), userId)

    const classId = Number(db.prepare(
      "INSERT INTO class_folders (class_name, academic_year) VALUES ('10th', '2026-2027')"
    ).run().lastInsertRowid)
    const studentId = Number(db.prepare(`
      INSERT INTO students (full_name, father_name, phone, father_phone, father_cnic, class_id)
      VALUES ('Student Name', 'Shared Customer', ?, ?, ?, ?)
    `).run(sharedPhone, sharedPhone, sharedCnic, classId).lastInsertRowid)
    const admissionId = Number(db.prepare(`
      INSERT INTO admissions (student_id, class_id, admission_date, fee, status, created_by)
      VALUES (?, ?, '2026-09-01', 500, 'ACTIVE', ?)
    `).run(studentId, classId, userId).lastInsertRowid)
    db.prepare(`
      INSERT INTO admission_fee_charges (admission_id, fee_type, description, amount, created_by)
      VALUES (?, 'ADMISSION', 'Admission fee', 500, ?)
    `).run(admissionId, userId)

    const schemeId = Number(db.prepare(`
      INSERT INTO schemes (name, category, default_fee, scheme_code)
      VALUES ('Housing Scheme', 'Housing', 800, 'HS01')
    `).run().lastInsertRowid)
    db.prepare(`
      INSERT INTO scheme_applications (
        scheme_id, applicant_name, cnic, mobile, application_date, application_fee,
        created_by, application_no
      ) VALUES (?, 'Shared Customer', ?, ?, '2026-10-01', 800, ?, 'SCH-HS01-2026-0001')
    `).run(schemeId, sharedCnic, sharedPhone, userId)

    const stampId = Number(db.prepare(`
      INSERT INTO stamp_paper_transactions (
        txn_no, bank_employee_name, customer_name, register_no, price, status, created_by,
        transaction_id, total_payable_paisa
      ) VALUES ('STP-TEST-1', '', 'Stamp Customer', 'R-1', 600, 'COMPLETED', ?, 'TXN-TEST-1', 60000)
    `).run(userId).lastInsertRowid)
    db.prepare(`
      INSERT INTO stamp_transaction_payments (stamp_id, receipt_number, amount_paisa, method, created_by)
      VALUES (?, 'STP-TEST-1-R1', 20000, 'CASH', ?)
    `).run(stampId, userId)

    db.prepare(`
      INSERT INTO filer_customers (
        customer_name, cnic, mobile, filing_date, category, total_fee, advance_paid, created_by
      ) VALUES ('Shared Customer', ?, ?, '2026-11-01', 'ANNUAL_RETURN', 2000, 500, ?)
    `).run(sharedCnic, sharedPhone, userId)

    const groups = service.allOutstanding()
    const sharedGroup = groups.find((group) => group.name === 'Shared Customer')
    expect(sharedGroup).toMatchObject({
      totalOutstanding: 3100,
      phone: sharedPhone
    })
    expect(sharedGroup?.items.map((item) => item.source).sort()).toEqual([
      'ADMISSION', 'FILER', 'SCHEME', 'UDHAAR'
    ])
    expect(sharedGroup?.items.reduce((sum, item) => sum + item.balance, 0)).toBe(3100)
    expect(sharedGroup?.items.some((item) => 'identityCnic' in item)).toBe(false)
    const stampGroup = groups.find((group) => group.items.some((item) => item.source === 'STAMP'))
    expect(stampGroup?.totalOutstanding).toBe(400)
  })
})
