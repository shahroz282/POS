import type { PingInput, PingOutput } from '../schemas'

/** Generic IPC result envelope — ARCHITECTURE.md §IPC conventions */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

/**
 * The typed window.api surface exposed via contextBridge.
 * Add new channels here as features are implemented.
 */
export interface WindowApi {
  ping: (input: PingInput) => Promise<IpcResult<PingOutput>>
}
