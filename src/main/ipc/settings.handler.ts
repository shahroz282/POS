import { ipcMain } from 'electron'
import type { IpcResult } from '@shared/types'
import { UpdateSettingsInputSchema } from '@shared/schemas'
import { Permissions } from '@shared/constants'
import type { Role } from '@shared/constants'
import { getDb } from '../db/connection'
import { SettingsService } from '../services/settings.service'
import { getCurrentUser } from '../services/session'

/**
 * IPC handlers for settings channels.
 * ARCHITECTURE.md §IPC conventions.
 */
export function registerSettingsHandlers(): void {
  // ── settings:get ──────────────────────────────────────────────────────
  ipcMain.handle('settings:get', (): IpcResult<{ shop_name: string; receipt_width_mm: string; max_cashier_discount_percent: string }> => {
    const user = getCurrentUser()
    if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
    try {
      const svc = new SettingsService(getDb())
      return { ok: true, data: svc.getSettings() }
    } catch (err) {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: (err as Error).message } }
    }
  })

  // ── settings:update ───────────────────────────────────────────────────
  ipcMain.handle('settings:update', (_event, rawInput: unknown): IpcResult<null> => {
    const user = getCurrentUser()
    if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
    if (!Permissions.canSettings(user.role as Role)) {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Admin only' } }
    }
    const parsed = UpdateSettingsInputSchema.safeParse(rawInput)
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }
    }
    try {
      const svc = new SettingsService(getDb())
      svc.updateSettings(parsed.data, user.id)
      return { ok: true, data: null }
    } catch (err) {
      return { ok: false, error: { code: 'UPDATE_ERROR', message: (err as Error).message } }
    }
  })
}
