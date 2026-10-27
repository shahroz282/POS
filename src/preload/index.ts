import { contextBridge, ipcRenderer } from 'electron'
import type { WindowApi } from '@shared/types'
import type {
  PingInput, LoginInput, SetupAdminInput, CreateUserInput, UpdateUserRoleInput, DeactivateUserInput,
  ResetPasswordInput, UpdateSettingsInput, StampInventoryCreate, StampPaperSaleCreate, StampPaymentCreate
} from '@shared/schemas'

/**
 * Exposes a typed `window.api` to the renderer via contextBridge.
 * contextIsolation = true, nodeIntegration = false — ARCHITECTURE.md §Security.
 * The renderer NEVER touches ipcRenderer directly.
 */
const api: WindowApi = {
  ping: (input: PingInput) => ipcRenderer.invoke('ping:ping', input),

  // ── Auth ────────────────────────────────────────────────────────────────
  authHasUsers: () => ipcRenderer.invoke('auth:hasUsers'),
  authSetupAdmin: (input: SetupAdminInput) => ipcRenderer.invoke('auth:setupAdmin', input),
  authLogin: (input: LoginInput) => ipcRenderer.invoke('auth:login', input),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authGetSession: () => ipcRenderer.invoke('auth:getSession'),

  // ── Users (admin only) ──────────────────────────────────────────────────
  usersList: () => ipcRenderer.invoke('users:list'),
  usersCreate: (input: CreateUserInput) => ipcRenderer.invoke('users:create', input),
  usersChangeRole: (input: UpdateUserRoleInput) => ipcRenderer.invoke('users:changeRole', input),
  usersDeactivate: (input: DeactivateUserInput) => ipcRenderer.invoke('users:deactivate', input),
  usersResetPassword: (input: ResetPasswordInput) => ipcRenderer.invoke('users:resetPassword', input),

  // ── Settings ────────────────────────────────────────────────────────────
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsUpdate: (input: UpdateSettingsInput) => ipcRenderer.invoke('settings:update', input),

  // ── Stamp paper ─────────────────────────────────────────────────────────
  stampInventoryList: (query?: string) => ipcRenderer.invoke('stamp:inventory:list', query),
  stampInventoryAdd: (input: StampInventoryCreate) => ipcRenderer.invoke('stamp:inventory:add', input),
  stampPartySearch: (query: string) => ipcRenderer.invoke('stamp:parties:search', query),
  stampSaleCreate: (input: StampPaperSaleCreate) => ipcRenderer.invoke('stamp:sales:create', input),
  stampSalesList: (query?: string, fromDate?: string, toDate?: string) => ipcRenderer.invoke('stamp:sales:list', { query, fromDate, toDate }),
  stampSaleDetail: (saleId: number) => ipcRenderer.invoke('stamp:sales:detail', { saleId }),
  stampPaymentCreate: (input: StampPaymentCreate) => ipcRenderer.invoke('stamp:payments:create', input),
  stampSaleCancel: (saleId: number, reason: string, refundMethod?: 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH') => ipcRenderer.invoke('stamp:sales:cancel', { saleId, reason, refundMethod }),
  stampDocumentStage: (input: { category: string; originalFilename: string; mimeType: string; contentBase64: string }) => ipcRenderer.invoke('stamp:documents:stage', input),
  stampDocumentDiscard: (token: string) => ipcRenderer.invoke('stamp:documents:discard', { token }),
  stampDocumentsList: (saleId: number) => ipcRenderer.invoke('stamp:documents:list', { saleId }),
  stampDocumentRead: (saleId: number, id: number) => ipcRenderer.invoke('stamp:documents:read', { saleId, id }),
  stampDocumentRemove: (saleId: number, id: number) => ipcRenderer.invoke('stamp:documents:remove', { saleId, id })
}

contextBridge.exposeInMainWorld('api', api)
