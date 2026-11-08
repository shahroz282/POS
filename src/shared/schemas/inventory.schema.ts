import { z } from 'zod'

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))
const positiveId = z.number().int().positive()
const quantity = z.number().int().positive().max(1_000_000)
const amount = z.number().int().min(0).max(100_000_000)
const isoDate = z.string().date()

export const InventorySearchSchema = z.object({
  query: z.string().trim().max(100).default(''),
  includeArchived: z.boolean().default(false)
})
export const InventoryProductIdSchema = positiveId

export const InventoryProductCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  purchasePrice: amount,
  salePrice: amount,
  lowStockLevel: z.number().int().min(0).max(1_000_000)
})
export type InventoryProductCreate = z.infer<typeof InventoryProductCreateSchema>

export const InventoryProductUpdateSchema = InventoryProductCreateSchema.extend({ id: positiveId })
export type InventoryProductUpdate = z.infer<typeof InventoryProductUpdateSchema>

export const InventorySupplierCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: optionalText(30)
})
export type InventorySupplierCreate = z.infer<typeof InventorySupplierCreateSchema>

export const InventoryPurchaseCreateSchema = z.object({
  idempotencyKey: z.string().uuid(),
  supplierId: positiveId.nullable().optional(),
  purchaseDate: isoDate,
  note: optionalText(500),
  items: z.array(z.object({
    productId: positiveId,
    quantity,
    unitCost: amount
  })).min(1).max(200)
})
export type InventoryPurchaseCreate = z.infer<typeof InventoryPurchaseCreateSchema>

export const InventoryAdjustmentCreateSchema = z.object({
  productId: positiveId,
  quantity: z.number().int().min(-1_000_000).max(1_000_000).refine((value) => value !== 0),
  reason: z.string().trim().min(2).max(300),
  adjustmentDate: isoDate
})
export type InventoryAdjustmentCreate = z.infer<typeof InventoryAdjustmentCreateSchema>

export const SaleCreateSchema = z.object({
  idempotencyKey: z.string().uuid(),
  customerId: positiveId.nullable().optional(),
  discount: amount,
  receivedAmount: amount,
  paymentMethod: z.enum(['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH']),
  items: z.array(z.object({ productId: positiveId, quantity })).min(1).max(200)
})
export type SaleCreate = z.infer<typeof SaleCreateSchema>

export const SaleSearchSchema = z.object({
  query: z.string().trim().max(100).default(''),
  fromDate: isoDate.optional(),
  toDate: isoDate.optional()
})

export const SaleReturnCreateSchema = z.object({
  saleId: positiveId,
  idempotencyKey: z.string().uuid(),
  refundMethod: z.enum(['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH', 'UDHAAR_ADJUST']),
  reason: z.string().trim().min(2).max(300),
  items: z.array(z.object({ saleItemId: positiveId, quantity })).min(1).max(200)
})
export type SaleReturnCreate = z.infer<typeof SaleReturnCreateSchema>

export type SaleReturnResult = {
  id: number
  saleId: number
  returnAmount: number
  creditAdjusted: number
  refundAmount: number
  refundMethod: string
  fullyReturned: boolean
}

export type InventoryProductRow = {
  id: number
  name: string
  purchase_price: number | null
  sale_price: number
  stock_qty: number
  low_stock_level: number
  is_active: number
}
export type InventorySupplierRow = { id: number; name: string; phone: string | null }
export type InventorySummary = {
  productCount: number
  lowStockCount: number
  stockValue: number | null
  todaySales: number
  todayPurchases: number | null
}
export type InventoryMovementRow = {
  id: number
  product_id: number
  product_name: string
  type: 'PURCHASE' | 'SALE' | 'RETURN' | 'ADJUSTMENT'
  quantity: number
  ref_type: string | null
  ref_id: number | null
  note: string | null
  created_by_name: string | null
  created_at: string
}
export type InventoryPurchaseRow = {
  id: number
  purchase_no: string
  supplier_name: string | null
  purchase_date: string
  total: number
  item_count: number
  note: string | null
  created_by_name: string
}
export type SaleRow = {
  id: number
  invoice_no: string
  customer_name: string | null
  subtotal: number
  discount: number
  total: number
  received_amount: number
  balance: number
  status: 'COMPLETED' | 'PARTIAL' | 'RETURNED'
  created_at: string
  created_by_name: string
}
export type SaleDetail = SaleRow & {
  customer_phone: string | null
  note: string | null
  returns: Array<{
    id: number
    return_amount: number
    refund_amount: number
    refund_method: string | null
    reason: string | null
    created_at: string
    created_by_name: string
  }>
  items: Array<{
    id: number
    product_id: number
    product_name: string
    quantity: number
    returned_quantity: number
    unit_price: number
    line_total: number
  }>
}
