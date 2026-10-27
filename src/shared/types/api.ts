import type {
  PingInput, PingOutput,
  LoginInput, LoginOutput, SetupAdminInput, SessionUser,
  CreateUserInput, UpdateUserRoleInput, DeactivateUserInput, ResetPasswordInput, UserRow,
  UpdateSettingsInput
} from '../schemas'

/** Generic IPC result envelope — ARCHITECTURE.md §IPC conventions */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

/**
 * The typed window.api surface exposed via contextBridge.
 * Add new channels here as features are implemented.
 */
export interface WindowApi {
  ping: (input: PingInput) => Promise<IpcResult<PingOutput>>

  // ── Auth ────────────────────────────────────────────────────────────────
  authHasUsers: () => Promise<IpcResult<{ hasUsers: boolean }>>
  authSetupAdmin: (input: SetupAdminInput) => Promise<IpcResult<LoginOutput>>
  authLogin: (input: LoginInput) => Promise<IpcResult<LoginOutput>>
  authLogout: () => Promise<IpcResult<null>>
  authGetSession: () => Promise<IpcResult<SessionUser | null>>

  // ── Users (admin only) ──────────────────────────────────────────────────
  usersList: () => Promise<IpcResult<Array<Omit<UserRow, 'password_hash'>>>>
  usersCreate: (input: CreateUserInput) => Promise<IpcResult<{ id: number }>>
  usersChangeRole: (input: UpdateUserRoleInput) => Promise<IpcResult<null>>
  usersDeactivate: (input: DeactivateUserInput) => Promise<IpcResult<null>>
  usersResetPassword: (input: ResetPasswordInput) => Promise<IpcResult<null>>

  // ── Settings ────────────────────────────────────────────────────────────
  settingsGet: () => Promise<IpcResult<{ shop_name: string; receipt_width_mm: string; max_cashier_discount_percent: string }>>
  settingsUpdate: (input: UpdateSettingsInput) => Promise<IpcResult<null>>
}
