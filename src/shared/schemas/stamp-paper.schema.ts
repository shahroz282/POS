import { z } from 'zod'

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))
const cnicSchema = optionalText(30).refine(
  (value) => !value || (/^[\d\s-]+$/.test(value) && value.replace(/\D/g, '').length === 13),
  'Enter CNIC as XXXXX-XXXXXXX-X'
)

export const StampPartyInputSchema = z.object({
  partyId: z.number().int().positive().optional(),
  updateExisting: z.boolean().optional().default(false),
  fullName: z.string().trim().min(1).max(100),
  fatherOrHusbandName: optionalText(100),
  cnicNumber: cnicSchema,
  mobileNumber: optionalText(30),
  address: optionalText(300),
  city: optionalText(100),
  district: optionalText(100)
})
export type StampPartyInput = z.infer<typeof StampPartyInputSchema>

export const StampInventoryCreateSchema = z.object({
  itemType: z.string().trim().min(1).max(100),
  denominationPaisa: z.number().int().positive().max(100_000_000),
  serialNumber: z.string().trim().min(1).max(100),
  registerNumber: optionalText(100),
  bookNumber: optionalText(100),
  issuingSource: optionalText(150),
  vendorEmployeeName: optionalText(100),
  purchaseCostPaisa: z.number().int().nonnegative().max(100_000_000),
  salePricePaisa: z.number().int().nonnegative().max(100_000_000)
})
export type StampInventoryCreate = z.infer<typeof StampInventoryCreateSchema>

export const StampPaperSaleCreateSchema = z.object({
  transactionId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  inventoryId: z.number().int().positive(),
  firstParty: StampPartyInputSchema,
  secondParty: StampPartyInputSchema,
  documentPurpose: z.string().trim().min(1).max(500),
  documentReferenceNumber: optionalText(100),
  serviceChargesPaisa: z.number().int().nonnegative().max(100_000_000),
  otherFeesPaisa: z.number().int().nonnegative().max(100_000_000),
  amountReceivedPaisa: z.number().int().nonnegative().max(100_000_000),
  paymentMethod: z.enum(['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH']),
  paymentReferenceNumber: optionalText(100),
  paymentRemarks: optionalText(500),
  remarks: optionalText(1000),
  stagedDocumentTokens: z.array(z.string().uuid()).max(20).default([])
})
export type StampPaperSaleCreate = z.infer<typeof StampPaperSaleCreateSchema>

export const StampPaymentCreateSchema = z.object({
  saleId: z.number().int().positive(),
  amountPaisa: z.number().int().positive().max(100_000_000),
  method: z.enum(['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH']),
  referenceNumber: optionalText(100),
  remarks: optionalText(500)
})
export type StampPaymentCreate = z.infer<typeof StampPaymentCreateSchema>

export const StampInventorySearchSchema = z.object({
  query: z.string().trim().max(100).optional().default('')
})

export const StampSalesSearchSchema = z.object({
  query: z.string().trim().max(150).optional().default(''),
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional()
})

export const StampDocumentPickSchema = z.object({
  category: z.enum(['FIRST_PHOTO', 'FIRST_CNIC_FRONT', 'FIRST_CNIC_BACK', 'SECOND_PHOTO', 'SECOND_CNIC_FRONT', 'SECOND_CNIC_BACK', 'SUPPORTING']),
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  contentBase64: z.string().min(1).max(14_000_000)
})

export const StampDocumentReadSchema = z.object({ saleId: z.number().int().positive(), id: z.number().int().positive() })
export const StampDocumentDeleteSchema = StampDocumentReadSchema
export const StampDocumentDiscardSchema = z.object({ token: z.string().uuid() })
export const StampSaleCancelSchema = z.object({
  saleId: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500),
  refundMethod: z.enum(['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH']).optional()
})
export const StampPartySearchSchema = z.object({ query: z.string().trim().min(1).max(100) })

export interface StampSaleListRow {
  id: number
  transaction_id: string
  invoice_number: string
  transaction_date: string
  status: 'COMPLETED' | 'CANCELLED'
  first_party_name: string
  second_party_name: string
  serial_number: string
  denomination_paisa: number
  total_payable_paisa: number
  amount_received_paisa: number
  outstanding_balance_paisa: number
}

export interface StampPartySummary {
  id: number
  full_name: string
  father_or_husband_name: string | null
  cnic_number: string | null
  mobile_number: string | null
  address: string | null
  city: string | null
  district: string | null
}

export interface StampPaymentRow {
  id: number
  receipt_number: string
  amount_paisa: number
  method: 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH'
  reference_number: string | null
  remarks: string | null
  paid_at: string
}

export interface StampRefundRow {
  id: number
  amount_paisa: number
  method: 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH'
  remarks: string | null
  created_at: string
}

export interface StampSaleDetail extends StampSaleListRow {
  document_purpose: string
  document_reference_number: string | null
  service_charges_paisa: number
  other_fees_paisa: number
  remarks: string | null
  item_type: string
  purchase_cost_paisa: number | null
  issuing_source: string | null
  register_number: string | null
  book_number: string | null
  first_party: StampPartySummary
  second_party: StampPartySummary
  payments: StampPaymentRow[]
  refunds: StampRefundRow[]
}

export interface StampInventoryRow {
  id: number
  item_type: string
  denomination_paisa: number
  serial_number: string
  register_number: string | null
  book_number: string | null
  issuing_source: string | null
  vendor_employee_name: string | null
  purchase_cost_paisa: number | null
  sale_price_paisa: number
  status: 'AVAILABLE' | 'SOLD' | 'VOID'
}

export interface StampDocumentRow {
  id: number
  sale_id: number
  party_id: number | null
  category: string
  original_filename: string
  mime_type: 'image/jpeg' | 'image/png' | 'application/pdf'
  file_size: number
  created_at: string
}

export const SimpleStampSaleCreateSchema = z.object({
  transactionId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  referenceName: z.string().trim().min(1).max(150),
  hasTicketNumber: z.boolean().default(false),
  customerName: z.string().trim().min(1).max(150),
  registration: z.string({ required_error: 'Enter the registration.' })
    .trim()
    .min(1, 'Enter the registration.')
    .max(150, 'Registration must be 150 characters or fewer.'),
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED']),
  salePricePaisa: z.number().int().nonnegative().max(100_000_000),
  serviceChargesPaisa: z.number().int().nonnegative().max(100_000_000),
  otherFeesPaisa: z.number().int().nonnegative().max(100_000_000),
  amountReceivedPaisa: z.number().int().nonnegative().max(100_000_000),
  paymentMethod: z.enum(['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH']),
  paymentReferenceNumber: optionalText(100),
  paymentRemarks: optionalText(500),
  remarks: optionalText(1000),
  stagedDocumentTokens: z.array(z.string().uuid()).max(20).default([])
})
export type SimpleStampSaleCreate = z.infer<typeof SimpleStampSaleCreateSchema>

export const SimpleStampPaymentCreateSchema = StampPaymentCreateSchema

export interface SimpleStampSaleRow {
  id: number
  transaction_id: string
  invoice_number: string
  transaction_date: string
  reference_name: string
  ticket_number: string | null
  has_ticket_number: number
  customer_name: string
  registration: string
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED'
  sale_price_paisa: number
  service_charges_paisa: number
  other_fees_paisa: number
  total_payable_paisa: number
  amount_received_paisa: number
  outstanding_balance_paisa: number
  remarks: string | null
}

export interface SimpleStampSaleDetail extends SimpleStampSaleRow {
  payments: StampPaymentRow[]
  documents: SimpleStampDocumentRow[]
}

export interface SimpleStampDocumentRow {
  id: number
  stamp_id: number
  original_filename: string
  mime_type: 'image/jpeg' | 'image/png' | 'application/pdf'
  file_size: number
  created_at: string
}