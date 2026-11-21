import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { PageId } from '../app/App'
import { useSelectedDate } from '../utils/selected-date'
import type {
  DailyClosingExpenseRow, DailyClosingReport, DashboardDailySummary, InventorySummary, ReportsReport
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
  expenses: DailyClosingExpenseRow[]
  departmentSummary: DashboardDailySummary['modules']
  cashCalculation: DashboardDailySummary['cashCalculation']
}

function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function money(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-PK', {
    style: 'currency', currency: 'PKR', maximumFractionDigits: 0
  }).format(value)
}

export default function DashboardPage({ onNavigate, allowedPages, role }: Props) {
  const [selectedDate] = useSelectedDate()
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
  const [dayOpeningReason, setDayOpeningReason] = useState('')
  const [balanceDetailsOpen, setBalanceDetailsOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const date = selectedDate
      const [reportResult, inventoryResult, summaryResult, closingResult, expensesResult] = await Promise.all([
        window.api.reportsLoad({ fromDate: date, toDate: date }),
        window.api.inventorySummary(),
        window.api.dashboardDailySummary(date),
        role === 'CASHIER'
          ? Promise.resolve(null)
          : window.api.dailyClosingReport({ fromDate: date, toDate: date }),
        role === 'CASHIER' ? Promise.resolve(null) : window.api.dailyClosingExpenses()
      ])
      const failures = [
        !reportResult.ok ? reportResult.error.message : '',
        !inventoryResult.ok ? inventoryResult.error.message : '',
        !summaryResult.ok ? summaryResult.error.message : '',
        closingResult && !closingResult.ok ? closingResult.error.message : '',
        expensesResult && !expensesResult.ok ? expensesResult.error.message : ''
      ].filter(Boolean)

      if (failures.length > 0) {
        setData(null)
        setError(failures.join(' '))
        return
      }

      if (!reportResult.ok || !inventoryResult.ok || !summaryResult.ok ||
        (closingResult !== null && !closingResult.ok) ||
        (expensesResult !== null && !expensesResult.ok)) {
        throw new Error('Dashboard data could not be loaded.')
      }

      setData({
        report: reportResult.data,
        inventory: inventoryResult.data,
        departmentSummary: summaryResult.data.modules,
        cashCalculation: summaryResult.data.cashCalculation,
        dailyClosing: closingResult?.data ?? null,
        expenses: expensesResult?.data ?? []
      })
    } catch (reason) {
      setData(null)
      setError(reason instanceof Error ? reason.message : 'Dashboard data could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [role, selectedDate])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const openingCash = data?.dailyClosing?.cash.openingCash
    if (openingCash !== undefined) setDayOpeningAmount(String(openingCash))
  }, [data?.dailyClosing?.cash.openingCash])

  const saveDayOpening = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setNotice('')
    const amount = Number(dayOpeningInput)
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000) {
      setError('Enter a whole amount between 0 and 100,000,000 PKR.')
      return
    }
    const result = await window.api.dailyClosingSave({
      date: selectedDate,
      openingCash: amount,
      openingReason: dayOpeningReason
    })
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setDayOpeningDialogOpen(false)
    setNotice('Opening cash saved and included in today’s cash reconciliation.')
    await load()
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
  const stampPaper = data?.departmentSummary.find((module) => module.key === 'stampPaper')
  const photocopy = data?.departmentSummary.find((module) => module.key === 'photocopy')
  const udhaar = data?.dailyClosing?.modules.find((module) => module.key === 'udhaar')
  const todaySales = (sales?.grossAmount ?? 0) + (photocopy?.grossAmount ?? 0)
  const cashReceived = data?.dailyClosing?.cash.cashReceipts ?? sales?.cashReceived ?? 0
  const expenses = data?.dailyClosing?.cash.cashExpenses
  const lowStockCount = data?.inventory.lowStockCount ?? 0
  const canAddExpense = allowedPages.includes('daily-closing')

  if (balanceDetailsOpen && data) {
    return (
      <CurrentBalanceDetailsPage
        date={selectedDate}
        calculation={data.cashCalculation}
        onBack={() => setBalanceDetailsOpen(false)}
      />
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-3 sm:p-4">
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
          <section className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
            aria-label="Today's business summary">
            <SummaryCard label="Today's sales" value={money(todaySales)} icon="🧾" />
            <SummaryCard label="Stamp paper today" value={money(stampPaper?.grossAmount ?? 0)}
              detail={`Collected ${money(stampPaper?.cashReceived ?? 0)}`} icon="📜"
              onClick={() => onNavigate('stamp-paper')} />
            <SummaryCard label="Current balance" value={money(data.cashCalculation.currentBalance)}
              detail="Filer excluded" icon="💰"
              onClick={() => setBalanceDetailsOpen(true)} />
            <SummaryCard label="Cash received" value={money(cashReceived)} icon="💵" />
            {role === 'ADMIN' && (
              <SummaryCard
                label="Opening cash"
                value={money(data.dailyClosing?.cash.openingCash ?? 0)}
                detail="Cash available at start of day"
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
                    Set the cash physically in the counter at the start of {new Date().toLocaleDateString()}.
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
              <label className="block text-xs font-medium text-gray-400">
                Reason / note (optional)
                <input value={dayOpeningReason} onChange={(event) => setDayOpeningReason(event.target.value)}
                  maxLength={500} className="mt-1 block w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none"
                  placeholder="For example: cash carried forward from yesterday" />
              </label>
              <div className="flex justify-end gap-2 border-t border-gray-800 pt-4">
                <button type="button" onClick={() => setDayOpeningDialogOpen(false)}
                  className="border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800">
                  Cancel
                </button>
                <button type="submit"
                  className="bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500">
                  Save opening cash
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
  label: string
  value: string
  detail?: string
  icon: string
  onClick?: () => void
}) {
  const content = <>
    <div className="flex items-start justify-between gap-2">
      <span className="text-[11px] leading-tight text-gray-500">{label}</span>
      <span className="text-sm" aria-hidden="true">{icon}</span>
    </div>
    <div className="mt-2 text-base font-semibold leading-tight text-gray-100">{value}</div>
    {detail && <div className="mt-1 text-[10px] leading-tight text-gray-500">{detail}</div>}
    {onClick && <div className="mt-2 text-[10px] font-medium text-brand-300">See detail →</div>}
  </>
  return onClick ? (
    <button type="button" onClick={onClick}
      className="dashboard-summary-card border border-gray-800 bg-gray-900/60 p-3 text-left transition duration-200 ease-out hover:-translate-y-0.5 hover:border-brand-500 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 motion-reduce:transition-none">
      {content}
    </button>
  ) : (
    <div className="dashboard-summary-card border border-gray-800 bg-gray-900/60 p-3">{content}</div>
  )
}

function CurrentBalanceDetailsPage({ date, calculation, onBack }: {
  date: string
  calculation: DashboardDailySummary['cashCalculation']
  onBack: () => void
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-3 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-400">Dashboard</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-100">Current balance details</h1>
          <p className="mt-1 text-sm text-gray-400">Cash calculation for {date}</p>
        </div>
        <button type="button" onClick={onBack}
          className="border border-gray-700 px-3 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-800 motion-reduce:transition-none">
          ← Back to dashboard
        </button>
      </header>

      <section className="border border-gray-800 bg-gray-900/60 p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-white">Balance calculation</h2>
        <p className="mt-1 text-xs text-gray-500">
          Opening cash + section receipts + cash in − cash out − cash expenses − cash refunds
        </p>
        <div className="mt-4 divide-y divide-gray-800">
          <CashCalculationRow label="Opening balance" amount={calculation.openingCash} operator="+" />
          {calculation.sectionReceipts.map((section) => (
            <CashCalculationRow
              key={section.key}
              label={`${section.label} cash receipts`}
              amount={section.cashReceived}
              operator="+"
            />
          ))}
          <CashCalculationRow label="Cash in" amount={calculation.cashIn} operator="+" />
          {calculation.udhaarCashRepayments > 0 && (
            <p className="py-2 text-xs text-gray-500">
              Cash in includes {money(calculation.udhaarCashRepayments)} in Udhaar repayments; they are not added twice.
            </p>
          )}
          <CashCalculationRow label="Cash out" amount={calculation.cashOut} operator="−" />
          <CashCalculationRow label="Cash expenses" amount={calculation.cashExpenses} operator="−" />
          <CashCalculationRow label="Cash refunds" amount={calculation.cashRefunds} operator="−" />
        </div>
        {calculation.filerCashReceiptsExcluded !== 0 && (
          <div className="mt-3 flex items-center justify-between gap-4 border-t border-dashed border-gray-700 pt-3 text-sm">
            <span className="text-gray-400">Filer cash receipts (excluded)</span>
            <span className="whitespace-nowrap text-gray-500">{money(calculation.filerCashReceiptsExcluded)}</span>
          </div>
        )}
        <div className="mt-4 flex items-center justify-between gap-4 border-t border-gray-700 pt-4">
          <span className="text-sm font-semibold text-white">Current balance</span>
          <span className="text-xl font-bold text-brand-300">{money(calculation.currentBalance)}</span>
        </div>
      </section>
    </div>
  )
}

function CashCalculationRow({ label, amount, operator }: {
  label: string
  amount: number
  operator: '+' | '−'
}) {
  if (amount === 0) return null

  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-gray-300">{label}</span>
      <span className="whitespace-nowrap text-gray-100">
        {Number.isFinite(amount) ? `${operator} ${money(amount)}` : '—'}
      </span>
    </div>
  )
}
