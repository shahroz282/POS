import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { SettingsRow } from '@shared/schemas'

type SettingsForm = {
  shop_name: string
  receipt_width_mm: string
  max_cashier_discount_percent: string
}

const inputClass = 'w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none'
const labelClass = 'mb-1 block text-xs font-medium text-gray-400'
const sectionClass = 'border border-gray-800 bg-gray-900/60 p-4 sm:p-5'

function toForm(settings: SettingsRow): SettingsForm {
  return {
    shop_name: settings.shop_name,
    receipt_width_mm: settings.receipt_width_mm,
    max_cashier_discount_percent: settings.max_cashier_discount_percent
  }
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsForm | null>(null)
  const [savedSettings, setSavedSettings] = useState<SettingsForm | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    void window.api.settingsGet().then((result) => {
      if (!active) return
      if (result.ok) {
        const form = toForm(result.data)
        setSettings(form)
        setSavedSettings(form)
      } else {
        setError(result.error.message)
      }
      setLoading(false)
    }).catch((reason: unknown) => {
      if (!active) return
      setError(reason instanceof Error ? reason.message : 'Settings could not be loaded.')
      setLoading(false)
    })
    return () => { active = false }
  }, [])

  const updateField = (field: keyof SettingsForm, value: string) => {
    setSettings((current) => current ? { ...current, [field]: value } : current)
    setError('')
    setNotice('')
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!settings || saving) return
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await window.api.settingsUpdate({
        shop_name: settings.shop_name.trim(),
        receipt_width_mm: Number(settings.receipt_width_mm),
        max_cashier_discount_percent: Number(settings.max_cashier_discount_percent)
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      const saved = { ...settings, shop_name: settings.shop_name.trim() }
      setSettings(saved)
      setSavedSettings(saved)
      setNotice('Settings saved successfully.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Settings could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    if (!savedSettings) return
    setSettings({ ...savedSettings })
    setError('')
    setNotice('')
  }

  const isDirty = Boolean(settings && savedSettings && (
    settings.shop_name !== savedSettings.shop_name
    || settings.receipt_width_mm !== savedSettings.receipt_width_mm
    || settings.max_cashier_discount_percent !== savedSettings.max_cashier_discount_percent
  ))

  return (
    <section className="space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold text-gray-100">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Configure shop details, receipt paper, and cashier discount limits.</p>
      </header>

      {error && <p role="alert" className="border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</p>}
      {notice && <p role="status" className="border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">{notice}</p>}

      {loading ? (
        <p className="py-8 text-center text-sm text-gray-500">Loading settings…</p>
      ) : settings ? (
        <form onSubmit={(event) => void submit(event)} className="space-y-5">
          <section className={sectionClass}>
            <h2 className="text-sm font-semibold text-gray-100">Shop details</h2>
            <p className="mt-1 text-xs text-gray-500">The shop name is shown on receipts.</p>
            <label className="mt-4 block max-w-xl">
              <span className={labelClass}>Shop name</span>
              <input
                className={inputClass}
                value={settings.shop_name}
                onChange={(event) => updateField('shop_name', event.target.value)}
                required
                minLength={1}
                maxLength={200}
                aria-label="Shop name"
              />
            </label>
          </section>

          <section className={sectionClass}>
            <h2 className="text-sm font-semibold text-gray-100">Receipt format</h2>
            <p className="mt-1 text-xs text-gray-500">Choose the paper width used for printed receipts.</p>
            <label className="mt-4 block max-w-xs">
              <span className={labelClass}>Receipt paper width (mm)</span>
              <input
                className={inputClass}
                type="number"
                min={40}
                max={120}
                step={1}
                value={settings.receipt_width_mm}
                onChange={(event) => updateField('receipt_width_mm', event.target.value)}
                required
                aria-label="Receipt paper width in millimeters"
              />
            </label>
            <div className="mt-4 max-w-xl border border-dashed border-gray-700 bg-gray-950 p-3">
              <p className="mb-2 text-[10px] uppercase tracking-wide text-gray-500">Receipt preview</p>
              <div
                className="mx-auto min-h-20 max-w-full border border-gray-600 bg-white px-3 py-2 text-center text-gray-950"
                style={{ width: `${Math.min(Math.max(Number(settings.receipt_width_mm) || 40, 40), 120)}mm` }}
              >
                <p className="truncate text-sm font-bold">{settings.shop_name || 'Shop name'}</p>
                <p className="mt-1 border-t border-dashed border-gray-400 pt-1 text-[10px]">Sale receipt · PKR</p>
              </div>
            </div>
          </section>

          <section className={sectionClass}>
            <h2 className="text-sm font-semibold text-gray-100">Sales rules</h2>
            <p className="mt-1 text-xs text-gray-500">Set the maximum discount a Cashier can apply to a sale.</p>
            <label className="mt-4 block max-w-xs">
              <span className={labelClass}>Maximum Cashier discount (%)</span>
              <input
                className={inputClass}
                type="number"
                min={0}
                max={100}
                step={1}
                value={settings.max_cashier_discount_percent}
                onChange={(event) => updateField('max_cashier_discount_percent', event.target.value)}
                required
                aria-label="Maximum Cashier discount percentage"
              />
            </label>
          </section>

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={reset} disabled={!isDirty || saving}
              className="border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50">
              Discard changes
            </button>
            <button type="submit" disabled={!isDirty || saving}
              className="bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
