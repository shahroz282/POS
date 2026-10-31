import { dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { IpcResult } from '@shared/types'
import {
  AdmissionClassCreateSchema, AdmissionIdSchema, AdmissionPaymentCreateSchema,
  AdmissionStudentCreateSchema, AdmissionStudentSearchSchema
} from '@shared/schemas'
import { getDb } from '../db/connection'
import { getCurrentUser } from '../services/session'
import { AdmissionsService } from '../services/admissions.service'

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
    const students = new AdmissionsService(getDb()).listStudents(parsed.data.query, parsed.data.classId)
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
