import { app } from 'electron'
import { initDb, closeDb } from './db/connection'
import { runMigrations } from './db/migrate'
import { createWindow } from './window'
import { registerPingHandler } from './ipc/ping.handler'

// Surface any startup crash in the electron-vite dev console
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err.stack ?? err.message)
  app.exit(1)
})

app.whenReady().then(async () => {
  const db = await initDb()
  runMigrations(db)

  registerPingHandler()
  createWindow()

  app.on('activate', () => {
    createWindow()
  })
}).catch((err: Error) => {
  console.error('[main] startup error:', err.stack ?? err.message)
  app.exit(1)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDb()
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDb()
})
