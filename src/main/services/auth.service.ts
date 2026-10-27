import bcrypt from 'bcryptjs'
import type { DB } from '../db/db'
import { UserRepository } from '../repositories/user.repository'
import { AuditLogRepository } from '../repositories/audit-log.repository'
import { setCurrentUser } from './session'
import type { SessionUser } from '@shared/schemas'

const BCRYPT_ROUNDS = 10

/**
 * Service: business rules for auth + user management.
 * ARCHITECTURE.md §Layer rules — services hold all business rules and own transactions.
 */
export class AuthService {
  private userRepo: UserRepository
  private auditRepo: AuditLogRepository

  constructor(private db: DB) {
    this.userRepo = new UserRepository(db)
    this.auditRepo = new AuditLogRepository(db)
  }

  /** Check whether any users exist (first-run detection). */
  hasAnyUsers(): boolean {
    return this.userRepo.countAll() > 0
  }

  /** First-run: create the initial admin account. */
  setupAdmin(name: string, username: string, password: string): SessionUser {
    if (this.hasAnyUsers()) {
      throw new Error('Admin setup already completed')
    }

    const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS)
    const id = this.userRepo.insert(name, username, hash, 'ADMIN')

    const user: SessionUser = { id, name, username, role: 'ADMIN' }
    setCurrentUser(user)

    this.auditRepo.insert(id, 'SETUP_ADMIN', 'users', id, `Initial admin created: ${username}`)
    return user
  }

  /** Authenticate and log in. */
  login(username: string, password: string): SessionUser {
    const row = this.userRepo.findByUsername(username)
    if (!row) {
      throw new Error('Invalid username or password')
    }
    if (!row.is_active) {
      throw new Error('Account is deactivated')
    }
    if (!bcrypt.compareSync(password, row.password_hash)) {
      // Log failed attempt
      this.auditRepo.insert(null, 'LOGIN_FAILED', 'users', row.id, `Failed login attempt for: ${username}`)
      throw new Error('Invalid username or password')
    }

    const user: SessionUser = {
      id: row.id,
      name: row.name,
      username: row.username,
      role: row.role as SessionUser['role']
    }
    setCurrentUser(user)
    this.auditRepo.insert(row.id, 'LOGIN', 'users', row.id, `User logged in: ${username}`)
    return user
  }

  /** Log out the current user. */
  logout(userId: number): void {
    this.auditRepo.insert(userId, 'LOGOUT', 'users', userId, 'User logged out')
    setCurrentUser(null)
  }

  /** Create a new user (admin only — permission checked in IPC handler). */
  createUser(name: string, username: string, password: string, role: string, adminUserId: number): number {
    const existing = this.userRepo.findByUsername(username)
    if (existing) {
      throw new Error('Username already exists')
    }

    const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS)
    const id = this.userRepo.insert(name, username, hash, role)

    this.auditRepo.insert(adminUserId, 'USER_CREATED', 'users', id, `Created user: ${username} with role ${role}`)
    return id
  }

  /** Change a user's role. */
  changeRole(userId: number, newRole: string, adminUserId: number): void {
    const user = this.userRepo.findById(userId)
    if (!user) throw new Error('User not found')

    const oldRole = user.role
    this.userRepo.updateRole(userId, newRole)
    this.auditRepo.insert(adminUserId, 'USER_ROLE_CHANGED', 'users', userId,
      `Role changed from ${oldRole} to ${newRole} for ${user.username}`)
  }

  /** Deactivate a user. Cannot deactivate yourself. */
  deactivateUser(userId: number, adminUserId: number): void {
    if (userId === adminUserId) {
      throw new Error('Cannot deactivate your own account')
    }
    const user = this.userRepo.findById(userId)
    if (!user) throw new Error('User not found')

    this.userRepo.deactivate(userId)
    this.auditRepo.insert(adminUserId, 'USER_DEACTIVATED', 'users', userId,
      `Deactivated user: ${user.username}`)
  }

  /** Reset a user's password. */
  resetPassword(userId: number, newPassword: string, adminUserId: number): void {
    const user = this.userRepo.findById(userId)
    if (!user) throw new Error('User not found')

    const hash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS)
    this.userRepo.updatePasswordHash(userId, hash)
    this.auditRepo.insert(adminUserId, 'USER_PASSWORD_RESET', 'users', userId,
      `Password reset for: ${user.username}`)
  }

  /** List all users (without password hashes). */
  listUsers(): Array<{ id: number; name: string; username: string; role: string; is_active: number; created_at: string }> {
    return this.userRepo.listAll().map(({ password_hash: _, ...rest }) => rest)
  }
}

// ── Standalone password utilities (exported for tests) ──────────────────────

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS)
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash)
}
