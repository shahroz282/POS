/**
 * Database connection singleton for the Electron main process.
 *
 * Uses sql.js (WASM SQLite) instead of better-sqlite3 because
 * better-sqlite3 v13's prebuilt win32-x64.node targets Node.js 24
 * and causes a fatal ABI crash in Electron 31 (Node.js 20).
 * sql.js requires no native compilation and works in any runtime.
 */

import { app } from 'electron'
import path from 'path'
import type { DB } from './db'
import { openSqlJsDatabase } from './sql-js-adapter'

let _db: DB | null = null

export function getDb(): DB {
  if (!_db) {
    throw new Error('Database not initialised. Call initDb() first.')
  }
  return _db
}

export async function initDb(): Promise<DB> {
  const dbPath =
    process.env.NODE_ENV === 'test'
      ? ':memory:'
      : path.join(app.getPath('userData'), 'saqib-pos.db')

  const db = await openSqlJsDatabase(dbPath)

  // Best-effort pragmas (sql.js silently ignores WAL / unsupported ones)
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')

  _db = db
  return db
}

export function closeDb(): void {
  _db?.close()
  _db = null
}
