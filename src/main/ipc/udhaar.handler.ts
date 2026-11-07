import { ipcMain } from 'electron'
import type { IpcResult } from '@shared/types'
import {
  UdhaarCustomerCreateSchema, UdhaarCustomerIdSchema, UdhaarEntryCreateSchema,
  UdhaarEntrySearchSchema, UdhaarRepaymentCreateSchema, UdhaarSearchSchema
} from '@shared/schemas'
import { getDb } from '../db/connection'
import { getCurrentUser } from '../services/session'
import { UdhaarService } from '../services/udhaar.service'

function authenticated<T>(operation: (userId: number) => T): IpcResult<T> {
  const user = getCurrentUser()
  if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
  try {
    return { ok: true, data: operation(user.id) }
  } catch (error) {
    return {
      ok: false,
      error: { code: 'UDHAAR_ERROR', message: error instanceof Error ? error.message : 'Udhaar operation failed' }
    }
  }
}

export function registerUdhaarHandlers(): void {
  ipcMain.handle('udhaar:outstanding:list', () => authenticated(() => new UdhaarService(getDb()).allOutstanding()))
  ipcMain.handle('udhaar:customers:list', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = UdhaarSearchSchema.safeParse(rawInput ?? {})
    if (!parsed.success) throw new Error(parsed.error.message)
    return new UdhaarService(getDb()).listCustomers(parsed.data)
  }))
  ipcMain.handle('udhaar:customers:create', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = UdhaarCustomerCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return { id: new UdhaarService(getDb()).createCustomer(parsed.data, userId) }
  }))
  ipcMain.handle('udhaar:entries:list', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = UdhaarEntrySearchSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return new UdhaarService(getDb()).entries(parsed.data.customerId)
  }))
  ipcMain.handle('udhaar:charges:create', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = UdhaarEntryCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return new UdhaarService(getDb()).createCharge(parsed.data, userId)
  }))
  ipcMain.handle('udhaar:repayments:create', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = UdhaarRepaymentCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return new UdhaarService(getDb()).createRepayment(parsed.data, userId)
  }))
}
