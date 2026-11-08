import { useCallback, useEffect, useState } from 'react'
import type { DailyClosingModule, DailyClosingReport, SessionUser } from '@shared/schemas'

const inputClass = 'border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none'
const sectionClass = 'border border-gray-800 bg-gray-900/60 p-4'

function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function money(amount: number): string {
  return new Intl.NumberFormat('en-PK', {
    style: 'currency', currency: 'PKR', maximumFractionDigits: 2
  }).format(amount)
}

function ModuleCard({ module, onClick }: { module: DailyClosingModule; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="border border-gray-800 bg-gray-900/60 p-4 text-left transition hover:border-brand-500 hover:bg-gray-900">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-white">{module.label}</h3>
        <span className="text-xs text-gray-500">{module.transactionCount} records</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <CardMetric label="Billed" value={money(module.grossAmount)} />
        <CardMetric label="Collected" value={money(module.cashReceived + module.nonCashReceived)} />
        <CardMetric label="Refunds" value={money(module.refunds)} />
        <CardMetric label="Outstanding" value={money(module.outstanding)} />
      </div>
      <div className="mt-4 text-xs font-medium text-brand-300">View module details →</div>
    </button>
  )
}

function CardMetric({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-sm text-gray-200">{value}</div></div>
}

export default function DailyClosingPage() {
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [report, setReport] = useState<DailyClosingReport | null>(null)
  const [selectedModule, setSelectedModule] = useState<DailyClosingModule | null>(null)
  const [session, setSession] = useState<SessionUser | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const singleDay = fromDate === toDate
  const locked = singleDay && (report?.closing?.isLocked ?? false)

  const load = useCallback(async () => {
    setError('')
    if (fromDate > toDate) {
      setReport(null)
      setError('Start date must be on or before end date.')
      return
    }
    const result = await window.api.dailyClosingReport({ fromDate, toDate })
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setReport(result.data)
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
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Daily closing operation failed')
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
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Daily Closing</h1>
          <p className="mt-1 text-sm text-gray-400">Review module activity and reconcile cash for a selected date range.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="text-xs text-gray-400">From
            <input className={`mt-1 block ${inputClass}`} type="date" value={fromDate} max={today()}
              onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="text-xs text-gray-400">To
            <input className={`mt-1 block ${inputClass}`} type="date" value={toDate} max={today()}
              onChange={(event) => setToDate(event.target.value)} />
          </label>
        </div>
      </header>

      {error && <div role="alert" className="border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}
      {locked && <div className="border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">
        This date is locked. Transactions for this day are blocked until an Admin unlocks it.
      </div>}

      {report && moduleTotals && (
        <>
          <section className={sectionClass}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-white">Overall summary</h2>
                <p className="mt-1 text-xs text-gray-500">{fromDate} to {toDate} · {moduleTotals.count} module records</p>
              </div>
              <div className={`text-xs font-semibold ${locked ? 'text-amber-300' : 'text-green-300'}`}>
                {singleDay ? (locked ? `LOCKED${report.closing?.closedAt ? ` · ${report.closing.closedAt}` : ''}` : 'OPEN') : 'DATE RANGE'}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Total billed" value={money(moduleTotals.billed)} />
              <Metric label="Total collected" value={money(moduleTotals.collected)} />
              <Metric label="Unclassified received" value={money(moduleTotals.unclassified)} />
              <Metric label="Total refunds" value={money(moduleTotals.refunds)} />
              <Metric label="Total outstanding" value={money(moduleTotals.outstanding)} />
              <Metric label="Cash receipts" value={money(cash?.cashReceipts ?? 0)} />
              <Metric label="Cash in" value={money(cash?.cashIn ?? 0)} />
              <Metric label="Cash out" value={money(cash?.cashOut ?? 0)} />
              <Metric label="Cash expenses" value={money(cash?.cashExpenses ?? 0)} />
              <Metric label="Cash refunds" value={money(cash?.cashRefunds ?? 0)} />
              <Metric label="Expected cash" value={money(cash?.expectedCash ?? 0)} emphasis />
            </div>
            {cash && cash.unclassifiedFilerAdvance > 0 &&
              <p className="mt-3 text-xs text-amber-300">Unclassified Filer advances: {money(cash.unclassifiedFilerAdvance)} — payment dates and methods are not tracked.</p>}
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
              <p className="mt-1 text-xs text-gray-500">{fromDate} to {toDate} · Select a card to see its date-range breakdown.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {report.modules.map((module) => (
                <ModuleCard key={module.key} module={module} onClick={() => setSelectedModule(module)} />
              ))}
            </div>
            <p className="mt-3 text-xs text-gray-500">
              Udhaar cash repayments are included in Cash in, not counted a second time under module cash receipts.
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
              <Metric label="Unclassified received" value={money(selectedModule.unclassifiedReceived)} />
              <Metric label="Refunds" value={money(selectedModule.refunds)} />
              <Metric label="Outstanding" value={money(selectedModule.outstanding)} />
            </div>
            {selectedModule.key === 'udhaar' && <p className="mt-4 text-xs text-gray-500">Cash repayments also appear in the overall Cash in figure and are excluded from cash receipts to avoid double-counting.</p>}
            {selectedModule.key === 'filerCustomers' && <p className="mt-4 text-xs text-gray-500">Advance payments have no separate date or payment method in this module, so they cannot be assigned to cash reconciliation.</p>}
          </section>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="border border-gray-800 bg-gray-950/50 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${emphasis ? 'text-brand-300' : 'text-gray-200'}`}>{value}</div>
    </div>
  )
}
