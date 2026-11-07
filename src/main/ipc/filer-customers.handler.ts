import { app, ipcMain, safeStorage } from 'electron'
import path from 'node:path'
import type { IpcResult } from '@shared/types'
import {
  FilerCustomerCreateSchema, FilerCustomerDocumentCommitSchema, FilerCustomerDocumentReadSchema,
  FilerCustomerDocumentStageSchema, FilerCustomerDocumentTokenSchema, FilerCustomerIdSchema,
  FilerCustomerSearchSchema, FilerCustomerUpdateSchema
} from '@shared/schemas'
import { getDb } from '../db/connection'
import { getCurrentUser } from '../services/session'
import { FilerCustomersService } from '../services/filer-customers.service'
import { FilerCustomerDocumentService } from '../services/filer-customer-document.service'

let documentService: FilerCustomerDocumentService | null = null

function getDocumentService(): FilerCustomerDocumentService {
  if (!documentService) {
    documentService = new FilerCustomerDocumentService(
      getDb(),
      path.join(app.getPath('userData'), 'documents'),
      {
        encrypt: (bytes) => {
          if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure document storage is unavailable on this system')
          return safeStorage.encryptString(bytes.toString('base64'))
        },
        decrypt: (bytes) => {
          if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure document storage is unavailable on this system')
          return Buffer.from(safeStorage.decryptString(bytes), 'base64')
        }
      }
    )
  }
  return documentService
}

function authenticated<T>(operation: (userId: number) => T): IpcResult<T> {
  const user = getCurrentUser()
  if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
  try {
    return { ok: true, data: operation(user.id) }
  } catch (error) {
    return {
      ok: false,
      error: { code: 'FILER_CUSTOMERS_ERROR', message: error instanceof Error ? error.message : 'Filer customer operation failed' }
    }
  }
}

export function registerFilerCustomersHandlers(): void {
  ipcMain.handle('filer-customers:list', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = FilerCustomerSearchSchema.safeParse(rawInput ?? {})
    if (!parsed.success) throw new Error(parsed.error.message)
    return new FilerCustomersService(getDb()).list(parsed.data)
  }))
  ipcMain.handle('filer-customers:create', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = FilerCustomerCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return { id: new FilerCustomersService(getDb()).create(parsed.data, userId) }
  }))
  ipcMain.handle('filer-customers:update', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = FilerCustomerUpdateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    new FilerCustomersService(getDb()).update(parsed.data, userId)
    return null
  }))
  ipcMain.handle('filer-customers:documents:stage', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = FilerCustomerDocumentStageSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getDocumentService().stage(parsed.data, userId)
  }))
  ipcMain.handle('filer-customers:documents:commit', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = FilerCustomerDocumentCommitSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getDocumentService().commit(parsed.data.customerId, parsed.data.token, userId)
  }))
  ipcMain.handle('filer-customers:documents:discard', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = FilerCustomerDocumentTokenSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    getDocumentService().discard(parsed.data.token, userId)
    return null
  }))
  ipcMain.handle('filer-customers:documents:list', (_event, rawCustomerId: unknown) => authenticated(() => {
    const parsed = FilerCustomerIdSchema.safeParse(rawCustomerId)
    if (!parsed.success) throw new Error('Select a valid filer customer')
    return getDocumentService().list(parsed.data)
  }))
  ipcMain.handle('filer-customers:documents:read', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = FilerCustomerDocumentReadSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getDocumentService().read(parsed.data.customerId, parsed.data.documentId, userId)
  }))
}
