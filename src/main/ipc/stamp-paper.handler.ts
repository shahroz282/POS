import { app, dialog, ipcMain, safeStorage } from 'electron'
import path from 'path'
import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { IpcResult } from '@shared/types'
import {
  StampDocumentDeleteSchema,
  StampDocumentDiscardSchema,
  StampDocumentPickSchema,
  StampDocumentReadSchema,
  StampInventoryCreateSchema,
  StampInventorySearchSchema,
  StampPaperSaleCreateSchema,
  StampSaleCancelSchema,
  StampPartySearchSchema,
  StampPaymentCreateSchema,
  StampSalesSearchSchema,
  SimpleStampPaymentCreateSchema,
  SimpleStampSaleCreateSchema,
  SimpleStampSaleUpdateSchema,
  SimpleStampRefundCreateSchema
} from '@shared/schemas'
import { getDb } from '../db/connection'
import { StampPaperService } from '../services/stamp-paper.service'
import { getCurrentUser } from '../services/session'

let service: StampPaperService | null = null
function getService(): StampPaperService {
  if (!service) service = new StampPaperService(getDb(), path.join(app.getPath('userData'), 'documents'), {
    encrypt: (bytes) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure document storage is unavailable on this system')
      return safeStorage.encryptString(bytes.toString('base64'))
    },
    decrypt: (bytes) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure document storage is unavailable on this system')
      return Buffer.from(safeStorage.decryptString(bytes), 'base64')
    }
  })
  return service
}

function authenticated<T>(operation: (userId: number, role: string) => T): IpcResult<T> {
  const user = getCurrentUser()
  if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
  try {
    return { ok: true, data: operation(user.id, user.role) }
  } catch (error) {
    return { ok: false, error: { code: 'STAMP_ERROR', message: error instanceof Error ? error.message : 'Stamp paper operation failed' } }
  }
}

function requireManager(role: string): void {
  if (role === 'CASHIER') throw new Error('Admin or Manager permission is required')
}

export function registerStampPaperHandlers(): void {
  ipcMain.handle('stamp:inventory:list', (_event, rawQuery: unknown) => authenticated((_userId, role) => {
    const parsed = StampInventorySearchSchema.safeParse({ query: rawQuery ?? '' })
    if (!parsed.success) throw new Error(parsed.error.message)
    return getService().listInventory(parsed.data.query, role)
  }))

  ipcMain.handle('stamp:inventory:add', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = StampInventoryCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return { id: getService().addInventory(parsed.data, userId) }
  }))

  ipcMain.handle('stamp:parties:search', (_event, rawQuery: unknown) => authenticated((_userId, role) => {
    const parsed = StampPartySearchSchema.safeParse({ query: rawQuery })
    if (!parsed.success) throw new Error(parsed.error.message)
    const parties = getService().searchParties(parsed.data.query)
    if (role !== 'ADMIN' && role !== 'MANAGER') {
      return parties.map((party) => ({ ...party, cnic_number: party.cnic_number ? `*****-*******-${party.cnic_number.slice(-1)}` : null }))
    }
    return parties
  }))

  ipcMain.handle('stamp:sales:create', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = StampPaperSaleCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getService().createSale(parsed.data)
  }))

  ipcMain.handle('stamp:sales:list', (_event, rawInput: unknown) => authenticated((_userId, role) => {
    const parsed = StampSalesSearchSchema.safeParse(rawInput ?? {})
    if (!parsed.success) throw new Error(parsed.error.message)
    return getService().listSales(parsed.data.query, parsed.data.fromDate, parsed.data.toDate, role)
  }))

  ipcMain.handle('stamp:sales:detail', (_event, rawInput: unknown) => authenticated((_userId, role) => {
    const parsed = StampDocumentReadSchema.pick({ saleId: true }).safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getService().getSaleDetail(parsed.data.saleId, role)
  }))

  ipcMain.handle('stamp:payments:create', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = StampPaymentCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getService().recordPayment(parsed.data)
  }))

  ipcMain.handle('stamp:sales:cancel', (_event, rawInput: unknown) => authenticated((_userId, role) => {
    const parsed = StampSaleCancelSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    requireManager(role)
    getService().cancelSale(parsed.data.saleId, parsed.data.reason, parsed.data.refundMethod)
    return null
  }))

  ipcMain.handle('stamp:documents:stage', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = StampDocumentPickSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getService().stageDocument(parsed.data, userId)
  }))

  ipcMain.handle('stamp:documents:discard', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = StampDocumentDiscardSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    getService().discardStagedDocument(parsed.data.token)
    return null
  }))

  ipcMain.handle('stamp:documents:list', (_event, rawInput: unknown) => authenticated((_userId, role) => {
    requireManager(role)
    const parsed = StampDocumentReadSchema.pick({ saleId: true }).safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getService().listDocuments(parsed.data.saleId)
  }))

  ipcMain.handle('stamp:documents:read', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = StampDocumentReadSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getService().readDocument(parsed.data.saleId, parsed.data.id, userId)
  }))

  ipcMain.handle('stamp:documents:remove', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = StampDocumentDeleteSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    getService().removeDocument(parsed.data.saleId, parsed.data.id, userId)
    return null
  }))

  ipcMain.handle('simple-stamp:create', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = SimpleStampSaleCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getService().createSimpleSale(parsed.data)
  }))

  ipcMain.handle('simple-stamp:update', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = SimpleStampSaleUpdateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getService().updateSimpleSale(parsed.data)
  }))

  ipcMain.handle('simple-stamp:list', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = StampSalesSearchSchema.safeParse(rawInput ?? {})
    if (!parsed.success) throw new Error(parsed.error.message)
    return getService().listSimpleSales(parsed.data.query, parsed.data.fromDate, parsed.data.toDate)
  }))

  ipcMain.handle('simple-stamp:list-export', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = StampSalesSearchSchema.safeParse(rawInput ?? {})
    if (!parsed.success) throw new Error(parsed.error.message)
    return getService().listSimpleSalesForExport(parsed.data.query, parsed.data.fromDate, parsed.data.toDate)
  }))

  ipcMain.handle('simple-stamp:detail', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = z.object({ stampId: z.number().int().positive() }).safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getService().getSimpleSale(parsed.data.stampId)
  }))

  ipcMain.handle('simple-stamp:payment', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = SimpleStampPaymentCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getService().recordSimplePayment({ ...parsed.data, saleId: parsed.data.saleId })
  }))

  ipcMain.handle('simple-stamp:cancel', (_event, rawInput: unknown) => authenticated((_userId, role) => {
    const parsed = SimpleStampRefundCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return getService().cancelSimpleSale(parsed.data, role)
  }))

  ipcMain.handle('simple-stamp:issue', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = z.object({ stampId: z.number().int().positive() }).safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    getService().markSimpleSaleIssued(parsed.data.stampId)
    return null
  }))

  ipcMain.handle('simple-stamp:export-excel', async (_event, rawContent: unknown) => {
    const user = getCurrentUser()
    if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
    try {
      if (!(rawContent instanceof Uint8Array) || rawContent.byteLength === 0 || rawContent.byteLength > 25 * 1024 * 1024) {
        throw new Error('The Excel export is invalid or too large')
      }
      const result = await dialog.showSaveDialog({
        title: 'Export stamp-paper history',
        defaultPath: path.join(app.getPath('documents'), 'stamp-paper-history.xlsx'),
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
      })
      if (result.canceled || !result.filePath) return { ok: true, data: { saved: false } }
      await writeFile(result.filePath, rawContent)
      return { ok: true, data: { saved: true } }
    } catch (error) {
      return { ok: false, error: { code: 'STAMP_ERROR', message: error instanceof Error ? error.message : 'Excel export failed' } }
    }
  })

  ipcMain.handle('simple-stamp:document-stage', (_event, rawInput: unknown) => authenticated((userId) => {
    const parsed = StampDocumentPickSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    if (parsed.data.category !== 'SUPPORTING') throw new Error('Only transaction attachments are supported')
    return getService().stageDocument(parsed.data, userId)
  }))

  ipcMain.handle('simple-stamp:document-discard', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = StampDocumentDiscardSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    getService().discardStagedDocument(parsed.data.token)
    return null
  }))

  ipcMain.handle('simple-stamp:document-read', (_event, rawInput: unknown) => authenticated((userId, role) => {
    const parsed = StampDocumentReadSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    requireManager(role)
    return getService().readSimpleDocument(parsed.data.saleId, parsed.data.id, userId)
  }))

  ipcMain.handle('simple-stamp:document-remove', (_event, rawInput: unknown) => authenticated((userId, role) => {
    const parsed = StampDocumentDeleteSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    requireManager(role)
    getService().removeSimpleDocument(parsed.data.saleId, parsed.data.id, userId)
    return null
  }))
}
