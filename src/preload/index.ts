import { contextBridge, ipcRenderer } from 'electron'
import type { WindowApi } from '@shared/types'
import type {
  PingInput, LoginInput, SetupAdminInput, CreateUserInput, UpdateUserRoleInput, DeactivateUserInput,
  ResetPasswordInput, UpdateSettingsInput, StampInventoryCreate, StampPaperSaleCreate, StampPaymentCreate,
  SimpleStampSaleCreate, AdmissionClassCreate, AdmissionPaymentCreate, AdmissionStudentCreate
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
  stampDocumentRemove: (saleId: number, id: number) => ipcRenderer.invoke('stamp:documents:remove', { saleId, id }),

  // ── Simple stamp transactions ──────────────────────────────────────────
  simpleStampCreate: (input: SimpleStampSaleCreate) => ipcRenderer.invoke('simple-stamp:create', input),
  simpleStampList: (query?: string, fromDate?: string, toDate?: string) => ipcRenderer.invoke('simple-stamp:list', { query, fromDate, toDate }),
  simpleStampDetail: (stampId: number) => ipcRenderer.invoke('simple-stamp:detail', { stampId }),
  simpleStampPayment: (input: StampPaymentCreate) => ipcRenderer.invoke('simple-stamp:payment', input),
  simpleStampDocumentStage: (input: { category: 'SUPPORTING'; originalFilename: string; mimeType: string; contentBase64: string }) => ipcRenderer.invoke('simple-stamp:document-stage', input),
  simpleStampDocumentDiscard: (token: string) => ipcRenderer.invoke('simple-stamp:document-discard', { token }),
  simpleStampDocumentRead: (stampId: number, id: number) => ipcRenderer.invoke('simple-stamp:document-read', { saleId: stampId, id }),
  simpleStampDocumentRemove: (stampId: number, id: number) => ipcRenderer.invoke('simple-stamp:document-remove', { saleId: stampId, id }),
  // ── Admissions ──────────────────────────────────────────────────────────
  admissionsSummary: () => ipcRenderer.invoke('admissions:summary'),
  admissionsClasses: () => ipcRenderer.invoke('admissions:classes:list'),
  admissionsClassCreate: (input: AdmissionClassCreate) => ipcRenderer.invoke('admissions:classes:create', input),
  admissionsStudentCreate: (input: AdmissionStudentCreate) => ipcRenderer.invoke('admissions:students:create', input),
  admissionsStudents: (query?: string, classId?: number) => ipcRenderer.invoke('admissions:students:list', { query, classId }),
  admissionsDetail: (admissionId: number) => ipcRenderer.invoke('admissions:students:detail', admissionId),
  admissionsPaymentCreate: (input: AdmissionPaymentCreate) => ipcRenderer.invoke('admissions:payments:create', input),
  admissionsStudentsExportExcel: (content: Uint8Array) => ipcRenderer.invoke('admissions:students:export-excel', content)
}

contextBridge.exposeInMainWorld('api', api)
