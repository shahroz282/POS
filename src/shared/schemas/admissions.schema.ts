import { z } from 'zod'

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))
const optionalIdentity = optionalText(20).refine(
  (value) => !value || /^\d{5}-?\d{7}-?\d$/.test(value),
  'Enter a valid 13-digit CNIC/B-Form number.'
)
const optionalPhone = optionalText(30).refine(
  (value) => !value || (/^[\d +().-]+$/.test(value) && value.replace(/\D/g, '').length >= 7 && value.replace(/\D/g, '').length <= 15),
  'Enter a valid phone number.'
)
const isoDate = z.string().date()

export const AdmissionClassCreateSchema = z.object({
  className: z.string().trim().min(1).max(80),
  academicYear: z.string().trim().min(4).max(20),
  admissionFee: z.number().int().nonnegative().max(100_000_000).default(0)
})
export type AdmissionClassCreate = z.infer<typeof AdmissionClassCreateSchema>

export const AdmissionStudentCreateSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  fatherName: z.string().trim().min(1).max(100),
  fatherCnic: optionalIdentity,
  bFormNumber: optionalIdentity,
  phone: optionalPhone,
  fatherPhone: optionalPhone,
  whatsapp: optionalPhone,
  dateOfBirth: isoDate.optional().or(z.literal('')),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  address: optionalText(500),
  classId: z.number().int().positive(),
  admissionDate: isoDate,
  program: optionalText(100),
  educationBoard: optionalText(100),
  admissionFee: z.number().int().nonnegative().max(100_000_000).default(0),
  admissionDiscount: z.number().int().nonnegative().max(100_000_000).default(0),
  admissionFeeDueDate: isoDate.optional().or(z.literal(''))
}).refine((value) => value.admissionDiscount <= value.admissionFee, {
  message: 'Discount cannot exceed the admission fee.',
  path: ['admissionDiscount']
})
export type AdmissionStudentCreate = z.infer<typeof AdmissionStudentCreateSchema>

export const AdmissionStudentSearchSchema = z.object({
  query: z.string().trim().max(100).default(''),
  classId: z.number().int().positive().optional()
})
export const AdmissionIdSchema = z.number().int().positive()

export const AdmissionPaymentCreateSchema = z.object({
  admissionId: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
  amount: z.number().int().positive().max(100_000_000),
  method: z.enum(['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH']),
  referenceNumber: optionalText(100),
  notes: optionalText(500)
})
export type AdmissionPaymentCreate = z.infer<typeof AdmissionPaymentCreateSchema>

export interface AdmissionClassRow {
  id: number
  class_name: string
  academic_year: string
  student_count: number
  admission_fee: number
}

export interface AdmissionStudentRow {
  admission_id: number
  student_id: number
  student_no: string
  full_name: string
  father_name: string
  father_cnic: string | null
  b_form_number: string | null
  phone: string | null
  father_phone: string | null
  whatsapp: string | null
  date_of_birth: string | null
  gender: string | null
  address: string | null
  class_id: number
  class_name: string
  academic_year: string
  admission_date: string
  program: string | null
  education_board: string | null
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  total_charges: number
  total_discounts: number
  total_paid: number
  balance: number
}

export interface AdmissionChargeRow {
  id: number
  fee_type: string
  description: string | null
  amount: number
  discount_amount: number
  fee_month: string | null
  due_date: string | null
  paid_amount: number
  balance: number
}

export interface AdmissionPaymentRow {
  id: number
  receipt_no: string
  amount: number
  method: 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH'
  reference_no: string | null
  notes: string | null
  paid_at: string
  balance_after: number | null
}

export interface AdmissionDetail extends AdmissionStudentRow {
  charges: AdmissionChargeRow[]
  payments: AdmissionPaymentRow[]
}

export interface AdmissionPaymentResult {
  receiptNumber: string
  amount: number
  balance: number
  paidAt: string
  method: 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH'
  referenceNumber: string | null
}
