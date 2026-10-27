import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { openSqlJsDatabase } from '../src/main/db/sql-js-adapter'

const temporaryFiles: string[] = []

afterEach(() => {
  for (const file of temporaryFiles.splice(0)) {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }
})

describe('SqlJsDatabase persistence', () => {
  it('persists standalone prepared-statement writes before close', async () => {
    const filePath = path.join(os.tmpdir(), `saqib-pos-${Date.now()}-${Math.random()}.db`)
    temporaryFiles.push(filePath)

    const db = await openSqlJsDatabase(filePath)
    db.exec('CREATE TABLE persistence_check (value TEXT NOT NULL)')
    db.prepare('INSERT INTO persistence_check (value) VALUES (?)').run('saved')

    const reopened = await openSqlJsDatabase(filePath)
    const row = reopened.prepare('SELECT value FROM persistence_check').get() as { value: string }
    expect(row.value).toBe('saved')

    reopened.close()
    db.close()
  })
})
