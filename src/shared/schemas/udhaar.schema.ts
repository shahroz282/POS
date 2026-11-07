import { z } from 'zod'

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))
const isoDate = z.string().date()

export const UdhaarCustomerCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: optionalText(30),
  address: optionalText(500)
})
export type UdhaarCustomerCreate = z.infer<typeof UdhaarCustomerCreateSchema>

export const UdhaarSearchSchema = z.object({
  query: z.string().trim().max(100).default(''),
  status: z.enum(['OUTSTANDING', 'SETTLED']).optional()
})
export const UdhaarCustomerIdSchema = z.number().int().positive()

export const UdhaarEntrySearchSchema = z.object({
  customerId: UdhaarCustomerIdSchema
})

export const UdhaarEntryCreateSchema = z.object({
  customerId: UdhaarCustomerIdSchema,
  idempotencyKey: z.string().uuid(),
  amount: z.number().int().positive().max(100_000_000),
  note: optionalText(500),
  entryDate: isoDate
})
export type UdhaarEntryCreate = z.infer<typeof UdhaarEntryCreateSchema>

export const UdhaarRepaymentCreateSchema = UdhaarEntryCreateSchema.extend({
  method: z.enum(['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH']),
  referenceNumber: optionalText(100)
})
export type UdhaarRepaymentCreate = z.infer<typeof UdhaarRepaymentCreateSchema>

export type UdhaarCustomerRow = {
  id: number
  name: string
  phone: string | null
  address: string | null
  total_charges: number
  total_repayments: number
  balance: number
  status: 'OUTSTANDING' | 'SETTLED'
  last_activity: string | null
}

export type UdhaarEntryRow = {
  id: number
  type: 'CHARGE' | 'REPAYMENT'
  amount: number
  note: string | null
  entry_date: string
  created_at: string
  sale_id: number | null
  invoice_no: string | null
  receipt_no: string | null
  method: string | null
  reference_no: string | null
  created_by_name: string
}

export type UdhaarRepaymentResult = {
  id: number
  receiptNumber: string
  amount: number
  balance: number
  entryDate: string
  method: 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH'
  referenceNumber: string | null
  customerName: string
}

export type UdhaarOutstandingItem = {
  id: string
  source: 'UDHAAR' | 'ADMISSION' | 'SCHEME' | 'STAMP' | 'FILER'
  sourceLabel: string
  personName: string
  phone: string | null
  detail: string
  reference: string | null
  totalAmount: number
  paidAmount: number
  balance: number
  entryDate: string | null
}

export type UdhaarOutstandingSourceRow = UdhaarOutstandingItem & {
  identityCnic: string | null
}

export type UdhaarOutstandingGroup = {
  id: string
  name: string
  phone: string | null
  totalOutstanding: number
  items: UdhaarOutstandingItem[]
}
