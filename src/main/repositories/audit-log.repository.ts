import type { DB } from '../db/db'

/** Repository: SQL only, no business rules. ARCHITECTURE.md §Layer rules. */
export class AuditLogRepository {
  constructor(private db: DB) {}

  insert(userId: number | null, action: string, entity: string | null, entityId: number | null, details: string | null): number {
    const result = this.db.prepare(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, action, entity, entityId, details)
    return Number(result.lastInsertRowid)
  }
}
