import type { DB } from '../db/db'
import { SettingsRepository } from '../repositories/settings.repository'
import { AuditLogRepository } from '../repositories/audit-log.repository'
import type { UpdateSettingsInput } from '@shared/schemas'

/**
 * Service: business rules for app settings.
 * ARCHITECTURE.md §Layer rules — services hold all business rules and own transactions.
 */
export class SettingsService {
  private settingsRepo: SettingsRepository
  private auditRepo: AuditLogRepository

  constructor(private db: DB) {
    this.settingsRepo = new SettingsRepository(db)
    this.auditRepo = new AuditLogRepository(db)
  }

  /** Get values displayed in the Admin Settings page. */
  getSettings(): { shop_name: string; receipt_width_mm: string; max_cashier_discount_percent: string; login_pin: string; delete_pin: string } {
    return this.settingsRepo.getMultiple([
      'shop_name',
      'receipt_width_mm',
      'max_cashier_discount_percent',
      'login_pin',
      'delete_pin'
    ]) as { shop_name: string; receipt_width_mm: string; max_cashier_discount_percent: string; login_pin: string; delete_pin: string }
  }

  /** Update settings (admin only — permission checked in IPC handler). */
  updateSettings(input: UpdateSettingsInput, adminUserId: number): void {
    this.db.transaction(() => {
      const changes: string[] = []

      if (input.shop_name !== undefined) {
        const old = this.settingsRepo.get('shop_name')
        this.settingsRepo.set('shop_name', input.shop_name)
        if (old !== input.shop_name) changes.push(`shop_name: "${old}" → "${input.shop_name}"`)
      }
      if (input.receipt_width_mm !== undefined) {
        const old = this.settingsRepo.get('receipt_width_mm')
        this.settingsRepo.set('receipt_width_mm', String(input.receipt_width_mm))
        if (old !== String(input.receipt_width_mm)) changes.push(`receipt_width_mm: ${old} → ${input.receipt_width_mm}`)
      }
      if (input.max_cashier_discount_percent !== undefined) {
        const old = this.settingsRepo.get('max_cashier_discount_percent')
        this.settingsRepo.set('max_cashier_discount_percent', String(input.max_cashier_discount_percent))
        if (old !== String(input.max_cashier_discount_percent)) {
          changes.push(`max_cashier_discount_percent: ${old} → ${input.max_cashier_discount_percent}`)
        }
      }
      if (input.login_pin !== undefined) {
        const old = this.settingsRepo.get('login_pin')
        this.settingsRepo.set('login_pin', input.login_pin)
        if (old !== input.login_pin) changes.push('login_pin changed')
      }
      if (input.delete_pin !== undefined) {
        const old = this.settingsRepo.get('delete_pin')
        this.settingsRepo.set('delete_pin', input.delete_pin)
        if (old !== input.delete_pin) changes.push('delete_pin changed')
      }

      if (changes.length > 0) {
        this.auditRepo.insert(adminUserId, 'SETTINGS_CHANGED', 'settings', null, changes.join('; '))
      }
    })()
  }
}
