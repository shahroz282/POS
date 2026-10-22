// SPEC.md §3 - single source of truth for all enums

export const Role = {
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  CASHIER: 'CASHIER'
} as const
export type Role = (typeof Role)[keyof typeof Role]

export const SaleStatus = {
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  RETURNED: 'RETURNED'
} as const
export type SaleStatus = (typeof SaleStatus)[keyof typeof SaleStatus]

export const UdhaarType = {
  CHARGE: 'CHARGE',
  REPAYMENT: 'REPAYMENT'
} as const
export type UdhaarType = (typeof UdhaarType)[keyof typeof UdhaarType]

export const StampStatus = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED'
} as const
export type StampStatus = (typeof StampStatus)[keyof typeof StampStatus]

export const AdmissionStatus = {
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED'
} as const
export type AdmissionStatus = (typeof AdmissionStatus)[keyof typeof AdmissionStatus]

export const SchemeStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED'
} as const
export type SchemeStatus = (typeof SchemeStatus)[keyof typeof SchemeStatus]

export const PayMethod = {
  CASH: 'CASH',
  BANK: 'BANK',
  EASYPAISA: 'EASYPAISA',
  JAZZCASH: 'JAZZCASH'
} as const
export type PayMethod = (typeof PayMethod)[keyof typeof PayMethod]

export const CashType = {
  CASH_IN: 'CASH_IN',
  CASH_OUT: 'CASH_OUT'
} as const
export type CashType = (typeof CashType)[keyof typeof CashType]

export const MoveType = {
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  RETURN: 'RETURN',
  ADJUSTMENT: 'ADJUSTMENT'
} as const
export type MoveType = (typeof MoveType)[keyof typeof MoveType]

export const BackupStatus = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED'
} as const
export type BackupStatus = (typeof BackupStatus)[keyof typeof BackupStatus]
