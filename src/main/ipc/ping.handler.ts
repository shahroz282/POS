import { ipcMain } from 'electron'
import type { IpcResult } from '@shared/types'
import { PingInputSchema, type PingOutput } from '@shared/schemas'

/**
 * Example IPC channel: `ping:ping`
 * Demonstrates: Zod validation → { ok, data | error } envelope.
 * ARCHITECTURE.md §IPC conventions.
 */
export function registerPingHandler(): void {
  ipcMain.handle('ping:ping', (_event, rawInput: unknown): IpcResult<PingOutput> => {
    const parsed = PingInputSchema.safeParse(rawInput)
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message }
      }
    }

    return {
      ok: true,
      data: {
        echo: parsed.data.message,
        timestamp: new Date().toISOString()
      }
    }
  })
}
