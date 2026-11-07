import { z } from 'zod'

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))
const isoDate = z.string().date()

const cnic = z.string().trim().regex(
  /^\d{5}-?\d{7}-?\d$/,
  'Enter a valid 13-digit CNIC.'
).transform((value) => {
  const digits = value.replace(/\D/g, '')
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`
})

const mobile = optionalText(30).refine(
  (value) => !value || (/^[\d +().-]+$/.test(value) && value.replace(/\D/g, '').length >= 7 && value.replace(/\D/g, '').length <= 15),
  'Enter a valid phone number.'
)

const customerFields = z.object({
  customerName: z.string().trim().min(1).max(120),
  cnic,
  mobile,
  filingDate: isoDate,
  category: z.enum(['FRESH_FILER', 'ANNUAL_RETURN', 'OTHER_SERVICES']),
  totalFee: z.number().int().nonnegative().max(100_000_000),
  advancePaid: z.number().int().nonnegative().max(100_000_000)
})

const validAdvance = (value: { advancePaid: number; totalFee: number }) => value.advancePaid <= value.totalFee
const advanceError: { message: string; path: (string | number)[] } = {
  message: 'Advance paid cannot exceed the total fee.',
  path: ['advancePaid']
}

export const FilerCustomerCreateSchema = customerFields.refine(validAdvance, advanceError)
export type FilerCustomerCreate = z.infer<typeof FilerCustomerCreateSchema>

export const FilerCustomerUpdateSchema = customerFields.extend({
  customerId: z.number().int().positive()
}).refine(validAdvance, advanceError)
export type FilerCustomerUpdate = z.infer<typeof FilerCustomerUpdateSchema>

export const FilerCustomerSearchSchema = z.object({
  query: z.string().trim().max(100).default(''),
  paymentStatus: z.enum(['PENDING', 'DONE']).optional()
})

export const FilerCustomerIdSchema = z.number().int().positive()

export const FilerCustomerDocumentStageSchema = z.object({
  originalFilename: z.string().trim().min(1).max(180),
  mimeType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  contentBase64: z.string().min(1).max(14_000_000)
})

export const FilerCustomerDocumentTokenSchema = z.object({ token: z.string().uuid() })
export const FilerCustomerDocumentCommitSchema = z.object({
  customerId: FilerCustomerIdSchema,
  token: z.string().uuid()
})
export const FilerCustomerDocumentReadSchema = z.object({
  customerId: FilerCustomerIdSchema,
  documentId: FilerCustomerIdSchema
})

export type FilerCustomerDocumentRow = {
  id: number
  original_filename: string
  mime_type: 'image/jpeg' | 'image/png' | 'application/pdf'
  file_size: number
  uploaded_at: string
}

export type FilerCustomerRow = {
  id: number
  customer_name: string
  cnic: string
  mobile: string | null
  filing_date: string
  category: 'FRESH_FILER' | 'ANNUAL_RETURN' | 'OTHER_SERVICES'
  total_fee: number
  advance_paid: number
  pending_balance: number
  payment_status: 'PENDING' | 'DONE'
  proof_document_id: number | null
  proof_filename: string | null
  created_at: string
  updated_at: string
}
