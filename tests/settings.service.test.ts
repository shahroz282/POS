import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DB } from '../src/main/db/db'
import { runMigrations } from '../src/main/db/migrate'
import { SettingsService } from '../src/main/services/settings.service'
import { UpdateSettingsInputSchema } from '../src/shared/schemas/auth.schema'

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

describe('SettingsService', () => {
  let raw: BetterSqlite3.Database
  let db: DB
  let service: SettingsService
  let adminUserId: number

  beforeEach(() => {
    process.env.MIGRATIONS_DIR = `${process.cwd()}\\migrations`
    raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    db = wrapDatabase(raw)
    runMigrations(db)
    adminUserId = Number(raw.prepare(
      "INSERT INTO users (name, username, password_hash, role) VALUES ('Admin', 'admin', 'hash', 'ADMIN')"
    ).run().lastInsertRowid)
    service = new SettingsService(db)
  })

  afterEach(() => db.close())

  it('updates supported settings and records changes in the audit log', () => {
    const input = UpdateSettingsInputSchema.parse({
      shop_name: 'New Shop',
      receipt_width_mm: 58,
      max_cashier_discount_percent: 10
    })

    service.updateSettings(input, adminUserId)

    expect(service.getSettings()).toEqual({
      shop_name: 'New Shop',
      receipt_width_mm: '58',
      max_cashier_discount_percent: '10'
    })
    const audit = raw.prepare(
      "SELECT action, entity, details FROM audit_logs WHERE action = 'SETTINGS_CHANGED'"
    ).get() as { action: string; entity: string; details: string }
    expect(audit).toMatchObject({ action: 'SETTINGS_CHANGED', entity: 'settings' })
    expect(audit.details).toContain('shop_name')
    expect(audit.details).toContain('receipt_width_mm')
    expect(audit.details).toContain('max_cashier_discount_percent')
  })

  it('does not create an audit event when values are unchanged', () => {
    service.updateSettings({
      shop_name: 'SAQIB PHOTO STATE',
      receipt_width_mm: 80,
      max_cashier_discount_percent: 5
    }, adminUserId)

    const count = raw.prepare(
      "SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'SETTINGS_CHANGED'"
    ).get() as { count: number }
    expect(count.count).toBe(0)
  })

  it('rejects invalid setting values', () => {
    expect(UpdateSettingsInputSchema.safeParse({ shop_name: '   ' }).success).toBe(false)
    expect(UpdateSettingsInputSchema.safeParse({ receipt_width_mm: 39 }).success).toBe(false)
    expect(UpdateSettingsInputSchema.safeParse({ max_cashier_discount_percent: 101 }).success).toBe(false)
  })
})
