import { app, dialog, ipcMain, safeStorage } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { IpcResult } from '@shared/types'
import {
  AdmissionClassCreateSchema, AdmissionIdSchema, AdmissionPaymentCreateSchema,
  AdmissionStudentCreateSchema, AdmissionStudentSearchSchema, AdmissionSlipUpdateSchema,
  AdmissionDocumentStageSchema, AdmissionDocumentCommitSchema, AdmissionDocumentTokenSchema,
  AdmissionDocumentReadSchema
} from '@shared/schemas'
import { getDb } from '../db/connection'
import { getCurrentUser } from '../services/session'
import { AdmissionsService } from '../services/admissions.service'
import { AdmissionDocumentService } from '../services/admission-document.service'

let documentService: AdmissionDocumentService | null = null
function getDocumentService(): AdmissionDocumentService {
  if (!documentService) {
    documentService = new AdmissionDocumentService(getDb(), path.join(app.getPath('userData'), 'documents'), {
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
      error: { code: 'ADMISSIONS_ERROR', message: error instanceof Error ? error.message : 'Admissions operation failed' }
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
      error: { code: 'ADMISSIONS_ERROR', message: error instanceof Error ? error.message : 'Admissions operation failed' }
    }
  }
}

function requireManager(role: string): void {
  if (role === 'CASHIER') throw new Error('Admin or Manager permission is required')
}

export function registerAdmissionsHandlers(): void {
  ipcMain.handle('admissions:summary', () => authenticated(() => new AdmissionsService(getDb()).summary()))
  ipcMain.handle('admissions:classes:list', () => authenticated(() => new AdmissionsService(getDb()).listClasses()))
  ipcMain.handle('admissions:classes:create', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = AdmissionClassCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return { id: new AdmissionsService(getDb()).createClass(parsed.data, userId) }
  }))
  ipcMain.handle('admissions:students:create', (_event, rawInput: unknown) => authenticated((userId, role) => {
    const parsed = AdmissionStudentCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return new AdmissionsService(getDb()).createStudent(parsed.data, userId, role)
  }))
  ipcMain.handle('admissions:students:list', (_event, rawInput: unknown) => authenticated((_userId, role) => {
    const parsed = AdmissionStudentSearchSchema.safeParse(rawInput ?? {})
    if (!parsed.success) throw new Error(parsed.error.message)
    const students = new AdmissionsService(getDb()).listStudents(
      parsed.data.query, parsed.data.classId, parsed.data.educationBoard,
      parsed.data.paymentStatus, parsed.data.slipStatus
    )
    if (role === 'ADMIN' || role === 'MANAGER') return students
    return students.map((student) => ({ ...student, father_cnic: null, b_form_number: null, address: null }))
  }))
  ipcMain.handle('admissions:students:detail', (_event, rawAdmissionId: unknown) => authenticated((_userId, role) => {
    const parsed = AdmissionIdSchema.safeParse(rawAdmissionId)
    if (!parsed.success) throw new Error('Select a valid admission')
    const admission = new AdmissionsService(getDb()).getAdmission(parsed.data)
    if (role === 'ADMIN' || role === 'MANAGER') return admission
    return { ...admission, father_cnic: null, b_form_number: null, address: null }
  }))
  ipcMain.handle('admissions:payments:create', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = AdmissionPaymentCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return new AdmissionsService(getDb()).collectPayment(parsed.data, userId)
  }))
  ipcMain.handle('admissions:slips:update', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = AdmissionSlipUpdateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    new AdmissionsService(getDb()).updateSlipDetails(parsed.data, userId)
    return null
  }))
  ipcMain.handle('admissions:documents:stage', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = AdmissionDocumentStageSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getDocumentService().stage(parsed.data, userId)
  }))
  ipcMain.handle('admissions:documents:commit', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = AdmissionDocumentCommitSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getDocumentService().commit(parsed.data.admissionId, parsed.data.token, userId)
  }))
  ipcMain.handle('admissions:documents:discard', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = AdmissionDocumentTokenSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    getDocumentService().discard(parsed.data.token, userId)
    return null
  }))
  ipcMain.handle('admissions:documents:list', (_event, rawInput: unknown) => authenticated((_userId, role) => {
    requireManager(role)
    const parsed = AdmissionIdSchema.safeParse((rawInput as { admissionId?: unknown })?.admissionId)
    if (!parsed.success) throw new Error('Select a valid admission')
    return getDocumentService().list(parsed.data)
  }))
  ipcMain.handle('admissions:documents:read', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = AdmissionDocumentReadSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getDocumentService().read(parsed.data.admissionId, parsed.data.documentId, userId)
  }))
  ipcMain.handle('admissions:documents:remove', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = AdmissionDocumentReadSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    getDocumentService().remove(parsed.data.admissionId, parsed.data.documentId, userId)
    return null
  }))
  ipcMain.handle('admissions:students:export-excel', (_event, rawContent: unknown) => authenticatedAsync(async () => {
    if (!(rawContent instanceof Uint8Array) || rawContent.byteLength === 0 || rawContent.byteLength > 25 * 1024 * 1024) {
      throw new Error('The Excel export is invalid or too large')
    }
    const result = await dialog.showSaveDialog({
      title: 'Export student list',
      defaultPath: 'admissions.xlsx',
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePath) return { saved: false }
    await writeFile(result.filePath, rawContent)
    return { saved: true }
  }))
}
