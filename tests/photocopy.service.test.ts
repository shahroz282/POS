import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DB } from '../src/main/db/db'
import { runMigrations } from '../src/main/db/migrate'
import { DailyClosingRepository } from '../src/main/repositories/daily-closing.repository'
import { PhotocopyService } from '../src/main/services/photocopy.service'
import { setCurrentUser } from '../src/main/services/session'

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

describe('PhotocopyService', () => {
  let raw: BetterSqlite3.Database
  let db: DB
  let service: PhotocopyService
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
    setCurrentUser({ id: userId, name: 'Admin', username: 'admin', role: 'ADMIN' })
    service = new PhotocopyService(db)
  })

  afterEach(() => {
    setCurrentUser(null)
    db.close()
  })

  it('creates a priced, non-stock photocopy receipt exactly once and reconciles a full refund', () => {
    const input = {
      idempotencyKey: 'aa55f269-e1ae-4d38-a250-a20db52a0e44',
      serviceType: 'MONO' as const,
      pageCount: 2,
      copyCount: 2,
      duplex: true,
      unitPrice: 5,
      customerName: 'Customer',
      reference: 'Admissions',
      paymentMethod: 'CASH' as const
    }
    const sale = service.create(input)
    expect(sale).toMatchObject({
      receipt_number: expect.stringMatching(/^CPY-\d{8}-0001$/),
      total_amount: 20,
      amount_received: 20,
      outstanding: 0,
      status: 'COMPLETED'
    })
    expect(service.create(input).id).toBe(sale.id)
    expect(raw.prepare('SELECT COUNT(*) AS count FROM products').get()).toEqual({ count: 0 })

    const refund = {
      saleId: sale.id,
      idempotencyKey: 'bb55f269-e1ae-4d38-a250-a20db52a0e44',
      method: 'CASH' as const,
      reason: 'Misprint'
    }
    expect(service.refund(refund)).toMatchObject({ status: 'CANCELLED', refund_amount: 20, outstanding: 0 })
    expect(service.refund(refund).status).toBe('CANCELLED')
    const report = new DailyClosingRepository(db).report(sale.created_at.slice(0, 10))
    expect(report.modules.find(({ key }) => key === 'photocopy')).toMatchObject({
      transactionCount: 0, grossAmount: 0, refunds: 20
    })
    expect(report.cash.cashReceipts).toBe(20)
    expect(report.cash.cashRefunds).toBe(20)
    expect(report.cash.expectedCash).toBe(0)
  })

  it('rejects cashier refunds and sales on a locked day', () => {
    setCurrentUser({ id: userId, name: 'Cashier', username: 'admin', role: 'CASHIER' })
    expect(() => service.refund({
      saleId: 1,
      idempotencyKey: 'cc55f269-e1ae-4d38-a250-a20db52a0e44',
      method: 'CASH',
      reason: 'test'
    })).toThrow('Admin or Manager')
    setCurrentUser({ id: userId, name: 'Admin', username: 'admin', role: 'ADMIN' })
    const date = new Date()
    const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    raw.prepare("INSERT INTO daily_closings (closing_date, opening_cash, is_locked) VALUES (?, 0, 1)").run(today)
    expect(() => service.create({
      idempotencyKey: 'dd55f269-e1ae-4d38-a250-a20db52a0e44',
      serviceType: 'MONO',
      pageCount: 1,
      copyCount: 1,
      duplex: false,
      unitPrice: 5,
      paymentMethod: 'CASH'
    })).toThrow('locked')
  })
})
