import { ipcMain } from 'electron'
import type { IpcResult } from '@shared/types'
import {
  DailyClosingCloseSchema, DailyClosingDateSchema, DailyClosingExpenseCreateSchema,
  DailyClosingRangeSchema, DailyClosingSaveSchema
} from '@shared/schemas'
import { getDb } from '../db/connection'
import { getCurrentUser } from '../services/session'
import { DailyClosingService } from '../services/daily-closing.service'

function authenticated<T>(operation: (userId: number, role: string) => T): IpcResult<T> {
  const user = getCurrentUser()
  if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
  try {
    if (user.role === 'CASHIER') throw new Error('Admin or Manager permission is required')
    return { ok: true, data: operation(user.id, user.role) }
  } catch (error) {
    return {
      ok: false,
      error: { code: 'DAILY_CLOSING_ERROR', message: error instanceof Error ? error.message : 'Daily closing operation failed' }
    }
  }
}

export function registerDailyClosingHandlers(): void {
  ipcMain.handle('daily-closing:expenses:list', () => authenticated(() =>
    new DailyClosingService(getDb()).expenses()))
  ipcMain.handle('daily-closing:report', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = DailyClosingRangeSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return new DailyClosingService(getDb()).report(parsed.data.fromDate, parsed.data.toDate)
  }))
  ipcMain.handle('daily-closing:save', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = DailyClosingSaveSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    new DailyClosingService(getDb()).save(parsed.data.date, parsed.data.openingCash, userId)
    return null
  }))
  ipcMain.handle('daily-closing:expense:create', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = DailyClosingExpenseCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return { id: new DailyClosingService(getDb()).addExpense(parsed.data, userId) }
  }))
  ipcMain.handle('daily-closing:close', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = DailyClosingCloseSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    new DailyClosingService(getDb()).close(parsed.data.date, parsed.data.openingCash, parsed.data.actualCash, userId)
    return null
  }))
  ipcMain.handle('daily-closing:unlock', (_event, rawDate: unknown) => authenticated((userId, role) => {
    if (role !== 'ADMIN') throw new Error('Only Admin can unlock a closed day')
    const parsed = DailyClosingDateSchema.safeParse(rawDate)
    if (!parsed.success) throw new Error(parsed.error.message)
    new DailyClosingService(getDb()).unlock(parsed.data, userId)
    return null
  }))
}
