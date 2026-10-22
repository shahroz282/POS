import { app } from 'electron'
import { initDb, closeDb } from './db/connection'
import { runMigrations } from './db/migrate'
import { createWindow } from './window'
import { registerPingHandler } from './ipc/ping.handler'

app.whenReady().then(() => {
  const db = initDb()
  runMigrations(db)

  registerPingHandler()

  createWindow()

  app.on('activate', () => {
    createWindow()
  })
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
