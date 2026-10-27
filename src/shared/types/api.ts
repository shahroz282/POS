import type {
  PingInput, PingOutput,
  LoginInput, LoginOutput, SetupAdminInput, SessionUser,
  CreateUserInput, UpdateUserRoleInput, DeactivateUserInput, ResetPasswordInput, UserRow,
  UpdateSettingsInput, StampInventoryCreate, StampInventoryRow, StampPaperSaleCreate,
  StampPaymentCreate, StampSaleListRow, StampSaleDetail, StampDocumentRow, StampPartySummary
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

  // ── Stamp paper ─────────────────────────────────────────────────────────
  stampInventoryList: (query?: string) => Promise<IpcResult<StampInventoryRow[]>>
  stampInventoryAdd: (input: StampInventoryCreate) => Promise<IpcResult<{ id: number }>>
  stampPartySearch: (query: string) => Promise<IpcResult<StampPartySummary[]>>
  stampSaleCreate: (input: StampPaperSaleCreate) => Promise<IpcResult<StampSaleListRow>>
  stampSalesList: (query?: string, fromDate?: string, toDate?: string) => Promise<IpcResult<StampSaleListRow[]>>
  stampSaleDetail: (saleId: number) => Promise<IpcResult<StampSaleDetail>>
  stampPaymentCreate: (input: StampPaymentCreate) => Promise<IpcResult<{ receiptNumber: string }>>
  stampSaleCancel: (saleId: number, reason: string, refundMethod?: 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH') => Promise<IpcResult<null>>
  stampDocumentStage: (input: { category: string; originalFilename: string; mimeType: string; contentBase64: string }) => Promise<IpcResult<{ token: string; originalFilename: string; mimeType: string; fileSize: number }>>
  stampDocumentDiscard: (token: string) => Promise<IpcResult<null>>
  stampDocumentsList: (saleId: number) => Promise<IpcResult<StampDocumentRow[]>>
  stampDocumentRead: (saleId: number, id: number) => Promise<IpcResult<{ originalFilename: string; mimeType: string; contentBase64: string }>>
  stampDocumentRemove: (saleId: number, id: number) => Promise<IpcResult<null>>
}
