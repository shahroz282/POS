import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DB } from '../src/main/db/db'
import { runMigrations } from '../src/main/db/migrate'
import { DailyClosingService } from '../src/main/services/daily-closing.service'

const reportDate = '2025-01-02'

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

describe('DailyClosingService', () => {
  let raw: BetterSqlite3.Database
  let db: DB
  let service: DailyClosingService
  let userId: number

  beforeEach(() => {
    process.env.MIGRATIONS_DIR = `${process.cwd()}\\migrations`
    raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    db = wrapDatabase(raw)
    runMigrations(db)
    userId = Number(raw.prepare(
      "INSERT INTO users (name, username, password_hash, role) VALUES ('Admin', 'admin', 'hash', 'ADMIN')"
    ).run().lastInsertRowid)
    service = new DailyClosingService(db)
  })

  afterEach(() => db.close())

  it('filters module activity by date and reconciles cash without double-counting Udhaar', () => {
    const saleId = Number(raw.prepare(`
      INSERT INTO sales (invoice_no, subtotal, total, received_amount, created_by, created_at)
      VALUES ('INV-1', 100, 100, 60, ?, ?)
    `).run(userId, `${reportDate} 10:00:00`).lastInsertRowid)
    raw.prepare(`
      INSERT INTO payments (receipt_no, sale_id, amount, method, paid_at, created_by)
      VALUES ('REC-1', ?, 60, 'CASH', ?, ?)
    `).run(saleId, `${reportDate} 10:00:00`, userId)
    raw.prepare(`
      INSERT INTO sale_returns (sale_id, refund_amount, refund_method, created_by, created_at)
      VALUES (?, 7, 'CASH', ?, ?)
    `).run(saleId, userId, `${reportDate} 11:00:00`)

    const stampId = Number(raw.prepare(`
      INSERT INTO stamp_paper_transactions
        (txn_no, bank_employee_name, customer_name, register_no, price, created_by, created_at,
         total_payable_paisa)
      VALUES ('ST-1', 'Bank', 'Client', 'REG-1', 200, ?, ?, 20000)
    `).run(userId, `${reportDate} 10:00:00`).lastInsertRowid)
    raw.prepare(`
      INSERT INTO stamp_transaction_payments (stamp_id, receipt_number, amount_paisa, method, created_by, paid_at)
      VALUES (?, 'STAMP-REC-1', 12500, 'CASH', ?, ?)
    `).run(stampId, userId, `${reportDate} 10:00:00`)

    const classId = Number(raw.prepare(
      "INSERT INTO class_folders (class_name, academic_year, admission_fee) VALUES ('Class 1', '2025', 300)"
    ).run().lastInsertRowid)
    const studentId = Number(raw.prepare(
      "INSERT INTO students (full_name, class_id) VALUES ('Student', ?)"
    ).run(classId).lastInsertRowid)
    const admissionId = Number(raw.prepare(`
      INSERT INTO admissions (student_id, class_id, admission_date, fee, created_by, created_at)
      VALUES (?, ?, ?, 300, ?, ?)
    `).run(studentId, classId, reportDate, userId, `${reportDate} 10:00:00`).lastInsertRowid)
    raw.prepare(`
      INSERT INTO admission_fee_charges (admission_id, fee_type, amount, created_by, created_at)
      VALUES (?, 'ADMISSION', 300, ?, ?)
    `).run(admissionId, userId, `${reportDate} 10:00:00`)
    raw.prepare(`
      INSERT INTO payments (receipt_no, admission_id, amount, method, paid_at, created_by)
      VALUES ('ADM-CASH', ?, 50, 'CASH', ?, ?), ('ADM-BANK', ?, 30, 'BANK', ?, ?)
    `).run(admissionId, `${reportDate} 10:00:00`, userId,
      admissionId, `${reportDate} 10:00:00`, userId)

    const schemeId = Number(raw.prepare("INSERT INTO schemes (name) VALUES ('Scheme')").run().lastInsertRowid)
    const applicationId = Number(raw.prepare(`
      INSERT INTO scheme_applications
        (scheme_id, applicant_name, cnic, application_date, application_fee, created_by, created_at, discount_amount)
      VALUES (?, 'Applicant', '123', ?, 400, ?, ?, 50)
    `).run(schemeId, reportDate, userId, `${reportDate} 10:00:00`).lastInsertRowid)
    raw.prepare(`
      INSERT INTO payments (receipt_no, scheme_app_id, amount, method, paid_at, created_by)
      VALUES ('SCH-CASH', ?, 100, 'CASH', ?, ?), ('SCH-BANK', ?, 20, 'BANK', ?, ?)
    `).run(applicationId, `${reportDate} 10:00:00`, userId,
      applicationId, `${reportDate} 10:00:00`, userId)

    raw.prepare(`
      INSERT INTO filer_customers
        (customer_name, cnic, filing_date, category, total_fee, advance_paid, created_by, created_at)
      VALUES ('Filer', '456', ?, 'FRESH_FILER', 150, 30, ?, ?)
    `).run(reportDate, userId, `${reportDate} 10:00:00`)
    const customerId = Number(raw.prepare("INSERT INTO customers (name) VALUES ('Udhaar')").run().lastInsertRowid)
    raw.prepare(`
      INSERT INTO udhaar_entries (customer_id, type, amount, method, entry_date, created_by)
      VALUES (?, 'CHARGE', 90, NULL, ?, ?), (?, 'REPAYMENT', 25, 'CASH', ?, ?)
    `).run(customerId, reportDate, userId, customerId, reportDate, userId)
    raw.prepare(`
      INSERT INTO cash_entries (type, amount, reason, entry_date, created_by)
      VALUES ('CASH_IN', 25, 'Udhaar repayment', ?, ?), ('CASH_IN', 20, 'Cash added', ?, ?),
        ('CASH_OUT', 5, 'Cash removed', ?, ?)
    `).run(reportDate, userId, reportDate, userId, reportDate, userId)
    raw.prepare(`
      INSERT INTO expenses (category, amount, method, expense_date, created_by)
      VALUES ('Supplies', 10, 'CASH', ?, ?), ('Bank fee', 100, 'BANK', ?, ?)
    `).run(reportDate, userId, reportDate, userId)

    raw.prepare(`
      INSERT INTO sales (invoice_no, subtotal, total, created_by, created_at)
      VALUES ('INV-OLD', 500, 500, ?, '2025-01-01 10:00:00')
    `).run(userId)
    raw.prepare(`
      INSERT INTO payments (receipt_no, sale_id, amount, method, paid_at, created_by)
      VALUES ('OLD-REC', (SELECT id FROM sales WHERE invoice_no = 'INV-OLD'), 500, 'CASH', '2025-01-01 10:00:00', ?)
    `).run(userId)
    const oldStampId = Number(raw.prepare(`
      INSERT INTO stamp_paper_transactions
        (txn_no, bank_employee_name, customer_name, register_no, price, created_by, created_at,
         total_payable_paisa)
      VALUES ('ST-OLD', 'Bank', 'Earlier Client', 'REG-OLD', 300, ?, '2025-01-01 10:00:00', 30000)
    `).run(userId).lastInsertRowid)
    raw.prepare(`
      INSERT INTO stamp_transaction_payments (stamp_id, receipt_number, amount_paisa, method, created_by, paid_at)
      VALUES (?, 'STAMP-OLD-REC', 2000, 'CASH', ?, ?)
    `).run(oldStampId, userId, `${reportDate} 12:00:00`)

    const report = service.report(reportDate)
    expect(report.modules.map(({ key, transactionCount }) => [key, transactionCount])).toEqual([
      ['sales', 1], ['stampPaper', 1], ['admissions', 1], ['schemes', 1], ['filerCustomers', 1], ['udhaar', 2]
    ])
    expect(report.modules.find(({ key }) => key === 'sales')).toMatchObject({
      grossAmount: 100, cashReceived: 60, refunds: 7, outstanding: 40
    })
    expect(report.modules.find(({ key }) => key === 'stampPaper')).toMatchObject({
      grossAmount: 200, cashReceived: 145, outstanding: 75
    })
    expect(report.modules.find(({ key }) => key === 'filerCustomers')).toMatchObject({
      unclassifiedReceived: 30, cashReceived: 0
    })
    expect(report.cash).toMatchObject({
      openingCash: 0, cashReceipts: 355, cashIn: 45, cashOut: 5,
      cashExpenses: 10, cashRefunds: 7, expectedCash: 378
    })

    raw.prepare(`
      INSERT INTO sales (invoice_no, subtotal, total, received_amount, created_by, created_at)
      VALUES ('INV-2', 75, 75, 75, ?, '2025-01-03 10:00:00')
    `).run(userId)
    raw.prepare(`
      INSERT INTO payments (receipt_no, sale_id, amount, method, paid_at, created_by)
      VALUES ('REC-2', (SELECT id FROM sales WHERE invoice_no = 'INV-2'), 75, 'BANK', '2025-01-03 10:00:00', ?)
    `).run(userId)
    const rangeReport = service.report(reportDate, '2025-01-03')
    expect(rangeReport.modules.find(({ key }) => key === 'sales')).toMatchObject({
      transactionCount: 2, grossAmount: 175, cashReceived: 60, nonCashReceived: 75
    })
    expect(rangeReport.cash).toMatchObject({
      cashReceipts: 355, cashIn: 45, expectedCash: 378
    })
    expect(rangeReport.closing).toBeNull()

    service.close(reportDate, 100, 450, userId)
    expect(service.report(reportDate).closing).toMatchObject({
      openingCash: 100, expectedCash: 478, actualCash: 450, difference: -28, isLocked: true
    })
    expect(() => service.save(reportDate, 200, userId)).toThrow('locked')
    service.unlock(reportDate, userId)
    expect(service.report(reportDate).closing?.isLocked).toBe(false)
  })
})
