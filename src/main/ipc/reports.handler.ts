import { app, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { IpcResult } from '@shared/types'
import { ReportsRangeSchema } from '@shared/schemas'
import { getDb } from '../db/connection'
import { getCurrentUser } from '../services/session'
import { ReportsService } from '../services/reports.service'

function authenticated<T>(operation: (userId: number, role: 'ADMIN' | 'MANAGER' | 'CASHIER') => T): IpcResult<T> {
  const user = getCurrentUser()
  if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
  try {
    return { ok: true, data: operation(user.id, user.role) }
  } catch (error) {
    return { ok: false, error: { code: 'REPORTS_ERROR', message: error instanceof Error ? error.message : 'Reports operation failed' } }
  }
}

export function registerReportsHandlers(): void {
  ipcMain.handle('reports:load', (_event, rawInput: unknown) => authenticated((_userId, role) => {
    const parsed = ReportsRangeSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return new ReportsService(getDb()).report(parsed.data.fromDate, parsed.data.toDate, role)
  }))

  ipcMain.handle('reports:export-excel', async (_event, rawContent: unknown) => {
    const user = getCurrentUser()
    if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
    if (!['ADMIN', 'MANAGER', 'CASHIER'].includes(user.role)) {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to export reports' } }
    }
    try {
      if (!(rawContent instanceof Uint8Array) || rawContent.byteLength === 0 || rawContent.byteLength > 25 * 1024 * 1024) {
        throw new Error('The Excel export is invalid or too large')
      }
      const result = await dialog.showSaveDialog({
        title: 'Export reports',
        defaultPath: path.join(app.getPath('documents'), 'pos-reports.xlsx'),
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
      })
      if (result.canceled || !result.filePath) return { ok: true, data: { saved: false } }
      await writeFile(result.filePath, rawContent)
      return { ok: true, data: { saved: true } }
    } catch (error) {
      return { ok: false, error: { code: 'REPORTS_ERROR', message: error instanceof Error ? error.message : 'Excel export failed' } }
    }
  })
}
