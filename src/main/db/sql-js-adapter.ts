/**
 * sql.js adapter — provides the DB interface backed by WASM SQLite.
 *
 * Why sql.js instead of better-sqlite3:
 *   better-sqlite3 v13 ships prebuilt .node binaries for Node.js 24.
 *   Electron 31 embeds Node.js 20; the ABI differs and causes a fatal
 *   native crash that bypasses all JS error handlers.
 *   sql.js is pure WASM — zero compilation, works in any runtime.
 *
 * Persistence strategy:
 *   sql.js operates in-memory. On every mutating operation we call
 *   persist(), which serialises the database and overwrites the file.
 *   This is safe for a single-writer desktop POS app and much simpler
 *   than WAL mode (which sql.js doesn't support for on-disk files).
 */

import fs from 'fs'
import path from 'path'
import type { DB, PreparedStatement } from './db'

// sql.js types — require() at runtime so vite/vitest don't bundle WASM
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlJs = any

// Singleton: initialise once per process
let _SQL: SqlJs | null = null

async function getSqlJs(): Promise<SqlJs> {
  if (_SQL) return _SQL
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const initSqlJs = require('sql.js') as (opts?: object) => Promise<SqlJs>
  _SQL = await initSqlJs()
  return _SQL
}

// ---------------------------------------------------------------------------
// Statement adapter
// ---------------------------------------------------------------------------

class SqlJsStatement implements PreparedStatement {
  constructor(
    private readonly sqlDb: SqlJs,
    private readonly sql: string
  ) {}

  private bindParams(params: unknown[]): unknown[] | Record<string, unknown> {
    if (params.length === 1 && typeof params[0] === 'object' && params[0] !== null && !Array.isArray(params[0])) {
      return params[0] as Record<string, unknown>
    }
    return params
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    const stmt = this.sqlDb.prepare(this.sql)
    try {
      const bound = this.bindParams(params)
      stmt.bind(Array.isArray(bound) ? bound : [])
      if (stmt.step()) {
        return stmt.getAsObject() as Record<string, unknown>
      }
      return undefined
    } finally {
      stmt.free()
    }
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    const stmt = this.sqlDb.prepare(this.sql)
    try {
      const bound = this.bindParams(params)
      stmt.bind(Array.isArray(bound) ? bound : [])
      const rows: Record<string, unknown>[] = []
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as Record<string, unknown>)
      }
      return rows
    } finally {
      stmt.free()
    }
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const bound = this.bindParams(params)
    this.sqlDb.run(this.sql, Array.isArray(bound) ? bound : [])
    const changes = this.sqlDb.getRowsModified() as number
    const [{ 'last_insert_rowid()': lastId }] = (this.sqlDb.exec('SELECT last_insert_rowid()')[0]?.values ?? [[0]]).map(
      (row: unknown[]) => ({ 'last_insert_rowid()': row[0] })
    )
    return { changes, lastInsertRowid: lastId as number }
  }
}

// ---------------------------------------------------------------------------
// Database adapter
// ---------------------------------------------------------------------------

export class SqlJsDatabase implements DB {
  private readonly sqlDb: SqlJs
  private readonly filePath: string | null

  constructor(sqlDb: SqlJs, filePath: string | null) {
    this.sqlDb = sqlDb
    this.filePath = filePath
  }

  exec(sql: string): void {
    this.sqlDb.run(sql)
    this.persist()
  }

  prepare(sql: string): PreparedStatement {
    return new SqlJsStatement(this.sqlDb, sql)
  }

  pragma(clause: string): void {
    try {
      this.sqlDb.run(`PRAGMA ${clause}`)
    } catch {
      // Some pragmas (e.g. WAL) don't apply to in-memory databases — ignore
    }
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.sqlDb.run('BEGIN')
      try {
        const result = fn()
        this.sqlDb.run('COMMIT')
        this.persist()
        return result
      } catch (err) {
        this.sqlDb.run('ROLLBACK')
        throw err
      }
    }
  }

  close(): void {
    this.persist()
    this.sqlDb.close()
  }

  private persist(): void {
    if (!this.filePath) return
    const data: Uint8Array = this.sqlDb.export()
    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(this.filePath, Buffer.from(data))
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Open (or create) a persistent database at filePath.
 * Pass ':memory:' for an in-memory database (used in tests via better-sqlite3;
 * this factory is only called in Electron so filePath is always a real path).
 */
export async function openSqlJsDatabase(filePath: string): Promise<DB> {
  const SQL = await getSqlJs()
  let db: SqlJs
  if (filePath !== ':memory:' && fs.existsSync(filePath)) {
    const buf = fs.readFileSync(filePath)
    db = new SQL.Database(buf)
  } else {
    db = new SQL.Database()
  }
  return new SqlJsDatabase(db, filePath === ':memory:' ? null : filePath)
}
