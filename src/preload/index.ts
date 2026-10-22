import { contextBridge, ipcRenderer } from 'electron'
import type { WindowApi } from '@shared/types'
import type { PingInput } from '@shared/schemas'

/**
 * Exposes a typed `window.api` to the renderer via contextBridge.
 * contextIsolation = true, nodeIntegration = false — ARCHITECTURE.md §Security.
 * The renderer NEVER touches ipcRenderer directly.
 */
const api: WindowApi = {
  ping: (input: PingInput) => ipcRenderer.invoke('ping:ping', input)
}

contextBridge.exposeInMainWorld('api', api)
