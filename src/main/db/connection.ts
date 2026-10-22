import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    throw new Error('Database not initialised. Call initDb() first.')
  }
  return _db
}

export function initDb(): Database.Database {
  const dbPath =
    process.env.NODE_ENV === 'test'
      ? ':memory:'
      : path.join(app.getPath('userData'), 'saqib-pos.db')

  const db = new Database(dbPath)

  // ARCHITECTURE.md §Database
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')

  _db = db
  return db
}

export function closeDb(): void {
  _db?.close()
  _db = null
}
