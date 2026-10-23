/**
 * Minimal synchronous SQLite interface.
 * Implemented by SqlJsAdapter (Electron main process) and
 * by better-sqlite3 (Vitest tests, Node.js 24).
 */

export interface PreparedStatement {
  /** Return first matching row as a plain object, or undefined. */
  get(...params: unknown[]): Record<string, unknown> | undefined
  /** Return all matching rows. */
  all(...params: unknown[]): Record<string, unknown>[]
  /** Execute DML; return affected row count and last inserted id. */
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
}

export interface DB {
  /** Execute one or more SQL statements (no parameters). */
  exec(sql: string): void
  /** Prepare a statement for repeated use. */
  prepare(sql: string): PreparedStatement
  /** Execute a PRAGMA clause, e.g. "journal_mode = WAL". */
  pragma(clause: string): void
  /**
   * Wrap a function in a transaction.
   * Usage: const txFn = db.transaction(() => { ... }); txFn()
   */
  transaction<T>(fn: () => T): () => T
  close(): void
}
