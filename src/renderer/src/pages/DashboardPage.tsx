import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { PageId } from '../app/App'
import type {
  DailyClosingExpenseRow, DailyClosingReport, InventorySummary, ReportsReport, SaleRow
} from '@shared/schemas'

interface Props {
  onNavigate: (page: PageId) => void
  allowedPages: PageId[]
  role: string
}

interface DashboardData {
  report: ReportsReport
  dailyClosing: DailyClosingReport | null
  inventory: InventorySummary
  recentSales: SaleRow[]
  expenses: DailyClosingExpenseRow[]
}

const shortcuts: Array<{ page: PageId; label: string; icon: string; description: string }> = [
  { page: 'stamp-paper', label: 'Stamp paper', icon: '📜', description: 'Record a stamp transaction' },
  { page: 'admissions', label: 'New admission', icon: '🎓', description: 'Register a student' },
  { page: 'schemes', label: 'Scheme application', icon: '📋', description: 'Create an application' },
  { page: 'udhaar', label: 'Receive udhaar', icon: '💳', description: 'Record a customer repayment' },
  { page: 'daily-closing', label: 'Daily closing', icon: '📅', description: 'Review today’s cash and activity' },
  { page: 'reports', label: 'Sales report', icon: '📊', description: 'View sales performance' }
]

function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dayOpeningStorageKey(date: string): string {
  return `saqib-pos:dashboard-day-opening:${date}`
}

function money(value: number): string {
  return new Intl.NumberFormat('en-PK', {
    style: 'currency', currency: 'PKR', maximumFractionDigits: 0
  }).format(value)
}

function formatTime(value: string): string {
  const date = new Date(value.replace(' ', 'T'))
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function DashboardPage({ onNavigate, allowedPages, role }: Props) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false)
  const [expenseCategory, setExpenseCategory] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseMethod, setExpenseMethod] = useState<'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH'>('CASH')
  const [expenseDate, setExpenseDate] = useState(today)
  const [expenseNote, setExpenseNote] = useState('')
  const [savingExpense, setSavingExpense] = useState(false)
  const [expensesDialogOpen, setExpensesDialogOpen] = useState(false)
  const [dayOpeningDialogOpen, setDayOpeningDialogOpen] = useState(false)
  const [dayOpeningAmount, setDayOpeningAmount] = useState('')
  const [dayOpeningInput, setDayOpeningInput] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const date = today()
      const [reportResult, inventoryResult, salesResult, closingResult, expensesResult] = await Promise.all([
        window.api.reportsLoad({ fromDate: date, toDate: date }),
        window.api.inventorySummary(),
        window.api.salesList('', date, date),
        role === 'CASHIER'
          ? Promise.resolve(null)
          : window.api.dailyClosingReport({ fromDate: date, toDate: date }),
        role === 'CASHIER' ? Promise.resolve(null) : window.api.dailyClosingExpenses()
      ])
      const failures = [
        !reportResult.ok ? reportResult.error.message : '',
        !inventoryResult.ok ? inventoryResult.error.message : '',
        !salesResult.ok ? salesResult.error.message : '',
        closingResult && !closingResult.ok ? closingResult.error.message : '',
        expensesResult && !expensesResult.ok ? expensesResult.error.message : ''
      ].filter(Boolean)

      if (failures.length > 0) {
        setData(null)
        setError(failures.join(' '))
        return
      }

      if (!reportResult.ok || !inventoryResult.ok || !salesResult.ok ||
        (closingResult !== null && !closingResult.ok) ||
        (expensesResult !== null && !expensesResult.ok)) {
        throw new Error('Dashboard data could not be loaded.')
      }

      setData({
        report: reportResult.data,
        inventory: inventoryResult.data,
        recentSales: salesResult.data.slice(0, 8),
        dailyClosing: closingResult?.data ?? null,
        expenses: expensesResult?.data ?? []
      })
    } catch (reason) {
      setData(null)
      setError(reason instanceof Error ? reason.message : 'Dashboard data could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [role])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    try {
      const savedAmount = window.localStorage.getItem(dayOpeningStorageKey(today()))
      if (savedAmount !== null) {
        const amount = Number(savedAmount)
        if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000) {
          throw new Error('The saved display-only day opening is invalid.')
        }
        setDayOpeningAmount(savedAmount)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The display-only day opening could not be loaded.')
    }
  }, [])

  const saveDayOpening = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setNotice('')
    const amount = Number(dayOpeningInput)
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000) {
      setError('Enter a whole amount between 0 and 100,000,000 PKR.')
      return
    }
    try {
      window.localStorage.setItem(dayOpeningStorageKey(today()), String(amount))
      setDayOpeningAmount(String(amount))
      setDayOpeningDialogOpen(false)
      setNotice('Display-only day opening saved. It does not affect cash calculations.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The display-only day opening could not be saved.')
    }
  }

  const addExpense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setNotice('')
    setSavingExpense(true)
    try {
      const result = await window.api.dailyClosingExpenseCreate({
        category: expenseCategory,
        amount: Number(expenseAmount),
        method: expenseMethod,
        expenseDate,
        note: expenseNote
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setExpenseDialogOpen(false)
      setExpenseCategory('')
      setExpenseAmount('')
      setExpenseMethod('CASH')
      setExpenseDate(today())
      setExpenseNote('')
      setNotice('Expense added successfully.')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Expense could not be added.')
    } finally {
      setSavingExpense(false)
    }
  }

  const sales = data?.report.modules.find((module) => module.key === 'sales')
  const udhaar = data?.dailyClosing?.modules.find((module) => module.key === 'udhaar')
  const cashReceived = data?.dailyClosing?.cash.cashReceipts ?? sales?.cashReceived ?? 0
  const cashPayments = sales?.cashReceived ?? 0
  const nonCashPayments = sales?.nonCashReceived ?? 0
  const paymentTotal = cashPayments + nonCashPayments
  const cashPaymentPercent = paymentTotal > 0 ? Math.round((cashPayments / paymentTotal) * 100) : 0
  const activeProducts = data?.inventory.productCount ?? 0
  const expenses = data?.dailyClosing?.cash.cashExpenses
  const lowStockCount = data?.inventory.lowStockCount ?? 0
  const healthyProducts = Math.max(0, activeProducts - lowStockCount)
  const healthyProductPercent = activeProducts > 0 ? Math.round((healthyProducts / activeProducts) * 100) : 0
  const availableShortcuts = shortcuts.filter((shortcut) => allowedPages.includes(shortcut.page))
  const canAddExpense = allowedPages.includes('daily-closing')

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-400">Module 2</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-100">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-400">
            Today at a glance <span className="text-gray-600">·</span> {new Date().toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {allowedPages.includes('sales') && (
            <button type="button" onClick={() => onNavigate('sales')}
              className="bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500">
              + New sale
            </button>
          )}
          {canAddExpense && (
            <>
              <button type="button" onClick={() => { setError(''); setNotice(''); setExpenseDialogOpen(true) }}
                className="border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800">
                + Add expense
              </button>
              <button type="button" onClick={() => { setError(''); setExpensesDialogOpen(true) }}
                className="border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800">
                View all expenses
              </button>
            </>
          )}
          {role === 'ADMIN' && (
            <button type="button" onClick={() => {
              setError('')
              setNotice('')
              setDayOpeningInput(dayOpeningAmount)
              setDayOpeningDialogOpen(true)
            }} className="border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800">
              {dayOpeningAmount === '' ? '+ Day opening' : `Day opening · ${money(Number(dayOpeningAmount))}`}
            </button>
          )}
          <button type="button" onClick={() => void load()} disabled={loading}
            className="border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && <div role="alert" className="border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}
      {notice && <div role="status" className="border border-green-800 bg-green-950/30 p-3 text-sm text-green-300">{notice}</div>}

      {loading && !data ? (
        <div className="border border-gray-800 bg-gray-900/60 p-8 text-center text-sm text-gray-400" role="status">
          Loading today’s dashboard…
        </div>
      ) : data && (
        <>
          <section className={`grid gap-3 sm:grid-cols-2 ${role === 'ADMIN' ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`}
            aria-label="Today's business summary">
            <SummaryCard label="Today's sales" value={money(sales?.grossAmount ?? 0)} icon="🧾" />
            <SummaryCard label="Cash received" value={money(cashReceived)} icon="💵" />
            {role === 'ADMIN' && (
              <SummaryCard
                label="Opening cash (daily closing)"
                value={money(data.dailyClosing?.cash.openingCash ?? 0)}
                detail="Used in daily cash reconciliation"
                icon="🌅"
              />
            )}
            <SummaryCard
              label="Udhaar given"
              value={udhaar ? money(udhaar.grossAmount) : '—'}
              detail={udhaar ? undefined : 'Available to managers'}
              icon="💳"
            />
            <SummaryCard
              label="Cash expenses"
              value={expenses === undefined ? '—' : money(expenses)}
              detail={expenses === undefined ? 'Available to managers' : undefined}
              icon="🧮"
            />
            <SummaryCard
              label="Low stock"
              value={String(lowStockCount)}
              detail={lowStockCount === 0 ? 'No products below minimum' : `${lowStockCount === 1 ? 'product' : 'products'} need attention`}
              icon="📦"
              onClick={allowedPages.includes('inventory') ? () => onNavigate('inventory') : undefined}
            />
          </section>

          <section aria-label="Business progress" className="grid gap-4 lg:grid-cols-2">
            <div className="border border-gray-800 bg-gray-900/60 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">Today’s payment mix</h2>
                  <p className="mt-1 text-xs text-gray-500">Collections recorded today by payment method</p>
                </div>
                <span className="text-xs font-medium text-gray-400">{money(paymentTotal)} total</span>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-6 sm:justify-start">
                <CircleProgress
                  primaryPercent={paymentTotal > 0 ? cashPaymentPercent : 0}
                  secondaryPercent={paymentTotal > 0 ? 100 - cashPaymentPercent : 0}
                  primaryColor="#60a5fa"
                  secondaryColor="#22d3ee"
                  label={`Cash ${cashPaymentPercent} percent, online payment ${paymentTotal > 0 ? 100 - cashPaymentPercent : 0} percent`}
                  value={`${paymentTotal > 0 ? cashPaymentPercent : 0}%`}
                  caption="cash"
                />
                <div className="min-w-[150px] flex-1 space-y-4">
                  <ProgressLegend label="Cash" value={money(cashPayments)} percent={cashPaymentPercent} color="bg-brand-400" />
                  <ProgressLegend
                    label="Online payment"
                    value={money(nonCashPayments)}
                    percent={paymentTotal > 0 ? 100 - cashPaymentPercent : 0}
                    color="bg-cyan-400"
                  />
                </div>
              </div>
            </div>

            <div className="border border-gray-800 bg-gray-900/60 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">Inventory health</h2>
                  <p className="mt-1 text-xs text-gray-500">Active products currently above their low-stock level</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-6 sm:justify-start">
                <CircleProgress
                  primaryPercent={activeProducts > 0 ? healthyProductPercent : 0}
                  primaryColor={lowStockCount > 0 ? '#fbbf24' : '#34d399'}
                  label={`${healthyProducts} of ${activeProducts} active products above their low-stock level`}
                  value={activeProducts > 0 ? `${healthyProductPercent}%` : '—'}
                  caption="healthy"
                  progress={activeProducts > 0 ? {
                    value: healthyProducts,
                    max: activeProducts
                  } : undefined}
                />
                <div className="min-w-[150px] flex-1 space-y-3">
                  <div className="text-sm font-medium text-gray-200">{healthyProducts} above minimum</div>
                  <div className={`text-xs ${lowStockCount > 0 ? 'text-amber-300' : 'text-gray-500'}`}>
                    {lowStockCount} low stock · {activeProducts} active
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <div className="mb-3">
              <h2 className="text-base font-semibold text-white">Quick actions</h2>
              <p className="mt-1 text-xs text-gray-500">Jump straight to a common task.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {availableShortcuts.map((shortcut) => (
                <button key={shortcut.page} type="button" onClick={() => onNavigate(shortcut.page)}
                  className="flex items-start gap-3 border border-gray-800 bg-gray-900/60 p-4 text-left transition hover:border-brand-500 hover:bg-gray-900">
                  <span className="text-xl" aria-hidden="true">{shortcut.icon}</span>
                  <span>
                    <span className="block text-sm font-medium text-gray-100">{shortcut.label}</span>
                    <span className="mt-1 block text-xs text-gray-500">{shortcut.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(260px,1fr)]">
            <div className="border border-gray-800 bg-gray-900/60">
              <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
                <div>
                  <h2 className="text-base font-semibold text-white">Recent sales</h2>
                  <p className="mt-1 text-xs text-gray-500">Latest transactions recorded today</p>
                </div>
                <button type="button" onClick={() => onNavigate('sales')}
                  className="text-xs font-medium text-brand-300 hover:text-brand-200">View sales</button>
              </div>
              {data.recentSales.length === 0 ? (
                <p className="p-6 text-center text-sm text-gray-500">No sales recorded today.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-gray-500">
                      <tr>
                        <th className="px-4 py-2 font-medium">Invoice</th>
                        <th className="px-4 py-2 font-medium">Customer</th>
                        <th className="px-4 py-2 text-right font-medium">Total</th>
                        <th className="px-4 py-2 text-right font-medium">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {data.recentSales.map((sale) => (
                        <tr key={sale.id} className="text-gray-300">
                          <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-100">{sale.invoice_no}</td>
                          <td className="max-w-40 truncate px-4 py-3">{sale.customer_name || 'Walk-in'}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">{money(sale.total)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-gray-500">{formatTime(sale.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="border border-gray-800 bg-gray-900/60">
              <div className="border-b border-gray-800 px-4 py-3">
                <h2 className="text-base font-semibold text-white">Alerts</h2>
                <p className="mt-1 text-xs text-gray-500">Items that may need your attention</p>
              </div>
              <div className="space-y-3 p-4">
                {lowStockCount > 0 && (
                  <Alert
                    title={`${lowStockCount} low-stock ${lowStockCount === 1 ? 'product' : 'products'}`}
                    detail="Stock is at or below its configured minimum."
                    onClick={allowedPages.includes('inventory') ? () => onNavigate('inventory') : undefined}
                  />
                )}
                {(sales?.outstanding ?? 0) > 0 && (
                  <Alert
                    title="Unpaid sales today"
                    detail={`${money(sales?.outstanding ?? 0)} remains outstanding from today’s sales.`}
                    onClick={() => onNavigate('udhaar')}
                  />
                )}
                {lowStockCount === 0 && (sales?.outstanding ?? 0) === 0 && (
                  <p className="py-4 text-center text-sm text-gray-500">You’re all caught up.</p>
                )}
              </div>
            </div>
          </section>
          {expenses !== undefined && (
            <p className="text-xs text-gray-600">
              Cash expenses are shown here; expenses paid by non-cash methods are not included in the daily cash summary.
            </p>
          )}
        </>
      )}

      {expenseDialogOpen && (
        <div role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !savingExpense) setExpenseDialogOpen(false)
        }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="expense-dialog-title"
            className="w-full max-w-lg border border-gray-700 bg-gray-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="expense-dialog-title" className="text-xl font-semibold text-white">Add expense</h2>
                <p className="mt-1 text-sm text-gray-400">Record a shop expense for the selected date.</p>
              </div>
              <button type="button" disabled={savingExpense} onClick={() => setExpenseDialogOpen(false)}
                className="border border-gray-700 px-3 py-1 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50">
                Close
              </button>
            </div>
            <form className="mt-5 space-y-4" onSubmit={(event) => void addExpense(event)}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-medium text-gray-400">
                  Category
                  <input autoFocus required maxLength={100} value={expenseCategory}
                    onChange={(event) => setExpenseCategory(event.target.value)}
                    className="mt-1 block w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none"
                    placeholder="e.g. Utilities" />
                </label>
                <label className="text-xs font-medium text-gray-400">
                  Amount (PKR)
                  <input required type="number" min="1" max="100000000" step="1" value={expenseAmount}
                    onChange={(event) => setExpenseAmount(event.target.value)}
                    className="mt-1 block w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none"
                    placeholder="0" />
                </label>
                <label className="text-xs font-medium text-gray-400">
                  Payment method
                  <select value={expenseMethod} onChange={(event) => setExpenseMethod(event.target.value as typeof expenseMethod)}
                    className="mt-1 block w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none">
                    <option value="CASH">Cash</option>
                    <option value="BANK">Bank</option>
                    <option value="EASYPAISA">EasyPaisa</option>
                    <option value="JAZZCASH">JazzCash</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-gray-400">
                  Expense date
                  <input required type="date" max={today()} value={expenseDate}
                    onChange={(event) => setExpenseDate(event.target.value)}
                    className="mt-1 block w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none" />
                </label>
              </div>
              <label className="block text-xs font-medium text-gray-400">
                Note <span className="font-normal text-gray-600">(optional)</span>
                <textarea maxLength={500} rows={2} value={expenseNote}
                  onChange={(event) => setExpenseNote(event.target.value)}
                  className="mt-1 block w-full resize-y border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none"
                  placeholder="Add any useful details" />
              </label>
              <div className="flex justify-end gap-2 border-t border-gray-800 pt-4">
                <button type="button" disabled={savingExpense} onClick={() => setExpenseDialogOpen(false)}
                  className="border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50">
                  Cancel
                </button>
                <button type="submit" disabled={savingExpense}
                  className="bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50">
                  {savingExpense ? 'Saving…' : 'Save expense'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {dayOpeningDialogOpen && (
        <div role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setDayOpeningDialogOpen(false)
        }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="day-opening-dialog-title"
            className="w-full max-w-md border border-gray-700 bg-gray-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="day-opening-dialog-title" className="text-xl font-semibold text-white">Day opening</h2>
                <p className="mt-1 text-sm text-gray-400">
                  Save a display-only amount for {new Date().toLocaleDateString()}.
                </p>
              </div>
              <button type="button" onClick={() => setDayOpeningDialogOpen(false)}
                className="border border-gray-700 px-3 py-1 text-sm text-gray-300 hover:bg-gray-800">
                Close
              </button>
            </div>
            <form className="mt-5 space-y-4" onSubmit={saveDayOpening}>
              <label className="block text-xs font-medium text-gray-400">
                Amount (PKR)
                <input autoFocus required type="number" min="0" max="100000000" step="1"
                  value={dayOpeningInput} onChange={(event) => setDayOpeningInput(event.target.value)}
                  className="mt-1 block w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none"
                  placeholder="0" />
              </label>
              <p className="text-xs text-amber-300">
                Display only. This amount is saved for today on this device and does not change Daily Closing calculations.
              </p>
              <div className="flex justify-end gap-2 border-t border-gray-800 pt-4">
                <button type="button" onClick={() => setDayOpeningDialogOpen(false)}
                  className="border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800">
                  Cancel
                </button>
                <button type="submit"
                  className="bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500">
                  Save display amount
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {expensesDialogOpen && (
        <div role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setExpensesDialogOpen(false)
        }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="expenses-dialog-title"
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto border border-gray-700 bg-gray-900 p-5 shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 id="expenses-dialog-title" className="text-xl font-semibold text-white">All expenses</h2>
                <p className="mt-1 text-sm text-gray-400">
                  {data?.expenses.length ?? 0} records · includes all payment methods and dates
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-gray-200">
                  Total {money(data?.expenses.reduce((sum, expense) => sum + expense.amount, 0) ?? 0)}
                </span>
                <button type="button" autoFocus onClick={() => setExpensesDialogOpen(false)}
                  className="border border-gray-700 px-3 py-1 text-sm text-gray-300 hover:bg-gray-800">
                  Close
                </button>
              </div>
            </div>
            {!data?.expenses.length ? (
              <p className="mt-6 border border-gray-800 bg-gray-950/50 p-8 text-center text-sm text-gray-500">
                No expenses have been recorded.
              </p>
            ) : (
              <div className="mt-5 overflow-x-auto border border-gray-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-950/70 text-xs text-gray-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Category</th>
                      <th className="px-4 py-3 font-medium">Method</th>
                      <th className="px-4 py-3 text-right font-medium">Amount</th>
                      <th className="px-4 py-3 font-medium">Note</th>
                      <th className="px-4 py-3 font-medium">Added by</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {data.expenses.map((expense) => (
                      <tr key={expense.id} className="text-gray-300">
                        <td className="whitespace-nowrap px-4 py-3">{expense.expense_date}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-100">{expense.category}</td>
                        <td className="whitespace-nowrap px-4 py-3">{paymentMethodLabel(expense.method)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">{money(expense.amount)}</td>
                        <td className="max-w-56 px-4 py-3 text-gray-400">{expense.note || '—'}</td>
                        <td className="whitespace-nowrap px-4 py-3">{expense.created_by_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function paymentMethodLabel(method: DailyClosingExpenseRow['method']): string {
  switch (method) {
    case 'CASH': return 'Cash'
    case 'BANK': return 'Bank'
    case 'EASYPAISA': return 'EasyPaisa'
    case 'JAZZCASH': return 'JazzCash'
  }
}

function SummaryCard({ label, value, detail, icon, onClick }: {
  label: string; value: string; detail?: string; icon: string; onClick?: () => void
}) {
  const content = <>
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      <span aria-hidden="true">{icon}</span>
    </div>
    <div className="mt-3 text-xl font-semibold text-gray-100">{value}</div>
    {detail && <div className="mt-1 text-xs text-gray-500">{detail}</div>}
  </>
  return onClick ? (
    <button type="button" onClick={onClick}
      className="border border-gray-800 bg-gray-900/60 p-4 text-left transition hover:border-brand-500">
      {content}
    </button>
  ) : (
    <div className="border border-gray-800 bg-gray-900/60 p-4">{content}</div>
  )
}

function ProgressLegend({ label, value, percent, color }: {
  label: string; value: string; percent: number; color: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-gray-400">
          <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden="true" />
          {label}
        </span>
        <span className="text-xs text-gray-500">{percent}%</span>
      </div>
      <div className="mt-1.5 text-sm font-medium text-gray-200">{value}</div>
    </div>
  )
}

function CircleProgress({ primaryPercent, secondaryPercent = 0, primaryColor, secondaryColor = '#22d3ee',
  label, value, caption, progress }: {
  primaryPercent: number
  secondaryPercent?: number
  primaryColor: string
  secondaryColor?: string
  label: string
  value: string
  caption: string
  progress?: { value: number; max: number }
}) {
  const clampedPrimary = Math.min(100, Math.max(0, primaryPercent))
  const clampedSecondary = Math.min(100 - clampedPrimary, Math.max(0, secondaryPercent))
  return (
    <div
      className="relative h-28 w-28 flex-shrink-0"
      role={progress ? 'progressbar' : 'img'}
      aria-label={label}
      aria-valuemin={progress ? 0 : undefined}
      aria-valuemax={progress?.max}
      aria-valuenow={progress?.value}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r="42" fill="none" stroke="#1f2937" strokeWidth="8" />
        {clampedSecondary > 0 && (
          <circle
            cx="50" cy="50" r="42" fill="none" stroke={secondaryColor} strokeWidth="8"
            pathLength="100" strokeDasharray={`${clampedSecondary} 100`}
            strokeDashoffset={-clampedPrimary} strokeLinecap="butt"
            className="transition-[stroke-dasharray,stroke-dashoffset]"
          />
        )}
        {clampedPrimary > 0 && (
          <circle
            cx="50" cy="50" r="42" fill="none" stroke={primaryColor} strokeWidth="8"
            pathLength="100" strokeDasharray={`${clampedPrimary} 100`}
            strokeLinecap="round" className="transition-[stroke-dasharray]"
          />
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-semibold leading-tight text-gray-100">{value}</span>
        <span className="mt-0.5 text-[10px] text-gray-500">{caption}</span>
      </div>
    </div>
  )
}

function Alert({ title, detail, onClick }: { title: string; detail: string; onClick?: () => void }) {
  const content = <>
    <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-amber-400" />
    <span>
      <span className="block text-sm font-medium text-amber-200">{title}</span>
      <span className="mt-1 block text-xs text-gray-400">{detail}</span>
    </span>
    {onClick && <span className="ml-auto text-xs text-brand-300">View →</span>}
  </>
  return onClick ? (
    <button type="button" onClick={onClick}
      className="flex w-full items-start gap-3 border border-amber-900/60 bg-amber-950/20 p-3 text-left hover:bg-amber-950/40">
      {content}
    </button>
  ) : (
    <div className="flex items-start gap-3 border border-amber-900/60 bg-amber-950/20 p-3">{content}</div>
  )
}
