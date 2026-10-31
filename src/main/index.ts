import { app } from 'electron'
import { initDb, closeDb } from './db/connection'
import { runMigrations } from './db/migrate'
import { createWindow } from './window'
import { registerPingHandler } from './ipc/ping.handler'
import { registerAuthHandlers } from './ipc/auth.handler'
import { registerSettingsHandlers } from './ipc/settings.handler'
import { registerStampPaperHandlers } from './ipc/stamp-paper.handler'
import { registerAdmissionsHandlers } from './ipc/admissions.handler'

// Surface any startup crash in the electron-vite dev console
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err.stack ?? err.message)
  app.exit(1)
})

app.whenReady().then(async () => {
  const db = await initDb()
  runMigrations(db)

  registerPingHandler()
  registerAuthHandlers()
  registerSettingsHandlers()
  registerStampPaperHandlers()
  registerAdmissionsHandlers()
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
