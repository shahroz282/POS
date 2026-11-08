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
  openingCash: z.number().int().min(0).max(100_000_000)
})
export const DailyClosingCloseSchema = DailyClosingSaveSchema.extend({
  actualCash: z.number().int().min(0).max(100_000_000)
})

export type DailyClosingSave = z.infer<typeof DailyClosingSaveSchema>
export type DailyClosingClose = z.infer<typeof DailyClosingCloseSchema>
export type DailyClosingRange = z.infer<typeof DailyClosingRangeSchema>
export type DailyClosingModule = {
  key: 'sales' | 'stampPaper' | 'admissions' | 'schemes' | 'filerCustomers' | 'udhaar'
  label: string
  transactionCount: number
  grossAmount: number
  cashReceived: number
  nonCashReceived: number
  unclassifiedReceived: number
  refunds: number
  outstanding: number
}
export type DailyClosingReport = {
  fromDate: string
  toDate: string
  closing: {
    openingCash: number
    expectedCash: number | null
    actualCash: number | null
    difference: number | null
    isLocked: boolean
    closedAt: string | null
  } | null
  modules: DailyClosingModule[]
  cash: {
    openingCash: number
    cashReceipts: number
    cashIn: number
    cashOut: number
    cashExpenses: number
    cashRefunds: number
    expectedCash: number
    actualCash: number | null
    difference: number | null
    unclassifiedFilerAdvance: number
  }
}
