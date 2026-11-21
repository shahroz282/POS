import { useCallback, useEffect, useState } from 'react'
import type { DailyClosingModule, DailyClosingReport, SessionUser } from '@shared/schemas'

const inputClass = 'border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none'
const sectionClass = 'border border-gray-800 bg-gray-900/60 p-4 sm:p-5'

function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function money(amount: number): string {
  if (!Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('en-PK', {
    style: 'currency', currency: 'PKR', maximumFractionDigits: 2
  }).format(amount)
}

function ModuleCard({ module, onClick, stampPaperCalculation }: {
  module: DailyClosingModule
  onClick: () => void
  stampPaperCalculation?: DailyClosingReport['stampPaperCalculation']
}) {
  return (
    <button type="button" onClick={onClick}
      className="h-full w-full border border-gray-800 bg-gray-900/60 p-5 text-left transition duration-200 hover:-translate-y-0.5 hover:border-brand-500 hover:bg-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 motion-reduce:transition-none">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-white">{module.label}</h3>
        <span className="whitespace-nowrap rounded-full bg-gray-800 px-2 py-1 text-[11px] text-gray-400">
          {module.transactionCount} records
        </span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4">
        <CardMetric label="Billed" value={money(module.grossAmount)} />
        <CardMetric label="Payments received" value={money(module.cashReceived + module.nonCashReceived)} />
        <CardMetric label="Refunds" value={money(module.refunds)} />
        <CardMetric label="Outstanding" value={money(module.outstanding)} />
      </div>
      {module.key === 'stampPaper' && stampPaperCalculation && (
        <p className="mt-4 border-t border-gray-800 pt-3 text-xs leading-5 text-gray-400">
          Sale price before commission {money(stampPaperCalculation.salePrice)} + Commission {money(stampPaperCalculation.commission)}
          {stampPaperCalculation.otherFees > 0 && <> + Other fees {money(stampPaperCalculation.otherFees)}</>}
          {' = '}{money(module.grossAmount)}
        </p>
      )}
      <div className="mt-5 text-xs font-medium text-brand-300">View breakdown →</div>
    </button>
  )
}

function CardMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-gray-200">{value}</div>
    </div>
  )
}

export default function DailyClosingPage() {
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [report, setReport] = useState<DailyClosingReport | null>(null)
  const [selectedModule, setSelectedModule] = useState<DailyClosingModule | null>(null)
  const [session, setSession] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const singleDay = fromDate === toDate
  const locked = singleDay && (report?.closing?.isLocked ?? false)

  const load = useCallback(async () => {
    setError('')
    setReport(null)
    setLoading(true)
    try {
      if (fromDate > toDate) {
        setError('Start date must be on or before end date.')
        return
      }
      const result = await window.api.dailyClosingReport({ fromDate, toDate })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setReport(result.data)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Galla Cash report could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    void window.api.authGetSession().then((result) => {
      if (result.ok) setSession(result.data)
    })
  }, [])

  useEffect(() => {
    if (!selectedModule) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedModule(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedModule])

  const cash = report?.cash
  const runAction = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await window.api.dailyClosingUnlock(fromDate)
      if (!result.ok) setError(result.error.message)
      else await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not unlock the day.')
    } finally {
      setBusy(false)
    }
  }

  const moduleTotals = report?.modules.reduce((totals, module) => ({
    count: totals.count + module.transactionCount,
    billed: totals.billed + module.grossAmount,
    collected: totals.collected + module.cashReceived + module.nonCashReceived,
    unclassified: totals.unclassified + module.unclassifiedReceived,
    refunds: totals.refunds + module.refunds,
    outstanding: totals.outstanding + module.outstanding
  }), { count: 0, billed: 0, collected: 0, unclassified: 0, refunds: 0, outstanding: 0 })

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-400">Cash overview</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Galla Cash</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-gray-400">
            Review payments, refunds, and expected cash across your business modules.
          </p>
        </div>
        <div className="border border-gray-800 bg-gray-900/60 p-3 sm:p-4">
          <p className="text-xs font-semibold text-gray-300">Report period</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <label className="text-xs text-gray-400">From date
              <input className={`mt-1.5 block ${inputClass}`} type="date" value={fromDate} max={today()}
                onChange={(event) => setFromDate(event.target.value)} />
            </label>
            <label className="text-xs text-gray-400">To date
              <input className={`mt-1.5 block ${inputClass}`} type="date" value={toDate} max={today()}
                onChange={(event) => setToDate(event.target.value)} />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-gray-500">Controls this report, separate from the Master Date.</p>
        </div>
      </header>

      {error && <div role="alert" className="border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}
      {loading && (
        <div role="status" className="border border-gray-800 bg-gray-900/60 p-6 text-center text-sm text-gray-400">
          Loading Galla Cash report…
        </div>
      )}
      {locked && <div className="border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">
        This date is locked. Transactions for this day are blocked until an Admin unlocks it.
      </div>}

      {report && moduleTotals && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-200">{fromDate} to {toDate}</p>
              <p className="mt-1 text-xs text-gray-500">{moduleTotals.count} module records</p>
            </div>
            <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              locked ? 'border-amber-800 bg-amber-950/30 text-amber-300' : 'border-gray-700 bg-gray-900 text-gray-400'
            }`}>
              {singleDay
                ? (locked ? `LOCKED${report.closing?.closedAt ? ` · ${report.closing.closedAt}` : ''}` : 'UNLOCKED')
                : 'DATE RANGE'}
            </div>
          </div>

          <section aria-labelledby="activity-summary-title" className={sectionClass}>
            <div className="mb-3">
              <h2 id="activity-summary-title" className="text-base font-semibold text-white">Business activity</h2>
              <p className="mt-1 text-xs text-gray-500">Billed, paid, refunded, and outstanding amounts across modules.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Metric label="Total billed" value={money(moduleTotals.billed)} />
              <Metric label="Payments received · cash + non-cash" value={money(moduleTotals.collected)} />
              <Metric label="Payments without a method" value={money(moduleTotals.unclassified)} />
              <Metric label="All refunds" value={money(moduleTotals.refunds)} />
              <Metric label="Total outstanding" value={money(moduleTotals.outstanding)} />
            </div>
          </section>

          <section aria-labelledby="cash-summary-title" className={sectionClass}>
            <div className="mb-3">
              <h2 id="cash-summary-title" className="text-base font-semibold text-white">Cash summary</h2>
              <p className="mt-1 text-xs text-gray-500">Expected drawer cash includes Filer receipts and saved cash movements.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Metric label="Section cash receipts" value={money(cash?.cashReceipts ?? 0)} />
              <Metric label="Filer receipts · included in expected cash" value={money(cash?.filerCashReceipts ?? 0)} />
              <Metric label="Cash-paid expenses" value={money(cash?.cashExpenses ?? 0)} />
              <Metric label="Cash refunds deducted" value={money(cash?.cashRefunds ?? 0)} />
              <Metric label="Expected drawer cash" value={money(cash?.expectedCash ?? 0)} emphasis />
            </div>
            {cash && (
              <details className="mt-4 border border-gray-800 bg-gray-900/40 p-4">
                <summary className="cursor-pointer text-sm font-medium text-brand-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400">
                  How expected cash is calculated
                </summary>
                <p className="mt-3 text-xs leading-5 text-gray-400">
                  Opening cash on the start date + section cash receipts + Filer receipts + saved cash-in
                  movements − saved cash-out movements − cash-paid expenses − cash refunds.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <Metric label={`Opening cash · ${fromDate}`} value={money(cash.openingCash)} />
                  <Metric label="Section cash receipts" value={money(cash.cashReceipts)} />
                  <Metric label="Filer receipts included" value={money(cash.filerCashReceipts)} />
                  <Metric label="Saved cash-in movements" value={money(cash.cashIn)} />
                  <Metric label="Saved cash-out movements" value={money(cash.cashOut)} />
                  <Metric label="Cash-paid expenses" value={money(cash.cashExpenses)} />
                  <Metric label="Cash refunds deducted" value={money(cash.cashRefunds)} />
                  <Metric label="Expected drawer cash" value={money(cash.expectedCash)} emphasis />
                </div>
                <p className="mt-3 text-xs text-gray-500">
                  Udhaar cash repayments are included in saved cash-in movements, not counted again in section receipts.
                </p>
              </details>
            )}
            {singleDay && locked && session?.role === 'ADMIN' && (
              <div className="mt-4 border-t border-gray-800 pt-4">
                <button type="button" disabled={busy} onClick={() => void runAction()}
                    className="border border-amber-700 px-4 py-2 text-sm text-amber-200 hover:bg-amber-950/40 disabled:opacity-50">
                    Unlock day
                </button>
              </div>
            )}
          </section>

          <section>
            <div className="mb-3">
              <h2 className="text-base font-semibold text-white">Module details</h2>
              <p className="mt-1 text-xs text-gray-500">Select a module card to see its breakdown for this report period.</p>
            </div>
            {moduleTotals.count === 0 && (
              <p className="mb-3 border border-gray-800 bg-gray-900/40 p-4 text-sm text-gray-400">
                No module transactions were recorded in this period. Cash summary values are shown separately above.
              </p>
            )}
            <div className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {report.modules.map((module) => (
                <ModuleCard key={module.key} module={module} onClick={() => setSelectedModule(module)}
                  stampPaperCalculation={module.key === 'stampPaper' ? report.stampPaperCalculation : undefined} />
              ))}
            </div>
            <p className="mt-3 text-xs text-gray-500">
              Udhaar cash repayments are included in the cash reconciliation, not counted a second time under module cash receipts.
              Inventory purchases are excluded from cash totals because supplier payment amounts and methods are not tracked.
            </p>
          </section>

        </>
      )}

      {selectedModule && (
        <div role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedModule(null)
        }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="daily-module-title"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-gray-700 bg-gray-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="daily-module-title" className="text-xl font-semibold text-white">{selectedModule.label}</h2>
                <p className="mt-1 text-sm text-gray-400">{fromDate} to {toDate}</p>
              </div>
              <button type="button" autoFocus onClick={() => setSelectedModule(null)}
                className="border border-gray-700 px-3 py-1 text-sm text-gray-300 hover:bg-gray-800">
                Close
              </button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Metric label="Transactions" value={String(selectedModule.transactionCount)} />
              <Metric label="Total billed" value={money(selectedModule.grossAmount)} />
              <Metric label="Cash received" value={money(selectedModule.cashReceived)} />
              <Metric label="Non-cash received" value={money(selectedModule.nonCashReceived)} />
              <Metric label="Payments without a method" value={money(selectedModule.unclassifiedReceived)} />
              <Metric label="Refunds" value={money(selectedModule.refunds)} />
              <Metric label="Outstanding" value={money(selectedModule.outstanding)} />
            </div>
            {selectedModule.key === 'stampPaper' && (
              <section className="mt-4 border-t border-gray-800 pt-4">
                <h3 className="mb-3 text-sm font-semibold text-gray-200">Stamp Paper billed amount</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Metric label="Sale price before commission" value={money(report?.stampPaperCalculation.salePrice ?? 0)} />
                  <Metric label="Commission" value={money(report?.stampPaperCalculation.commission ?? 0)} />
                  <Metric label="Other fees" value={money(report?.stampPaperCalculation.otherFees ?? 0)} />
                  <Metric label="Total billed" value={money(selectedModule.grossAmount)} />
                </div>
                <p className="mt-3 text-xs text-gray-500">Sale price before commission + commission + other fees = total billed.</p>
              </section>
            )}
            {selectedModule.key === 'udhaar' && <p className="mt-4 text-xs text-gray-500">Cash repayments are included in the cash reconciliation and excluded from module cash receipts to avoid double-counting.</p>}
          </section>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="min-h-20 border border-gray-800 bg-gray-950/50 p-4">
      <div className="min-h-8 text-xs leading-4 text-gray-500">{label}</div>
      <div className={`mt-1 break-words text-sm font-semibold ${emphasis ? 'text-brand-300' : 'text-gray-200'}`}>{value}</div>
    </div>
  )
}
