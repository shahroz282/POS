import { ipcMain } from 'electron'
import type { IpcResult } from '@shared/types'
import {
  LoginInputSchema, type LoginOutput,
  SetupAdminInputSchema,
  CreateUserInputSchema,
  UpdateUserRoleInputSchema,
  DeactivateUserInputSchema,
  ResetPasswordInputSchema,
  type SessionUser, type UserRow
} from '@shared/schemas'
import { Permissions } from '@shared/constants'
import type { Role } from '@shared/constants'
import { getDb } from '../db/connection'
import { AuthService } from '../services/auth.service'
import { getCurrentUser } from '../services/session'

/**
 * IPC handler for auth channels.
 * ARCHITECTURE.md §IPC conventions: validate input (Zod), check permission,
 * call ONE service function, return typed result.
 */
export function registerAuthHandlers(): void {
  // ── auth:hasUsers ─────────────────────────────────────────────────────
  ipcMain.handle('auth:hasUsers', (): IpcResult<{ hasUsers: boolean }> => {
    try {
      const svc = new AuthService(getDb())
      return { ok: true, data: { hasUsers: svc.hasAnyUsers() } }
    } catch (err) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: (err as Error).message } }
    }
  })

  // ── auth:setupAdmin ───────────────────────────────────────────────────
  ipcMain.handle('auth:setupAdmin', (_event, rawInput: unknown): IpcResult<LoginOutput> => {
    const parsed = SetupAdminInputSchema.safeParse(rawInput)
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }
    }
    try {
      const svc = new AuthService(getDb())
      const user = svc.setupAdmin(parsed.data.name, parsed.data.username, parsed.data.password)
      return { ok: true, data: user }
    } catch (err) {
      return { ok: false, error: { code: 'SETUP_ERROR', message: (err as Error).message } }
    }
  })

  // ── auth:login ────────────────────────────────────────────────────────
  ipcMain.handle('auth:login', (_event, rawInput: unknown): IpcResult<LoginOutput> => {
    const parsed = LoginInputSchema.safeParse(rawInput)
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }
    }
    try {
      const svc = new AuthService(getDb())
      const user = svc.login(parsed.data.username, parsed.data.password)
      return { ok: true, data: user }
    } catch (err) {
      return { ok: false, error: { code: 'AUTH_ERROR', message: (err as Error).message } }
    }
  })

  // ── auth:logout ───────────────────────────────────────────────────────
  ipcMain.handle('auth:logout', (): IpcResult<null> => {
    try {
      const user = getCurrentUser()
      if (user) {
        const svc = new AuthService(getDb())
        svc.logout(user.id)
      }
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: (err as Error).message } }
    }
  })

  // ── auth:getSession ───────────────────────────────────────────────────
  ipcMain.handle('auth:getSession', (): IpcResult<SessionUser | null> => {
    return { ok: true, data: getCurrentUser() }
  })

  // ── users:list ────────────────────────────────────────────────────────
  ipcMain.handle('users:list', (): IpcResult<Array<Omit<UserRow, 'password_hash'>>> => {
    const user = getCurrentUser()
    if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
    if (!Permissions.canManageUsers(user.role as Role)) {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Admin only' } }
    }
    try {
      const svc = new AuthService(getDb())
      const users = svc.listUsers() as Array<Omit<UserRow, 'password_hash'>>
      return { ok: true, data: users }
    } catch (err) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: (err as Error).message } }
    }
  })

  // ── users:create ──────────────────────────────────────────────────────
  ipcMain.handle('users:create', (_event, rawInput: unknown): IpcResult<{ id: number }> => {
    const user = getCurrentUser()
    if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
    if (!Permissions.canManageUsers(user.role as Role)) {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Admin only' } }
    }
    const parsed = CreateUserInputSchema.safeParse(rawInput)
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }
    }
    try {
      const svc = new AuthService(getDb())
      const id = svc.createUser(parsed.data.name, parsed.data.username, parsed.data.password, parsed.data.role, user.id)
      return { ok: true, data: { id } }
    } catch (err) {
      return { ok: false, error: { code: 'CREATE_ERROR', message: (err as Error).message } }
    }
  })

  // ── users:changeRole ──────────────────────────────────────────────────
  ipcMain.handle('users:changeRole', (_event, rawInput: unknown): IpcResult<null> => {
    const user = getCurrentUser()
    if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
    if (!Permissions.canManageUsers(user.role as Role)) {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Admin only' } }
    }
    const parsed = UpdateUserRoleInputSchema.safeParse(rawInput)
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }
    }
    try {
      const svc = new AuthService(getDb())
      svc.changeRole(parsed.data.userId, parsed.data.role, user.id)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: { code: 'UPDATE_ERROR', message: (err as Error).message } }
    }
  })

  // ── users:deactivate ──────────────────────────────────────────────────
  ipcMain.handle('users:deactivate', (_event, rawInput: unknown): IpcResult<null> => {
    const user = getCurrentUser()
    if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
    if (!Permissions.canManageUsers(user.role as Role)) {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Admin only' } }
    }
    const parsed = DeactivateUserInputSchema.safeParse(rawInput)
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }
    }
    try {
      const svc = new AuthService(getDb())
      svc.deactivateUser(parsed.data.userId, user.id)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: { code: 'DEACTIVATE_ERROR', message: (err as Error).message } }
    }
  })

  // ── users:resetPassword ───────────────────────────────────────────────
  ipcMain.handle('users:resetPassword', (_event, rawInput: unknown): IpcResult<null> => {
    const user = getCurrentUser()
    if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
    if (!Permissions.canManageUsers(user.role as Role)) {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Admin only' } }
    }
    const parsed = ResetPasswordInputSchema.safeParse(rawInput)
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }
    }
    try {
      const svc = new AuthService(getDb())
      svc.resetPassword(parsed.data.userId, parsed.data.newPassword, user.id)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: { code: 'RESET_ERROR', message: (err as Error).message } }
    }
  })
}
