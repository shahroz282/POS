import { z } from 'zod'
import { DailyClosingRangeSchema } from './daily-closing.schema'

export const ReportsRangeSchema = DailyClosingRangeSchema
export type ReportsRange = z.infer<typeof ReportsRangeSchema>

export type ReportsReport = {
  fromDate: string
  toDate: string
  role: 'ADMIN' | 'MANAGER' | 'CASHIER'
  modules: Array<{
    key: 'sales' | 'stampPaper' | 'admissions' | 'schemes' | 'filerCustomers' | 'udhaar' | 'inventory' | 'cash'
    label: string
    transactionCount: number
    grossAmount: number
    cashReceived: number
    nonCashReceived: number
    refunds: number
    outstanding: number
    note?: string
  }>
  salesProfit: number | null
  inventory: {
    productCount: number
    lowStockCount: number
    stockQuantity: number
    stockValue: number | null
    purchaseCount: number | null
    purchaseTotal: number | null
    movements: Array<{ type: string; count: number; quantity: number }>
  } | null
  cash: {
    cashIn: number
    cashOut: number
    cashExpenses: number
  } | null
}
