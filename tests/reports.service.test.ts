import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DB } from '../src/main/db/db'
import { runMigrations } from '../src/main/db/migrate'
import { ReportsService } from '../src/main/services/reports.service'

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

describe('ReportsService', () => {
  let raw: BetterSqlite3.Database
  let db: DB
  let service: ReportsService
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
    service = new ReportsService(db)
  })

  afterEach(() => db.close())

  it('filters reports by date range and restricts Cashiers to sales-only data', () => {
    const firstSale = Number(raw.prepare(`
      INSERT INTO sales (invoice_no, subtotal, discount, total, received_amount, created_by, created_at)
      VALUES ('RPT-1', 100, 10, 90, 90, ?, '2026-02-01 10:00:00')
    `).run(userId).lastInsertRowid)
    raw.prepare(`
      INSERT INTO payments (receipt_no, sale_id, amount, method, paid_at, created_by)
      VALUES ('RPT-PAY-1', ?, 90, 'CASH', '2026-02-01 10:00:00', ?)
    `).run(firstSale, userId)
    const productId = Number(raw.prepare(`
      INSERT INTO products (name, purchase_price, sale_price, stock_qty) VALUES ('Report item', 20, 50, 5)
    `).run().lastInsertRowid)
    raw.prepare(`
      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, unit_cost, line_total)
      VALUES (?, ?, 2, 50, 20, 100)
    `).run(firstSale, productId)
    raw.prepare(`
      INSERT INTO purchases (purchase_no, purchase_date, total, created_by)
      VALUES ('PUR-RPT', '2026-02-02', 70, ?)
    `).run(userId)
    raw.prepare(`
      INSERT INTO cash_entries (type, amount, reason, entry_date, created_by)
      VALUES ('CASH_IN', 15, 'Cash deposit', '2026-02-02', ?)
    `).run(userId)

    raw.prepare(`
      INSERT INTO sales (invoice_no, subtotal, total, received_amount, created_by, created_at)
      VALUES ('RPT-OUTSIDE', 500, 500, 500, ?, '2026-02-04 10:00:00')
    `).run(userId)

    const managerReport = service.report('2026-02-01', '2026-02-02', 'MANAGER')
    expect(managerReport.modules.map((module) => module.key)).toContain('inventory')
    expect(managerReport.modules.find((module) => module.key === 'sales')).toMatchObject({
      transactionCount: 1, grossAmount: 90, cashReceived: 90
    })
    expect(managerReport.salesProfit).toBe(50)
    expect(managerReport.inventory).toMatchObject({
      productCount: 1, lowStockCount: 0, stockQuantity: 5, purchaseCount: 1, purchaseTotal: 70
    })
    expect(managerReport.cash).toMatchObject({ cashIn: 15, cashOut: 0, cashExpenses: 0 })

    const cashierReport = service.report('2026-02-01', '2026-02-02', 'CASHIER')
    expect(cashierReport.modules.map((module) => module.key)).toEqual(['sales'])
    expect(cashierReport.inventory).toBeNull()
    expect(cashierReport.cash).toBeNull()
    expect(cashierReport.salesProfit).toBeNull()
  })
})
