import { z } from 'zod'

// ── Login ───────────────────────────────────────────────────────────────────
export const LoginInputSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(200)
})
export type LoginInput = z.infer<typeof LoginInputSchema>

export const LoginOutputSchema = z.object({
  id: z.number(),
  name: z.string(),
  username: z.string(),
  role: z.enum(['ADMIN', 'MANAGER', 'CASHIER'])
})
export type LoginOutput = z.infer<typeof LoginOutputSchema>

// ── Setup (first-run admin creation) ────────────────────────────────────────
export const SetupAdminInputSchema = z.object({
  name: z.string().min(1).max(100),
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(200)
})
export type SetupAdminInput = z.infer<typeof SetupAdminInputSchema>

// ── Session ─────────────────────────────────────────────────────────────────
export const SessionUserSchema = z.object({
  id: z.number(),
  name: z.string(),
  username: z.string(),
  role: z.enum(['ADMIN', 'MANAGER', 'CASHIER'])
})
export type SessionUser = z.infer<typeof SessionUserSchema>

// ── User management (admin only) ────────────────────────────────────────────
export const CreateUserInputSchema = z.object({
  name: z.string().min(1).max(100),
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(200),
  role: z.enum(['ADMIN', 'MANAGER', 'CASHIER'])
})
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>

export const UpdateUserRoleInputSchema = z.object({
  userId: z.number(),
  role: z.enum(['ADMIN', 'MANAGER', 'CASHIER'])
})
export type UpdateUserRoleInput = z.infer<typeof UpdateUserRoleInputSchema>

export const DeactivateUserInputSchema = z.object({
  userId: z.number()
})
export type DeactivateUserInput = z.infer<typeof DeactivateUserInputSchema>

export const ResetPasswordInputSchema = z.object({
  userId: z.number(),
  newPassword: z.string().min(6).max(200)
})
export type ResetPasswordInput = z.infer<typeof ResetPasswordInputSchema>

export const UserRowSchema = z.object({
  id: z.number(),
  name: z.string(),
  username: z.string(),
  role: z.enum(['ADMIN', 'MANAGER', 'CASHIER']),
  is_active: z.number(),
  created_at: z.string()
})
export type UserRow = z.infer<typeof UserRowSchema>

// ── Settings ────────────────────────────────────────────────────────────────
export const UpdateSettingsInputSchema = z.object({
  shop_name: z.string().min(1).max(200).optional(),
  receipt_width_mm: z.number().int().min(40).max(120).optional(),
  max_cashier_discount_percent: z.number().int().min(0).max(100).optional()
})
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsInputSchema>

export const SettingsRowSchema = z.object({
  shop_name: z.string(),
  receipt_width_mm: z.string(),
  max_cashier_discount_percent: z.string()
})
export type SettingsRow = z.infer<typeof SettingsRowSchema>
