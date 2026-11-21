import { z } from 'zod'

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))
const idempotencyKey = z.string().uuid()
const isoDate = z.string().date()

export const PhotocopyCreateSchema = z.object({
  idempotencyKey,
  entryDate: isoDate.optional(),
  serviceType: z.enum(['MONO', 'COLOR']),
  pageCount: z.number().int().positive().max(100_000),
  copyCount: z.number().int().positive().max(10_000),
  duplex: z.boolean(),
  unitPrice: z.number().int().positive().max(10_000),
  customerName: optionalText(150),
  reference: optionalText(150),
  paymentMethod: z.enum(['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH'])
})
export type PhotocopyCreate = z.infer<typeof PhotocopyCreateSchema>

export const PhotocopySearchSchema = z.object({
  query: z.string().trim().max(150).default(''),
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional()
}).refine((value) => !value.fromDate || !value.toDate || value.fromDate <= value.toDate, {
  message: 'Start date must be on or before end date.',
  path: ['toDate']
})
export type PhotocopySearch = z.infer<typeof PhotocopySearchSchema>

export const PhotocopyRefundSchema = z.object({
  saleId: z.number().int().positive(),
  idempotencyKey,
  method: z.enum(['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH']),
  reason: z.string().trim().min(1).max(500)
})
export type PhotocopyRefund = z.infer<typeof PhotocopyRefundSchema>

export interface PhotocopySaleRow {
  id: number
  receipt_number: string
  service_type: 'MONO' | 'COLOR'
  page_count: number
  copy_count: number
  duplex: number
  unit_price: number
  total_amount: number
  amount_received: number
  outstanding: number
  customer_name: string | null
  reference: string | null
  status: 'COMPLETED' | 'CANCELLED'
  refund_amount: number
  refund_method: 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH' | null
  refund_reason: string | null
  created_at: string
}
