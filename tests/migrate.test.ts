import { describe, it, expect, beforeEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import fs from 'fs'
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

  it('creates the ticket availability column for simple stamp transactions', () => {
    runMigrations(db)
    const columns = db.prepare('PRAGMA table_info(stamp_paper_transactions)').all() as Array<{ name: string }>
    expect(columns.some((column) => column.name === 'has_ticket_number')).toBe(true)
  })

  it('preserves existing student admissions and payments when adding the fee ledger', () => {
    const migrationsDir = path.join(__dirname, '..', 'migrations')
    for (let id = 1; id <= 7; id += 1) {
      const file = fs.readdirSync(migrationsDir).find((name) => name.startsWith(`${String(id).padStart(3, '0')}_`))
      if (!file) throw new Error(`Missing migration ${id}`)
      db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
    }
    const userId = Number(db.prepare(
      "INSERT INTO users (name, username, password_hash, role) VALUES ('Admin', 'admin', 'hash', 'ADMIN')"
    ).run().lastInsertRowid)
    const classId = Number(db.prepare(
      "INSERT INTO class_folders (class_name, academic_year) VALUES ('9th', '2025-2026')"
    ).run().lastInsertRowid)
    const studentId = Number(db.prepare(
      "INSERT INTO students (full_name, father_name, class_id) VALUES ('Legacy Student', 'Guardian', ?)"
    ).run(classId).lastInsertRowid)
    const admissionId = Number(db.prepare(`
      INSERT INTO admissions (student_id, class_id, admission_date, fee, status, created_by)
      VALUES (?, ?, '2025-09-01', 1000, 'ACTIVE', ?)
    `).run(studentId, classId, userId).lastInsertRowid)
    db.prepare(`
      INSERT INTO payments (receipt_no, admission_id, amount, method, created_by)
      VALUES ('ADM-LEGACY-0001', ?, 400, 'CASH', ?)
    `).run(admissionId, userId)

    runMigrations(db)

    expect(db.prepare('SELECT student_no FROM students WHERE id = ?').get(studentId)).toMatchObject({ student_no: null })
    expect(db.prepare('SELECT SUM(amount) AS paid FROM admission_payment_allocations').get()).toMatchObject({ paid: 400 })
    expect(db.prepare('SELECT balance_after FROM payments WHERE admission_id = ?').get(admissionId)).toMatchObject({ balance_after: 600 })
  })

  it('repairs the ticket availability column when its migration is already recorded', () => {
    const migrationsDir = path.join(__dirname, '..', 'migrations')
    for (let id = 1; id <= 6; id += 1) {
      const file = fs.readdirSync(migrationsDir).find((name) => name.startsWith(`${String(id).padStart(3, '0')}_`))
      if (!file) throw new Error(`Missing migration ${id}`)
      db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
    }
    db.prepare("INSERT INTO schema_migrations (id, name) VALUES (7, '007_optional_ticket_number')").run()

    runMigrations(db)

    const columns = db.prepare('PRAGMA table_info(stamp_paper_transactions)').all() as Array<{ name: string }>
    expect(columns.some((column) => column.name === 'has_ticket_number')).toBe(true)
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
