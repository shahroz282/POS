import { useCallback, useEffect, useState } from 'react'
import type { CashDepartment, DailyClosingModule, DailyClosingReport, SessionUser } from '@shared/schemas'
import type { FormEvent } from 'react'

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
  const [openingCash, setOpeningCash] = useState('0')
  const [openingReason, setOpeningReason] = useState('')
  const [actualCash, setActualCash] = useState('')
  const [cashType, setCashType] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_IN')
  const [cashAmount, setCashAmount] = useState('')
  const [cashDepartment, setCashDepartment] = useState<CashDepartment>('GENERAL')
  const [cashReason, setCashReason] = useState('')
  const [cashReference, setCashReference] = useState('')
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
    if (fromDate === toDate) {
      setOpeningCash(String(result.data.cash.openingRecorded
        ? result.data.cash.openingCash
        : result.data.cash.suggestedOpeningCash ?? 0))
      setActualCash(result.data.cash.actualCash === null ? '' : String(result.data.cash.actualCash))
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
  const saveOpening = async () => {
    const amount = Number(openingCash)
    if (!singleDay || !Number.isSafeInteger(amount) || amount < 0) {
      setError('Enter a whole opening amount for one selected day.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await window.api.dailyClosingSave({ date: fromDate, openingCash: amount, openingReason })
      if (!result.ok) setError(result.error.message)
      else await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not save opening cash.')
    } finally {
      setBusy(false)
    }
  }

  const closeDay = async () => {
    const opening = Number(openingCash)
    const actual = Number(actualCash)
    if (!singleDay || !Number.isSafeInteger(opening) || opening < 0 ||
      !Number.isSafeInteger(actual) || actual < 0) {
      setError('Enter whole, non-negative opening and counted closing amounts for one selected day.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await window.api.dailyClosingClose({
        date: fromDate, openingCash: opening, openingReason, actualCash: actual
      })
      if (!result.ok) setError(result.error.message)
      else await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not close the day.')
    } finally {
      setBusy(false)
    }
  }

  const addCashEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amount = Number(cashAmount)
    if (!singleDay || !Number.isSafeInteger(amount) || amount <= 0 || !cashReason.trim()) {
      setError('Enter a whole amount and a reason for a cash movement on one selected day.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await window.api.dailyClosingCashEntryCreate({
        type: cashType,
        amount,
        department: cashDepartment,
        reason: cashReason.trim(),
        reference: cashReference,
        entryDate: fromDate
      })
      if (!result.ok) setError(result.error.message)
      else {
        setCashAmount('')
        setCashReason('')
        setCashReference('')
        await load()
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not record cash movement.')
    } finally {
      setBusy(false)
    }
  }

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
              <Metric label="Filer cash (reconciliation only)" value={money(cash?.filerCashReceipts ?? 0)} />
              <Metric label="Cash in" value={money(cash?.cashIn ?? 0)} />
              <Metric label="Cash out" value={money(cash?.cashOut ?? 0)} />
              <Metric label="Cash expenses" value={money(cash?.cashExpenses ?? 0)} />
              <Metric label="Cash refunds" value={money(cash?.cashRefunds ?? 0)} />
              <Metric label="Expected cash" value={money(cash?.expectedCash ?? 0)} emphasis />
            </div>
            {singleDay && locked && session?.role === 'ADMIN' && (
              <div className="mt-4 border-t border-gray-800 pt-4">
                <button type="button" disabled={busy} onClick={() => void runAction()}
                    className="border border-amber-700 px-4 py-2 text-sm text-amber-200 hover:bg-amber-950/40 disabled:opacity-50">
                    Unlock day
                </button>
              </div>
            )}
          </section>

          {singleDay && (
            <section className={sectionClass}>
              <h2 className="text-base font-semibold text-white">Till opening and closing</h2>
              <p className="mt-1 text-xs text-gray-500">Opening is the cash already in the counter before today’s transactions. Cash movements below are separate and categorized.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs text-gray-400">Opening cash (PKR)
                  <input className={`mt-1 block w-full ${inputClass}`} type="number" min="0" step="1"
                    value={openingCash} disabled={locked} onChange={(event) => setOpeningCash(event.target.value)} />
                  {!report.cash.openingRecorded && report.cash.suggestedOpeningCash !== null &&
                    <span className="mt-1 block text-[11px] text-brand-300">Suggested from the previous day’s counted close; save to apply.</span>}
                </label>
                <label className="text-xs text-gray-400">Reason for opening adjustment
                  <input className={`mt-1 block w-full ${inputClass}`} maxLength={500}
                    value={openingReason} disabled={locked} onChange={(event) => setOpeningReason(event.target.value)} />
                </label>
                <Metric label="Expected cash" value={money(cash?.expectedCash ?? 0)} emphasis />
                <label className="text-xs text-gray-400">Counted cash (PKR)
                  <input className={`mt-1 block w-full ${inputClass}`} type="number" min="0" step="1"
                    value={actualCash} disabled={locked} onChange={(event) => setActualCash(event.target.value)} />
                </label>
              </div>
              {!locked && <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => void saveOpening()}
                  className="border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50">Save opening</button>
                <button type="button" disabled={busy || actualCash === ''} onClick={() => void closeDay()}
                  className="bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50">Count and close day</button>
              </div>}
            </section>
          )}

          {singleDay && (
            <section className={sectionClass}>
              <h2 className="text-base font-semibold text-white">Cash in / cash out</h2>
              <p className="mt-1 text-xs text-gray-500">Use for movements not already recorded as a sale, payment, repayment, refund, or expense.</p>
              <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => void addCashEntry(event)}>
                <label className="text-xs text-gray-400">Movement
                  <select className={`mt-1 block w-full ${inputClass}`} value={cashType} disabled={locked}
                    onChange={(event) => setCashType(event.target.value as 'CASH_IN' | 'CASH_OUT')}>
                    <option value="CASH_IN">Cash in</option><option value="CASH_OUT">Cash out</option>
                  </select>
                </label>
                <label className="text-xs text-gray-400">Department / source
                  <select className={`mt-1 block w-full ${inputClass}`} value={cashDepartment} disabled={locked}
                    onChange={(event) => setCashDepartment(event.target.value as CashDepartment)}>
                    {['GENERAL','SALES','STAMP_PAPER','ADMISSIONS','SCHEMES','PHOTOCOPY','INVENTORY','FILER_CUSTOMERS','UDHAAR'].map((value) =>
                      <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
                  </select>
                </label>
                <label className="text-xs text-gray-400">Amount (PKR)
                  <input className={`mt-1 block w-full ${inputClass}`} type="number" min="1" step="1"
                    required value={cashAmount} disabled={locked} onChange={(event) => setCashAmount(event.target.value)} />
                </label>
                <label className="text-xs text-gray-400">Reason
                  <input className={`mt-1 block w-full ${inputClass}`} required maxLength={500}
                    value={cashReason} disabled={locked} onChange={(event) => setCashReason(event.target.value)} />
                </label>
                <label className="text-xs text-gray-400">Reference (optional)
                  <input className={`mt-1 block w-full ${inputClass}`} maxLength={100}
                    value={cashReference} disabled={locked} onChange={(event) => setCashReference(event.target.value)} />
                </label>
                {!locked && <button type="submit" disabled={busy}
                  className="self-end bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-500 disabled:opacity-50">Record movement</button>}
              </form>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-xs">
                  <thead className="border-b border-gray-800 text-gray-500"><tr>{['Date', 'Type', 'Department', 'Reason', 'Reference', 'Amount', 'Entered by'].map((head) =>
                    <th key={head} className="px-2 py-2 font-medium">{head}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-800">{report.cashEntries.map((entry) => (
                    <tr key={entry.id}><td className="px-2 py-2 text-gray-400">{entry.created_at}</td>
                      <td className={entry.type === 'CASH_IN' ? 'px-2 py-2 text-green-300' : 'px-2 py-2 text-orange-300'}>{entry.type.replace('_', ' ')}</td>
                      <td className="px-2 py-2 text-gray-300">{entry.department.replaceAll('_', ' ')}</td>
                      <td className="px-2 py-2 text-gray-300">{entry.reason}</td><td className="px-2 py-2 text-gray-400">{entry.reference || '—'}</td>
                      <td className="px-2 py-2 text-gray-200">{money(entry.amount)}</td><td className="px-2 py-2 text-gray-400">{entry.created_by_name}</td></tr>
                  ))}{report.cashEntries.length === 0 && <tr><td colSpan={7} className="py-5 text-center text-gray-500">No cash movements for this date.</td></tr>}</tbody>
                </table>
              </div>
            </section>
          )}

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
