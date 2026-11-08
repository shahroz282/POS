import type { SettingsRow } from '@shared/schemas'

export async function getReceiptSettings(): Promise<SettingsRow> {
  const result = await window.api.settingsGet()
  if (!result.ok) throw new Error(result.error.message)
  const width = Number(result.data.receipt_width_mm)
  if (!Number.isInteger(width) || width < 40 || width > 120) {
    throw new Error('Receipt paper width setting is invalid. Update it in Settings before printing.')
  }
  return result.data
}

export function receiptWidthMm(settings: SettingsRow): number {
  return Number(settings.receipt_width_mm)
}
