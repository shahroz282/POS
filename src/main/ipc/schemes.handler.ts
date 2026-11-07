import { app, dialog, ipcMain, safeStorage } from 'electron'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { IpcResult } from '@shared/types'
import {
  SchemeApplicationCreateSchema, SchemeApplicationIdSchema, SchemeApplicationSearchSchema,
  SchemeApplicationStatusUpdateSchema, SchemeCategoryCreateSchema, SchemeCreateSchema,
  SchemeIdSchema, SchemeLifecycleUpdateSchema, SchemePaymentCreateSchema, SchemePaymentReverseSchema,
  SchemeUpdateSchema, SchemeDocumentCommitSchema, SchemeDocumentDiscardSchema,
  SchemeDocumentReadSchema, SchemeDocumentRemoveSchema, SchemeDocumentStageSchema,
  SchemeCustomFieldCreateSchema, SchemeDocumentRequirementCreateSchema, SchemeApplicationUpdateSchema
} from '@shared/schemas'
import { getDb } from '../db/connection'
import { getCurrentUser } from '../services/session'
import { SchemesService } from '../services/schemes.service'
import { SchemeDocumentService } from '../services/scheme-document.service'

let documentService: SchemeDocumentService | null = null
function getDocumentService(): SchemeDocumentService {
  if (!documentService) {
    documentService = new SchemeDocumentService(getDb(), path.join(app.getPath('userData'), 'documents'), {
      encrypt: (bytes) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure document storage is unavailable on this system')
        return safeStorage.encryptString(bytes.toString('base64'))
      },
      decrypt: (bytes) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure document storage is unavailable on this system')
        return Buffer.from(safeStorage.decryptString(bytes), 'base64')
      }
    })
  }
  return documentService
}

function authenticated<T>(operation: (userId: number, role: string) => T): IpcResult<T> {
  const user = getCurrentUser()
  if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
  try {
    return { ok: true, data: operation(user.id, user.role) }
  } catch (error) {
    return {
      ok: false,
      error: { code: 'SCHEMES_ERROR', message: error instanceof Error ? error.message : 'Schemes operation failed' }
    }
  }
}

async function authenticatedAsync<T>(operation: (userId: number, role: string) => Promise<T>): Promise<IpcResult<T>> {
  const user = getCurrentUser()
  if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
  try {
    return { ok: true, data: await operation(user.id, user.role) }
  } catch (error) {
    return {
      ok: false,
      error: { code: 'SCHEMES_ERROR', message: error instanceof Error ? error.message : 'Schemes operation failed' }
    }
  }
}

function requireManager(role: string): void {
  if (role === 'CASHIER') throw new Error('Admin or Manager permission is required')
}

function maskCnic(value: string | null): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 13) return '*************'
  return `*****-*******-${digits.slice(-1)}`
}

export function registerSchemesHandlers(): void {
  ipcMain.handle('schemes:summary', () => authenticated(() => new SchemesService(getDb()).summary()))
  ipcMain.handle('schemes:list', () => authenticated(() => new SchemesService(getDb()).listSchemes()))
  ipcMain.handle('schemes:create', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = SchemeCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return { id: new SchemesService(getDb()).createScheme(parsed.data, userId) }
  }))
  ipcMain.handle('schemes:update', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = SchemeUpdateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    new SchemesService(getDb()).updateScheme(parsed.data, userId)
    return null
  }))
  ipcMain.handle('schemes:lifecycle:update', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = SchemeLifecycleUpdateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    new SchemesService(getDb()).updateSchemeLifecycle(parsed.data.schemeId, parsed.data.lifecycleStatus, userId)
    return null
  }))
  ipcMain.handle('schemes:categories:list', (_event, rawSchemeId: unknown) => authenticated((_userId, role) => {
    const parsed = SchemeIdSchema.safeParse(rawSchemeId)
    if (!parsed.success) throw new Error('Select a valid scheme')
    return new SchemesService(getDb()).listCategories(parsed.data)
  }))
  ipcMain.handle('schemes:categories:create', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = SchemeCategoryCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return { id: new SchemesService(getDb()).createCategory(parsed.data.schemeId, parsed.data.name, userId) }
  }))
  ipcMain.handle('schemes:fields:list', (_event, rawSchemeId: unknown) => authenticated((_userId, _role) => {
    const parsed = SchemeIdSchema.safeParse(rawSchemeId)
    if (!parsed.success) throw new Error('Select a valid scheme')
    return new SchemesService(getDb()).listCustomFields(parsed.data)
  }))
  ipcMain.handle('schemes:fields:create', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = SchemeCustomFieldCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return { id: new SchemesService(getDb()).createCustomField(parsed.data, userId) }
  }))
  ipcMain.handle('schemes:document-requirements:list', (_event, rawSchemeId: unknown) => authenticated((_userId, _role) => {
    const parsed = SchemeIdSchema.safeParse(rawSchemeId)
    if (!parsed.success) throw new Error('Select a valid scheme')
    return new SchemesService(getDb()).listDocumentRequirements(parsed.data)
  }))
  ipcMain.handle('schemes:document-requirements:create', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = SchemeDocumentRequirementCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return { id: new SchemesService(getDb()).createDocumentRequirement(parsed.data, userId) }
  }))
  ipcMain.handle('schemes:applications:create', (_event, rawInput: unknown) => authenticated((userId, role) => {
    const parsed = SchemeApplicationCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return new SchemesService(getDb()).createApplication(parsed.data, userId, role)
  }))
  ipcMain.handle('schemes:applications:list', (_event, rawInput: unknown) => authenticated((_userId, role) => {
    const parsed = SchemeApplicationSearchSchema.safeParse(rawInput ?? {})
    if (!parsed.success) throw new Error(parsed.error.message)
    const records = new SchemesService(getDb()).listApplications(parsed.data)
    if (role === 'ADMIN' || role === 'MANAGER') return records
    return records.map((record) => ({ ...record, cnic: maskCnic(record.cnic) }))
  }))
  ipcMain.handle('schemes:applications:detail', (_event, rawId: unknown) => authenticated((_userId, role) => {
    const parsed = SchemeApplicationIdSchema.safeParse(rawId)
    if (!parsed.success) throw new Error('Select a valid application')
    const detail = new SchemesService(getDb()).getApplication(parsed.data)
    if (role === 'ADMIN' || role === 'MANAGER') return detail
    return { ...detail, cnic: maskCnic(detail.cnic) }
  }))
  ipcMain.handle('schemes:applications:update', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = SchemeApplicationUpdateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    new SchemesService(getDb()).updateApplication(parsed.data, userId)
    return null
  }))
  ipcMain.handle('schemes:applications:status', (_event, rawInput: unknown) => authenticated((userId, role) => {
    const parsed = SchemeApplicationStatusUpdateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    if (role === 'CASHIER' && ['APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'].includes(parsed.data.status)) {
      throw new Error('Admin or Manager permission is required for this status')
    }
    new SchemesService(getDb()).updateStatus(
      parsed.data.applicationId, parsed.data.status, parsed.data.remarks, userId
    )
    return null
  }))
  ipcMain.handle('schemes:payments:create', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = SchemePaymentCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return new SchemesService(getDb()).collectPayment(parsed.data, userId)
  }))
  ipcMain.handle('schemes:payments:reverse', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = SchemePaymentReverseSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    new SchemesService(getDb()).reversePayment(parsed.data.paymentId, parsed.data.reason, userId)
    return null
  }))
  ipcMain.handle('schemes:documents:stage', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = SchemeDocumentStageSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getDocumentService().stage(parsed.data, userId)
  }))
  ipcMain.handle('schemes:documents:commit', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = SchemeDocumentCommitSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getDocumentService().commit(
      parsed.data.applicationId, parsed.data.token, userId, parsed.data.replaceDocumentId, parsed.data.requirementId
    )
  }))
  ipcMain.handle('schemes:documents:discard', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = SchemeDocumentDiscardSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    getDocumentService().discard(parsed.data.token, userId)
    return null
  }))
  ipcMain.handle('schemes:documents:list', (_event, rawInput: unknown) => authenticated((_userId, role) => {
    if (role === 'CASHIER') throw new Error('Admin or Manager permission is required to view scheme documents')
    const parsed = SchemeDocumentReadSchema.pick({ applicationId: true }).safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getDocumentService().list(parsed.data.applicationId)
  }))
  ipcMain.handle('schemes:documents:read', (_event, rawInput: unknown) => authenticated((userId, role) => {
    if (role === 'CASHIER') throw new Error('Admin or Manager permission is required to view scheme documents')
    const parsed = SchemeDocumentReadSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getDocumentService().read(parsed.data.applicationId, parsed.data.documentId, userId)
  }))
  ipcMain.handle('schemes:documents:remove', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = SchemeDocumentRemoveSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    getDocumentService().remove(parsed.data.applicationId, parsed.data.documentId, userId)
    return null
  }))
  ipcMain.handle('schemes:export-excel', (_event, rawContent: unknown) => authenticatedAsync(async (_userId, role) => {
    if (role === 'CASHIER') {
      throw new Error('Admin or Manager permission is required to export sensitive scheme applicant data')
    }
    if (!(rawContent instanceof Uint8Array) || rawContent.byteLength === 0 || rawContent.byteLength > 25 * 1024 * 1024) {
      throw new Error('The Excel export is invalid or too large')
    }
    const result = await dialog.showSaveDialog({
      title: 'Export scheme applications',
      defaultPath: 'scheme-applications.xlsx',
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePath) return { saved: false }
    await writeFile(result.filePath, rawContent)
    return { saved: true }
  }))
}
