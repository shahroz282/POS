import { useCallback, useEffect, useState } from 'react'
import type { ReportsReport } from '@shared/schemas'

const inputClass = 'border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none'

function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function money(value: number): string {
  return new Intl.NumberFormat('en-PK', {
    style: 'currency', currency: 'PKR', maximumFractionDigits: 2
  }).format(value)
}

export default function ReportsPage() {
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [report, setReport] = useState<ReportsReport | null>(null)
  const [selectedKey, setSelectedKey] = useState<ReportsReport['modules'][number]['key'] | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setError('')
    if (!fromDate || !toDate || fromDate > toDate) {
      setReport(null)
      setError('Select a valid date range.')
      return
    }
    setLoading(true)
    try {
      const result = await window.api.reportsLoad({ fromDate, toDate })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setReport(result.data)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Reports could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!selectedKey) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedKey(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedKey])

  const exportExcel = async () => {
    if (!report) return
    setExporting(true)
    setError('')
    setNotice('')
    try {
      const XLSX = await import('xlsx')
      const modules = [
        ['Module', 'Transactions', 'Billed / activity (PKR)', 'Cash received (PKR)', 'Non-cash received (PKR)', 'Refunds (PKR)', 'Outstanding (PKR)', 'Notes'],
        ...report.modules.map((module) => [
          module.label, module.transactionCount, module.grossAmount, module.cashReceived,
          module.nonCashReceived, module.refunds, module.outstanding, module.note ?? ''
        ])
      ]
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(modules), 'Module Summary')
      if (report.inventory) {
        const stockRows = [
          ['Inventory metric', 'Value'],
          ['Active products', report.inventory.productCount],
          ['Low-stock products', report.inventory.lowStockCount],
          ['Current stock quantity', report.inventory.stockQuantity],
          ['Current stock value (PKR)', report.inventory.stockValue ?? 'Not available'],
          ['Purchases in range', report.inventory.purchaseCount ?? 0],
          ['Purchase total (PKR)', report.inventory.purchaseTotal ?? 0],
          [],
          ['Movement type', 'Count', 'Quantity'],
          ...report.inventory.movements.map((movement) => [movement.type, movement.count, movement.quantity])
        ]
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(stockRows), 'Inventory')
      }
      if (report.cash) {
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
          ['Cash metric', 'Amount (PKR)'],
          ['Cash in', report.cash.cashIn],
          ['Cash out', report.cash.cashOut],
          ['Cash expenses', report.cash.cashExpenses]
        ]), 'Cash & Expenses')
      }
      const content = new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }))
      const result = await window.api.reportsExportExcel(content)
      if (!result.ok) setError(result.error.message)
      else if (result.data.saved) setNotice('Reports exported to Excel.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Excel export failed.')
    } finally {
      setExporting(false)
    }
  }

  const selectedModule = report?.modules.find((module) => module.key === selectedKey) ?? null
  const sales = report?.modules.find((module) => module.key === 'sales')

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <style>{`@media print { body * { visibility: hidden !important; } #reports-print, #reports-print * { visibility: visible !important; } #reports-print { display: block !important; position: absolute; inset: 0; width: 100%; padding: 8mm; color: #000; background: #fff; font: 10px Arial, sans-serif; } #reports-print table { width: 100%; border-collapse: collapse; } #reports-print th, #reports-print td { border: 1px solid #999; padding: 4px; color: #000 !important; } }`}</style>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-400">Module 10</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-100">Reports</h1>
          <p className="mt-1 text-sm text-gray-500">Date-filtered business and financial summaries.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-400">From
            <input className={`mt-1 block ${inputClass}`} type="date" value={fromDate} max={today()}
              onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="text-xs text-gray-400">To
            <input className={`mt-1 block ${inputClass}`} type="date" value={toDate} max={today()}
              onChange={(event) => setToDate(event.target.value)} />
          </label>
          <button type="button" onClick={() => void load()} disabled={loading}
            className="border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50">
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button type="button" onClick={() => window.print()} disabled={!report}
            className="border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50">
            Print / PDF
          </button>
          <button type="button" onClick={() => void exportExcel()} disabled={!report || exporting}
            className="bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50">
            {exporting ? 'Preparing…' : 'Export Excel'}
          </button>
        </div>
      </header>

      {error && <div role="alert" className="border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}
      {notice && <div role="status" className="border border-green-800 bg-green-950/30 p-3 text-sm text-green-300">{notice}</div>}

      {report && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Report totals">
            <Summary label="Date range" value={`${report.fromDate} — ${report.toDate}`} />
            <Summary label="Modules included" value={String(report.modules.length)} />
            {sales && <Summary label="Sales collected" value={money(sales.cashReceived + sales.nonCashReceived)} />}
            {report.salesProfit !== null && <Summary label="Sales profit" value={money(report.salesProfit)} />}
          </section>

          <section id="reports-print" className="space-y-3">
            <div className="hidden print:block">
              <h1>POS Reports</h1><p>{report.fromDate} to {report.toDate}</p>
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Report sections</h2>
              <p className="mt-1 text-xs text-gray-500">
                {report.role === 'CASHIER' ? 'Cashier access is limited to sales reports.' : 'Select a card to view the report summary and supporting details.'}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {report.modules.map((module) => (
                <button key={module.key} type="button" onClick={() => setSelectedKey(module.key)}
                  className="border border-gray-800 bg-gray-900/60 p-4 text-left transition hover:border-brand-500 hover:bg-gray-900">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-white">{module.label}</h3>
                    <span className="text-xs text-gray-500">{module.transactionCount} records</span>
                  </div>
                  <p className="mt-3 text-xs text-gray-400">{module.note ?? 'View date-range report summary.'}</p>
                  {module.key === 'sales' && report.salesProfit !== null &&
                    <p className="mt-3 text-sm text-green-300">Estimated profit: {money(report.salesProfit)}</p>}
                  <div className="mt-3 text-xs font-medium text-brand-300">View report →</div>
                </button>
              ))}
            </div>
            <table className="hidden w-full text-left text-sm print:table">
              <thead><tr><th>Module</th><th>Transactions</th><th>Gross / activity</th><th>Cash</th><th>Non-cash</th><th>Refunds</th><th>Outstanding</th></tr></thead>
              <tbody>{report.modules.map((module) => (
                <tr key={module.key}><td>{module.label}</td><td>{module.transactionCount}</td>
                  <td>{module.grossAmount}</td><td>{module.cashReceived}</td><td>{module.nonCashReceived}</td>
                  <td>{module.refunds}</td><td>{module.outstanding}</td></tr>
              ))}</tbody>
            </table>
          </section>
          <p className="text-xs text-gray-500">
            Filer advances have no separate payment dates or methods. Inventory purchase payment methods are not tracked and purchases are excluded from cash receipts.
            Profit is based on net sale revenue less returned amounts and recorded item costs.
          </p>
        </>
      )}

      {selectedModule && (
        <div role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedKey(null)
        }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="report-dialog-title"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-gray-700 bg-gray-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="report-dialog-title" className="text-xl font-semibold text-white">{selectedModule.label}</h2>
                <p className="mt-1 text-sm text-gray-400">{report?.fromDate} to {report?.toDate}</p>
              </div>
              <button type="button" autoFocus onClick={() => setSelectedKey(null)}
                className="border border-gray-700 px-3 py-1 text-sm text-gray-300 hover:bg-gray-800">Close</button>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Metric label="Transactions" value={String(selectedModule.transactionCount)} />
              <Metric label="Gross / activity" value={money(selectedModule.grossAmount)} />
              <Metric label="Cash received" value={money(selectedModule.cashReceived)} />
              <Metric label="Non-cash received" value={money(selectedModule.nonCashReceived)} />
              <Metric label="Refunds" value={money(selectedModule.refunds)} />
              <Metric label="Outstanding" value={money(selectedModule.outstanding)} />
              {selectedModule.key === 'sales' && report?.salesProfit !== null &&
                <Metric label="Estimated sales profit" value={money(report?.salesProfit ?? 0)} />}
              {selectedModule.key === 'inventory' && report?.inventory && <>
                <Metric label="Active products" value={String(report.inventory.productCount)} />
                <Metric label="Low-stock products" value={String(report.inventory.lowStockCount)} />
                <Metric label="Current stock quantity" value={String(report.inventory.stockQuantity)} />
                <Metric label="Current stock value" value={report.inventory.stockValue === null ? 'Not available' : money(report.inventory.stockValue)} />
                <Metric label="Purchases in range" value={String(report.inventory.purchaseCount ?? 0)} />
                <Metric label="Purchase total" value={money(report.inventory.purchaseTotal ?? 0)} />
              </>}
              {selectedModule.key === 'cash' && report?.cash && <>
                <Metric label="Cash in" value={money(report.cash.cashIn)} />
                <Metric label="Cash out" value={money(report.cash.cashOut)} />
                <Metric label="Cash expenses" value={money(report.cash.cashExpenses)} />
              </>}
              {selectedModule.key === 'inventory' && report?.inventory?.movements.map((movement) => (
                <Metric key={movement.type} label={`${movement.type} movements (${movement.count})`} value={`${movement.quantity} units`} />
              ))}
            </div>
            {selectedModule.note && <p className="mt-4 text-xs text-gray-400">{selectedModule.note}</p>}
          </section>
        </div>
      )}
    </div>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="border border-gray-800 bg-gray-900/60 p-4">
    <div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-sm font-semibold text-gray-100">{value}</div>
  </div>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border border-gray-800 bg-gray-950/50 p-3">
    <div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-sm font-semibold text-gray-200">{value}</div>
  </div>
}
