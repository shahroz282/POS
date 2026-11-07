import { z } from 'zod'
import { SchemeApplicationStatusValues as ApplicationStatusValues } from '@shared/constants'

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))
const isoDate = z.string().date()

export const SchemeLifecycleStatus = ['ACTIVE', 'CLOSED', 'SUSPENDED'] as const
export const SchemeApplicationStatus = ApplicationStatusValues
export const SchemePaymentMethod = ['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH', 'OTHER'] as const

const SchemeFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  schemeCode: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase()),
  category: optionalText(100),
  description: optionalText(1000),
  startDate: isoDate.optional().or(z.literal('')),
  endDate: isoDate.optional().or(z.literal('')),
  defaultFee: z.number().int().nonnegative().max(100_000_000),
  lifecycleStatus: z.enum(SchemeLifecycleStatus).default('ACTIVE')
})

const validSchemeDates = <T extends { startDate?: string; endDate?: string }>(value: T) =>
  !value.startDate || !value.endDate || value.startDate <= value.endDate

export const SchemeCreateSchema = SchemeFieldsSchema.refine(validSchemeDates, {
  message: 'Closing date must be on or after opening date.',
  path: ['endDate']
})
export type SchemeCreate = z.infer<typeof SchemeCreateSchema>

export const SchemeIdSchema = z.number().int().positive()
export const SchemeApplicationIdSchema = z.number().int().positive()
export const SchemeUpdateSchema = SchemeFieldsSchema.extend({ schemeId: SchemeIdSchema }).refine(validSchemeDates, {
  message: 'Closing date must be on or after opening date.',
  path: ['endDate']
})
export type SchemeUpdate = z.infer<typeof SchemeUpdateSchema>
export const SchemeLifecycleUpdateSchema = z.object({
  schemeId: SchemeIdSchema,
  lifecycleStatus: z.enum(SchemeLifecycleStatus)
})
export const SchemeCategoryCreateSchema = z.object({
  schemeId: SchemeIdSchema,
  name: z.string().trim().min(1).max(100)
})
export type SchemeCategoryCreate = z.infer<typeof SchemeCategoryCreateSchema>

export const SchemeCustomFieldType = ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'CHECKBOX'] as const
export const SchemeCustomFieldCreateSchema = z.object({
  schemeId: SchemeIdSchema,
  fieldKey: z.string().trim().min(1).max(40).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string().trim().min(1).max(100),
  fieldType: z.enum(SchemeCustomFieldType),
  options: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  isRequired: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0)
}).refine((value) => value.fieldType !== 'SELECT' || value.options.length > 0, {
  message: 'Select fields must define at least one option.',
  path: ['options']
})
export type SchemeCustomFieldCreate = z.infer<typeof SchemeCustomFieldCreateSchema>

export const SchemeDocumentRequirementCreateSchema = z.object({
  schemeId: SchemeIdSchema,
  name: z.string().trim().min(1).max(100),
  isRequired: z.boolean().default(false)
})
export type SchemeDocumentRequirementCreate = z.infer<typeof SchemeDocumentRequirementCreateSchema>

export interface SchemeCustomFieldRow {
  id: number
  field_key: string
  label: string
  field_type: typeof SchemeCustomFieldType[number]
  options_json: string | null
  is_required: number
}

export const SchemeApplicationCreateSchema = z.object({
  schemeId: SchemeIdSchema,
  applicantName: z.string().trim().min(1).max(100),
  fatherName: optionalText(100),
  cnic: z.string().trim().min(13).max(15).regex(/^\d{5}-?\d{7}-?\d$/, 'Enter a valid 13-digit CNIC.'),
  mobile: optionalText(30).refine(
    (value) => !value || (/^[\d +().-]+$/.test(value) && value.replace(/\D/g, '').length >= 7 && value.replace(/\D/g, '').length <= 15),
    'Enter a valid phone number.'
  ),
  address: optionalText(500),
  city: optionalText(100),
  district: optionalText(100),
  category: optionalText(100),
  purpose: optionalText(500),
  applicationDate: isoDate,
  applicationFee: z.number().int().nonnegative().max(100_000_000).optional(),
  discountAmount: z.number().int().nonnegative().max(100_000_000).default(0),
  remarks: optionalText(1000),
  customFields: z.record(z.string().max(100), z.string().max(1000)).default({})
}).refine((value) => value.discountAmount <= (value.applicationFee ?? 100_000_000), {
  message: 'Discount cannot exceed the application fee.',
  path: ['discountAmount']
})
export type SchemeApplicationCreate = z.infer<typeof SchemeApplicationCreateSchema>

export const SchemeApplicationUpdateSchema = z.object({
  applicationId: SchemeApplicationIdSchema,
  applicantName: z.string().trim().min(1).max(100),
  fatherName: optionalText(100),
  cnic: z.string().trim().min(13).max(15).regex(/^\d{5}-?\d{7}-?\d$/, 'Enter a valid 13-digit CNIC.'),
  mobile: optionalText(30).refine(
    (value) => !value || (/^[\d +().-]+$/.test(value) && value.replace(/\D/g, '').length >= 7 && value.replace(/\D/g, '').length <= 15),
    'Enter a valid phone number.'
  ),
  address: optionalText(500),
  city: optionalText(100),
  district: optionalText(100),
  category: optionalText(100),
  purpose: optionalText(500),
  remarks: optionalText(1000)
})
export type SchemeApplicationUpdate = z.infer<typeof SchemeApplicationUpdateSchema>

export const SchemeApplicationSearchSchema = z.object({
  query: z.string().trim().max(100).default(''),
  schemeId: SchemeIdSchema.optional(),
  status: z.enum(SchemeApplicationStatus).optional(),
  fromDate: isoDate.optional(),
  toDate: isoDate.optional(),
  paymentStatus: z.enum(['UNPAID', 'PARTIAL', 'PAID']).optional()
}).refine((value) => !value.fromDate || !value.toDate || value.fromDate <= value.toDate, {
  message: 'Start date must be on or before end date.'
})
export type SchemeApplicationSearch = z.infer<typeof SchemeApplicationSearchSchema>

export const SchemeApplicationStatusUpdateSchema = z.object({
  applicationId: SchemeApplicationIdSchema,
  status: z.enum(SchemeApplicationStatus),
  remarks: optionalText(500)
})
export type SchemeApplicationStatusUpdate = z.infer<typeof SchemeApplicationStatusUpdateSchema>

export const SchemePaymentCreateSchema = z.object({
  applicationId: SchemeApplicationIdSchema,
  idempotencyKey: z.string().uuid(),
  amount: z.number().int().positive().max(100_000_000),
  method: z.enum(SchemePaymentMethod),
  referenceNumber: optionalText(100),
  notes: optionalText(500)
})
export type SchemePaymentCreate = z.infer<typeof SchemePaymentCreateSchema>

export const SchemePaymentReverseSchema = z.object({
  paymentId: z.number().int().positive(),
  reason: z.string().trim().min(3).max(500)
})

export const SchemeDocumentCategory = ['CNIC_FRONT', 'CNIC_BACK', 'APPLICANT_PHOTO', 'APPLICATION_FORM', 'SUPPORTING', 'OTHER'] as const
export type SchemeDocumentCategoryType = typeof SchemeDocumentCategory[number]
export const SchemeDocumentStageSchema = z.object({
  category: z.enum(SchemeDocumentCategory),
  originalFilename: z.string().trim().min(1).max(180),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  contentBase64: z.string().min(1).max(16 * 1024 * 1024)
})
export const SchemeDocumentCommitSchema = z.object({
  applicationId: SchemeApplicationIdSchema,
  token: z.string().uuid(),
  replaceDocumentId: z.number().int().positive().optional(),
  requirementId: z.number().int().positive().optional()
})
export const SchemeDocumentDiscardSchema = z.object({ token: z.string().uuid() })
export const SchemeDocumentReadSchema = z.object({
  applicationId: SchemeApplicationIdSchema,
  documentId: z.number().int().positive()
})
export const SchemeDocumentRemoveSchema = z.object({
  applicationId: SchemeApplicationIdSchema,
  documentId: z.number().int().positive()
})

export interface SchemeDocumentRow {
  id: number
  category: SchemeDocumentCategoryType
  requirement_id: number | null
  requirement_name: string | null
  original_filename: string
  mime_type: string
  file_size: number
  uploaded_at: string
}

export interface SchemeRow {
  id: number
  name: string
  scheme_code: string
  category: string | null
  description: string | null
  start_date: string | null
  end_date: string | null
  default_fee: number
  lifecycle_status: typeof SchemeLifecycleStatus[number]
  application_count: number
  today_applications: number
  fees_collected: number
  outstanding: number
}

export interface SchemeApplicationRow {
  id: number
  application_no: string
  scheme_id: number
  scheme_name: string
  scheme_code: string
  applicant_name: string
  father_name: string | null
  cnic: string | null
  mobile: string | null
  address: string | null
  city: string | null
  district: string | null
  category: string | null
  purpose: string | null
  application_date: string
  application_fee: number
  discount_amount: number
  status: typeof SchemeApplicationStatus[number]
  remarks: string | null
  total_paid: number
  balance: number
}

export interface SchemePaymentRow {
  id: number
  receipt_no: string
  amount: number
  method: typeof SchemePaymentMethod[number]
  reference_no: string | null
  notes: string | null
  paid_at: string
  balance_after: number | null
  reversed: number
  reversal_reason: string | null
}

export interface SchemeApplicationDetail extends SchemeApplicationRow {
  custom_fields_json: string
  payments: SchemePaymentRow[]
  status_history: Array<{
    id: number
    from_status: string | null
    to_status: string
    remarks: string | null
    changed_by_name: string
    changed_at: string
  }>
}

export interface SchemesSummary {
  totalSchemes: number
  activeSchemes: number
  closedSchemes: number
  totalApplications: number
  todayApplications: number
  monthApplications: number
  pendingApplications: number
  approvedApplications: number
  rejectedApplications: number
  todayCollection: number
  monthCollection: number
  outstanding: number
  recentPayments: Array<{
    id: number
    receipt_no: string
    application_no: string
    applicant_name: string
    scheme_name: string
    amount: number
    method: typeof SchemePaymentMethod[number]
    paid_at: string
    reversed: number
  }>
}

export interface SchemePaymentResult {
  receiptNumber: string
  amount: number
  balance: number
  paidAt: string
  method: typeof SchemePaymentMethod[number]
  referenceNumber: string | null
}
