import { z } from 'zod'

export const DailyClosingDateSchema = z.string().date()
export const DailyClosingRangeSchema = z.object({
  fromDate: DailyClosingDateSchema,
  toDate: DailyClosingDateSchema
}).refine((value) => value.fromDate <= value.toDate, {
  message: 'Start date must be on or before end date.',
  path: ['toDate']
})
export const DailyClosingSaveSchema = z.object({
  date: DailyClosingDateSchema,
  openingCash: z.number().int().min(0).max(100_000_000),
  openingReason: z.string().trim().max(500).optional().or(z.literal(''))
})
export const DailyClosingCloseSchema = DailyClosingSaveSchema.extend({
  actualCash: z.number().int().min(0).max(100_000_000)
})
export const DailyClosingExpenseCreateSchema = z.object({
  category: z.string().trim().min(1).max(100),
  amount: z.number().int().min(1).max(100_000_000),
  method: z.enum(['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH']),
  expenseDate: DailyClosingDateSchema,
  note: z.string().trim().max(500).optional().or(z.literal(''))
})
export const CashEntryCreateSchema = z.object({
  type: z.enum(['CASH_IN', 'CASH_OUT']),
  amount: z.number().int().positive().max(100_000_000),
  department: z.enum(['GENERAL', 'SALES', 'STAMP_PAPER', 'ADMISSIONS', 'SCHEMES', 'PHOTOCOPY', 'INVENTORY', 'FILER_CUSTOMERS', 'UDHAAR']),
  reason: z.string().trim().min(1).max(500),
  reference: z.string().trim().max(100).optional().or(z.literal('')),
  entryDate: DailyClosingDateSchema
})

export type DailyClosingSave = z.infer<typeof DailyClosingSaveSchema>
export type DailyClosingClose = z.infer<typeof DailyClosingCloseSchema>
export type DailyClosingRange = z.infer<typeof DailyClosingRangeSchema>
export type DailyClosingExpenseCreate = z.infer<typeof DailyClosingExpenseCreateSchema>
export type CashEntryCreate = z.infer<typeof CashEntryCreateSchema>
export const CashDepartmentSchema = z.enum([
  'GENERAL', 'SALES', 'STAMP_PAPER', 'ADMISSIONS', 'SCHEMES', 'PHOTOCOPY', 'INVENTORY', 'FILER_CUSTOMERS', 'UDHAAR'
])
export type CashDepartment = z.infer<typeof CashDepartmentSchema>
export type DailyClosingExpenseRow = {
  id: number
  category: string
  amount: number
  method: 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH'
  expense_date: string
  note: string | null
  created_by_name: string
}
export type CashEntryRow = {
  id: number
  type: 'CASH_IN' | 'CASH_OUT'
  amount: number
  department: CashDepartment
  reason: string
  reference: string | null
  entry_date: string
  created_at: string
  created_by_name: string
}
export type DailyClosingModule = {
  key: 'sales' | 'stampPaper' | 'admissions' | 'schemes' | 'udhaar' | 'photocopy'
  label: string
  transactionCount: number
  grossAmount: number
  cashReceived: number
  nonCashReceived: number
  unclassifiedReceived: number
  refunds: number
  outstanding: number
}
export type DashboardDailySummary = {
  modules: Array<Pick<DailyClosingModule,
    'key' | 'transactionCount' | 'grossAmount' | 'cashReceived' | 'nonCashReceived' | 'refunds' | 'outstanding'>>
  cashCalculation: {
    openingCash: number
    sectionReceipts: Array<{
      key: Exclude<DailyClosingModule['key'], 'udhaar'>
      label: string
      cashReceived: number
    }>
    udhaarCashRepayments: number
    filerCashReceiptsExcluded: number
    cashIn: number
    cashOut: number
    cashExpenses: number
    cashRefunds: number
    currentBalance: number
  }
}
export type DailyClosingReport = {
  fromDate: string
  toDate: string
  stampPaperCalculation: {
    salePrice: number
    commission: number
    otherFees: number
  }
  closing: {
    openingCash: number
    expectedCash: number | null
    actualCash: number | null
    difference: number | null
    isLocked: boolean
    closedAt: string | null
  } | null
  modules: DailyClosingModule[]
  cashEntries: CashEntryRow[]
  cash: {
    openingCash: number
    openingRecorded: boolean
    suggestedOpeningCash: number | null
    cashReceipts: number
    filerCashReceipts: number
    cashIn: number
    cashOut: number
    cashExpenses: number
    cashRefunds: number
    expectedCash: number
    actualCash: number | null
    difference: number | null
  }
}
