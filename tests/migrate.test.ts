import { describe, it, expect, beforeEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import path from 'path'
import { runMigrations } from '../src/main/db/migrate'
import type { DB } from '../src/main/db/db'

// Point the migration runner at the project-root migrations folder
process.env.MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')

/**
 * Wrap a better-sqlite3 instance in our DB interface.
 * better-sqlite3 runs under Node.js 24 in Vitest and works fine.
 * Electron 31 uses sql.js instead (ABI mismatch with better-sqlite3 v13).
 */
function wrapBetterSqlite3(raw: BetterSqlite3.Database): DB {
  return {
    exec: (sql) => { raw.exec(sql) },
    prepare: (sql) => {
      const stmt = raw.prepare(sql)
      return {
        get: (...params) => stmt.get(...params) as Record<string, unknown> | undefined,
        all: (...params) => stmt.all(...params) as Record<string, unknown>[],
        run: (...params) => {
          const r = stmt.run(...params)
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }
        }
      }
    },
    pragma: (clause) => { raw.pragma(clause) },
    transaction: (fn) => raw.transaction(fn) as () => ReturnType<typeof fn>,
    close: () => raw.close()
  }
}

describe('runMigrations', () => {
  let db: DB

  beforeEach(() => {
    const raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    raw.pragma('journal_mode = WAL')
    db = wrapBetterSqlite3(raw)
  })

  it('applies 001_init.sql and records it in schema_migrations', () => {
    runMigrations(db)
    const row = db
      .prepare('SELECT id, name FROM schema_migrations WHERE id = 1')
      .get() as { id: number; name: string } | undefined

    expect(row).toBeDefined()
    expect(row!.id).toBe(1)
    expect(row!.name).toBe('001_init')
  })

  it('creates the users table', () => {
    runMigrations(db)
    const info = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
      .get()
    expect(info).toBeDefined()
  })

  it('creates the settings table with default values', () => {
    runMigrations(db)
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'shop_name'")
      .get() as { value: string } | undefined
    expect(row?.value).toBe('SAQIB PHOTO STATE')
  })

  it('is idempotent — running twice does not throw', () => {
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
  })
})
