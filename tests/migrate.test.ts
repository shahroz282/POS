import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import path from 'path'
import { runMigrations } from '../src/main/db/migrate'

// Point the migration runner at the project-root migrations folder
process.env.MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')

describe('runMigrations', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.pragma('journal_mode = WAL')
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
