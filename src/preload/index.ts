import { contextBridge, ipcRenderer } from 'electron'
import type { WindowApi } from '@shared/types'
import type { PingInput, LoginInput, SetupAdminInput, CreateUserInput, UpdateUserRoleInput, DeactivateUserInput, ResetPasswordInput, UpdateSettingsInput } from '@shared/schemas'

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
  settingsUpdate: (input: UpdateSettingsInput) => ipcRenderer.invoke('settings:update', input)
}

contextBridge.exposeInMainWorld('api', api)
