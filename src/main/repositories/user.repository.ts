import type { DB } from '../db/db'

export interface UserDbRow {
  id: number
  name: string
  username: string
  password_hash: string
  role: string
  is_active: number
  created_at: string
}

/** Repository: SQL only, no business rules. ARCHITECTURE.md §Layer rules. */
export class UserRepository {
  constructor(private db: DB) {}

  findByUsername(username: string): UserDbRow | undefined {
    return this.db.prepare(
      'SELECT id, name, username, password_hash, role, is_active, created_at FROM users WHERE username = ?'
    ).get(username) as UserDbRow | undefined
  }

  findById(id: number): UserDbRow | undefined {
    return this.db.prepare(
      'SELECT id, name, username, password_hash, role, is_active, created_at FROM users WHERE id = ?'
    ).get(id) as UserDbRow | undefined
  }

  countAll(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number }
    return row.cnt
  }

  listAll(): UserDbRow[] {
    return this.db.prepare(
      'SELECT id, name, username, password_hash, role, is_active, created_at FROM users ORDER BY id'
    ).all() as UserDbRow[]
  }

  insert(name: string, username: string, passwordHash: string, role: string): number {
    const result = this.db.prepare(
      'INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run(name, username, passwordHash, role)
    return Number(result.lastInsertRowid)
  }

  updateRole(id: number, role: string): number {
    return this.db.prepare(
      'UPDATE users SET role = ? WHERE id = ?'
    ).run(role, id).changes
  }

  deactivate(id: number): number {
    return this.db.prepare(
      'UPDATE users SET is_active = 0 WHERE id = ?'
    ).run(id).changes
  }

  updatePasswordHash(id: number, passwordHash: string): number {
    return this.db.prepare(
      'UPDATE users SET password_hash = ? WHERE id = ?'
    ).run(passwordHash, id).changes
  }
}
