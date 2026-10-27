import { Role } from './enums'

/**
 * SPEC.md §1 - permissions table.
 * Returns true if the given role has the given permission.
 */
export const Permissions = {
  canDiscount: (_role: Role) => true, // amount capped for CASHIER in service layer
  canSeePurchasePrice: (role: Role) => role !== Role.CASHIER,
  canReturn: (role: Role) => role !== Role.CASHIER,
  canPurchase: (role: Role) => role !== Role.CASHIER,
  canDailyClosing: (role: Role) => role !== Role.CASHIER,
  canUnlockDay: (role: Role) => role === Role.ADMIN,
  canViewAllReports: (role: Role) => role !== Role.CASHIER,
  canManageUsers: (role: Role) => role === Role.ADMIN,
  canSettings: (role: Role) => role === Role.ADMIN,
  canBackup: (role: Role) => role !== Role.CASHIER,
  canRestore: (role: Role) => role === Role.ADMIN
} as const

export const DEFAULT_MAX_CASHIER_DISCOUNT_PERCENT = 5
