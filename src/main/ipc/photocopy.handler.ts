import { ipcMain } from 'electron'
import type { IpcResult } from '@shared/types'
import { PhotocopyCreateSchema, PhotocopyRefundSchema, PhotocopySearchSchema } from '@shared/schemas'
import { getDb } from '../db/connection'
import { getCurrentUser } from '../services/session'
import { PhotocopyService } from '../services/photocopy.service'

function authenticated<T>(operation: () => T): IpcResult<T> {
  if (!getCurrentUser()) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
  try {
    return { ok: true, data: operation() }
  } catch (error) {
    return { ok: false, error: { code: 'PHOTOCOPY_ERROR', message: error instanceof Error ? error.message : 'Photocopy operation failed' } }
  }
}

export function registerPhotocopyHandlers(): void {
  ipcMain.handle('photocopy:create', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = PhotocopyCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return new PhotocopyService(getDb()).create(parsed.data)
  }))
  ipcMain.handle('photocopy:list', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = PhotocopySearchSchema.safeParse(rawInput ?? {})
    if (!parsed.success) throw new Error(parsed.error.message)
    return new PhotocopyService(getDb()).list(parsed.data)
  }))
  ipcMain.handle('photocopy:refund', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = PhotocopyRefundSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return new PhotocopyService(getDb()).refund(parsed.data)
  }))
}
