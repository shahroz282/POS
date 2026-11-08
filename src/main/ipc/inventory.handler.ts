import { ipcMain } from 'electron'
import type { IpcResult } from '@shared/types'
import {
  InventoryAdjustmentCreateSchema, InventoryProductCreateSchema,
  InventoryProductUpdateSchema, InventoryPurchaseCreateSchema, InventorySearchSchema,
  InventorySupplierCreateSchema, SaleCreateSchema, SaleReturnCreateSchema, SaleSearchSchema
} from '@shared/schemas'
import { getDb } from '../db/connection'
import { getCurrentUser } from '../services/session'
import { InventoryService } from '../services/inventory.service'

function authenticated<T>(operation: (userId: number, role: string) => T): IpcResult<T> {
  const user = getCurrentUser()
  if (!user) return { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'Not logged in' } }
  try {
    return { ok: true, data: operation(user.id, user.role) }
  } catch (error) {
    return {
      ok: false,
      error: { code: 'INVENTORY_ERROR', message: error instanceof Error ? error.message : 'Inventory operation failed' }
    }
  }
}

function requireManager(role: string): void {
  if (role === 'CASHIER') throw new Error('Admin or Manager permission is required')
}

export function registerInventoryHandlers(): void {
  ipcMain.handle('inventory:summary', () => authenticated((_userId, role) =>
    new InventoryService(getDb()).summary(role !== 'CASHIER')))
  ipcMain.handle('inventory:products:list', (_event, rawInput: unknown) => authenticated((_userId, role) => {
    const parsed = InventorySearchSchema.safeParse(rawInput ?? {})
    if (!parsed.success) throw new Error(parsed.error.message)
    if (parsed.data.includeArchived && role === 'CASHIER') throw new Error('Admin or Manager permission is required')
    return new InventoryService(getDb()).products(parsed.data.query, !parsed.data.includeArchived, role !== 'CASHIER')
  }))
  ipcMain.handle('inventory:products:create', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = InventoryProductCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return { id: new InventoryService(getDb()).createProduct(parsed.data, userId) }
  }))
  ipcMain.handle('inventory:products:update', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = InventoryProductUpdateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    new InventoryService(getDb()).updateProduct(parsed.data, userId)
    return null
  }))
  ipcMain.handle('inventory:products:active', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    if (!rawInput || typeof rawInput !== 'object') throw new Error('Select a product')
    const input = rawInput as { id?: unknown; active?: unknown }
    if (typeof input.id !== 'number' || !Number.isInteger(input.id) || input.id < 1 || typeof input.active !== 'boolean') {
      throw new Error('Select a valid product and status')
    }
    new InventoryService(getDb()).setProductActive(input.id, input.active, userId)
    return null
  }))
  ipcMain.handle('inventory:suppliers:list', () => authenticated((_userId, role) => {
    requireManager(role)
    return new InventoryService(getDb()).suppliers()
  }))
  ipcMain.handle('inventory:suppliers:create', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = InventorySupplierCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return { id: new InventoryService(getDb()).createSupplier(parsed.data, userId) }
  }))
  ipcMain.handle('inventory:purchases:list', () => authenticated((_userId, role) => {
    requireManager(role)
    return new InventoryService(getDb()).purchases()
  }))
  ipcMain.handle('inventory:purchases:create', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = InventoryPurchaseCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return new InventoryService(getDb()).createPurchase(parsed.data, userId)
  }))
  ipcMain.handle('inventory:adjustments:create', (_event, rawInput: unknown) => authenticated((userId, role) => {
    requireManager(role)
    const parsed = InventoryAdjustmentCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    new InventoryService(getDb()).adjustStock(parsed.data, userId)
    return null
  }))
  ipcMain.handle('inventory:movements:list', () => authenticated(() => new InventoryService(getDb()).movements()))

  ipcMain.handle('sales:create', (_event, rawInput: unknown) => authenticated((userId, role) => {
    const parsed = SaleCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return new InventoryService(getDb()).createSale(parsed.data, userId, role)
  }))
  ipcMain.handle('sales:list', (_event, rawInput: unknown) => authenticated(() => {
    const parsed = SaleSearchSchema.safeParse(rawInput ?? {})
    if (!parsed.success) throw new Error(parsed.error.message)
    return new InventoryService(getDb()).sales(parsed.data)
  }))
  ipcMain.handle('sales:detail', (_event, rawInput: unknown) => authenticated(() => {
    if (!rawInput || typeof rawInput !== 'object' ||
      typeof (rawInput as { id?: unknown }).id !== 'number' ||
      !Number.isInteger((rawInput as { id: number }).id) || (rawInput as { id: number }).id < 1) {
      throw new Error('Select a valid sale')
    }
    return new InventoryService(getDb()).saleDetail((rawInput as { id: number }).id)
  }))
  ipcMain.handle('sales:return', (_event, rawInput: unknown) => authenticated((userId, role) => {
    const parsed = SaleReturnCreateSchema.safeParse(rawInput)
    if (!parsed.success) throw new Error(parsed.error.message)
    return new InventoryService(getDb()).createSaleReturn(parsed.data, userId, role)
  }))
}
