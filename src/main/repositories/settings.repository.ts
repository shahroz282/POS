import type { DB } from '../db/db'

/** Repository: SQL only, no business rules. ARCHITECTURE.md §Layer rules. */
export class SettingsRepository {
  constructor(private db: DB) {}

  get(key: string): string | undefined {
    const row = this.db.prepare(
      'SELECT value FROM settings WHERE key = ?'
    ).get(key) as { value: string } | undefined
    return row?.value
  }

  set(key: string, value: string): void {
    this.db.prepare(
      'UPDATE settings SET value = ? WHERE key = ?'
    ).run(value, key)
  }

  getMultiple(keys: string[]): Record<string, string> {
    const result: Record<string, string> = {}
    for (const key of keys) {
      const val = this.get(key)
      if (val !== undefined) result[key] = val
    }
    return result
  }
}
