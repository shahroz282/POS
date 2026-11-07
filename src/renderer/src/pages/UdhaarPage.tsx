import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  UdhaarCustomerRow, UdhaarEntryRow, UdhaarOutstandingGroup, UdhaarRepaymentResult
} from '@shared/schemas'

type FormMode = 'customer' | 'charge' | 'repayment'
type CustomerForm = { name: string; phone: string; address: string }
type EntryForm = { amount: string; note: string; entryDate: string; method: 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH'; referenceNumber: string }

const inputClass = 'w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-brand-500 focus:outline-none'
const labelClass = 'mb-1 block text-xs font-medium text-gray-400'
const sectionClass = 'border border-gray-800 bg-gray-900/60 p-4'
const methods = ['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH'] as const

function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function money(amount: number): string {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 2 }).format(amount)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character] ?? character)
}

function printReceipt(receipt: UdhaarRepaymentResult): void {
  const printWindow = window.open('', '_blank', 'width=420,height=640')
  if (!printWindow) return
  printWindow.document.write(`<!doctype html><html><head><title>Udhaar repayment receipt</title><style>
    body{font:14px Arial,sans-serif;color:#111;padding:24px}h1{text-align:center;font-size:20px}
    hr{border:0;border-top:1px solid #aaa;margin:18px 0}.row{display:flex;justify-content:space-between;margin:10px 0}
    .amount{font-size:20px;font-weight:bold}.foot{text-align:center;margin-top:30px;font-size:12px}
  </style></head><body><h1>Udhaar Repayment Receipt</h1><hr>
    <div class="row"><span>Receipt</span><strong>${escapeHtml(receipt.receiptNumber)}</strong></div>
    <div class="row"><span>Customer</span><strong>${escapeHtml(receipt.customerName)}</strong></div>
    <div class="row"><span>Date</span><strong>${escapeHtml(receipt.entryDate)}</strong></div>
    <div class="row"><span>Method</span><strong>${escapeHtml(receipt.method)}</strong></div>
    ${receipt.referenceNumber ? `<div class="row"><span>Reference</span><strong>${escapeHtml(receipt.referenceNumber)}</strong></div>` : ''}
    <hr><div class="row amount"><span>Received</span><strong>${escapeHtml(money(receipt.amount))}</strong></div>
    <div class="row"><span>Remaining balance</span><strong>${escapeHtml(money(receipt.balance))}</strong></div>
    <div class="foot">Thank you</div><script>window.onload=()=>window.print()</script></body></html>`)
  printWindow.document.close()
}

export default function UdhaarPage() {
  const [view, setView] = useState<'all' | 'ledger'>('all')
  const [customers, setCustomers] = useState<UdhaarCustomerRow[]>([])
  const [outstandingGroups, setOutstandingGroups] = useState<UdhaarOutstandingGroup[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [outstandingSearch, setOutstandingSearch] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [entries, setEntries] = useState<UdhaarEntryRow[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [mode, setMode] = useState<FormMode | null>(null)
  const [customerForm, setCustomerForm] = useState<CustomerForm>({ name: '', phone: '', address: '' })
  const [entryForm, setEntryForm] = useState<EntryForm>({
    amount: '', note: '', entryDate: today(), method: 'CASH', referenceNumber: ''
  })
  const [latestReceipt, setLatestReceipt] = useState<UdhaarRepaymentResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const selectedCustomer = customers.find((customer) => customer.id === selectedId) ?? null
  const selectedGroup = outstandingGroups.find((group) => group.id === selectedGroupId) ?? null
  const loadCustomers = useCallback(async () => {
    const result = await window.api.udhaarCustomers(
      search, statusFilter ? statusFilter as UdhaarCustomerRow['status'] : undefined
    )
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setCustomers(result.data)
    if (selectedId !== null && !result.data.some((customer) => customer.id === selectedId)) {
      setSelectedId(null)
      setEntries([])
    }
  }, [search, statusFilter, selectedId])

  const loadEntries = useCallback(async (customerId: number) => {
    const result = await window.api.udhaarEntries(customerId)
    if (result.ok) setEntries(result.data)
    else setError(result.error.message)
  }, [])

  const loadOutstanding = useCallback(async () => {
    const result = await window.api.udhaarAllOutstanding()
    if (result.ok) {
      setOutstandingGroups(result.data)
      setSelectedGroupId((current) => current && result.data.some((group) => group.id === current)
        ? current : null)
    } else {
      setError(result.error.message)
    }
  }, [])

  useEffect(() => {
    void loadCustomers()
  }, [loadCustomers])

  useEffect(() => {
    void loadOutstanding()
  }, [loadOutstanding])

  useEffect(() => {
    if (view !== 'all' || !selectedGroupId) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedGroupId(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [view, selectedGroupId])

  useEffect(() => {
    if (selectedId !== null) void loadEntries(selectedId)
  }, [selectedId, loadEntries])

  const totals = useMemo(() => ({
    customers: customers.length,
    outstanding: customers.filter((customer) => customer.balance > 0).length,
    balance: customers.reduce((sum, customer) => sum + customer.balance, 0)
  }), [customers])
  const allOutstandingTotal = outstandingGroups.reduce((sum, group) => sum + group.totalOutstanding, 0)
  const matchingOutstandingGroups = outstandingGroups.filter((group) => {
    const query = outstandingSearch.trim().toLocaleLowerCase()
    return !query || group.name.toLocaleLowerCase().includes(query) ||
      group.phone?.toLocaleLowerCase().includes(query) ||
      group.items.some((item) => [
        item.sourceLabel, item.detail, item.reference, item.personName
      ].some((value) => value?.toLocaleLowerCase().includes(query)))
  })

  const selectCustomer = (customerId: number) => {
    setSelectedId(customerId)
    setMode(null)
    setEntries([])
    setLatestReceipt(null)
    setError('')
  }

  const backToCustomers = () => {
    setSelectedId(null)
    setEntries([])
    setMode(null)
    setLatestReceipt(null)
    setError('')
  }

  const closeOutstandingDetails = () => setSelectedGroupId(null)

  const openMode = (nextMode: FormMode) => {
    setError('')
    setNotice('')
    setMode(nextMode)
    setCustomerForm({ name: '', phone: '', address: '' })
    setEntryForm({ amount: '', note: '', entryDate: today(), method: 'CASH', referenceNumber: '' })
  }

  const refreshLedger = async (customerId: number) => {
    await Promise.all([loadCustomers(), loadEntries(customerId), loadOutstanding()])
  }

  const openCustomerLedger = (group: UdhaarOutstandingGroup) => {
    const accountItem = group.items.find((item) => item.source === 'UDHAAR')
    if (!accountItem) return
    const customerId = Number(accountItem.id.slice('UDHAAR:'.length))
    if (!Number.isInteger(customerId) || customerId <= 0) return
    setView('ledger')
    setSearch('')
    setStatusFilter('')
    setSelectedId(customerId)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (mode === 'customer') {
        const result = await window.api.udhaarCustomerCreate(customerForm)
        if (!result.ok) {
          setError(result.error.message)
          return
        }
        setSelectedId(result.data.id)
        setMode(null)
        setNotice('Customer ledger created.')
        await Promise.all([loadCustomers(), loadOutstanding()])
        return
      }

      if (!selectedCustomer || !mode) return
      const base = {
        customerId: selectedCustomer.id,
        idempotencyKey: crypto.randomUUID(),
        amount: Number(entryForm.amount),
        note: entryForm.note,
        entryDate: entryForm.entryDate
      }
      if (mode === 'charge') {
        const result = await window.api.udhaarChargeCreate(base)
        if (!result.ok) {
          setError(result.error.message)
          return
        }
        setNotice('Udhaar charge added to the customer ledger.')
      } else {
        const result = await window.api.udhaarRepaymentCreate({
          ...base,
          method: entryForm.method,
          referenceNumber: entryForm.referenceNumber
        })
        if (!result.ok) {
          setError(result.error.message)
          return
        }
        setLatestReceipt(result.data)
        setNotice(`Repayment recorded. Receipt ${result.data.receiptNumber}.`)
      }
      setMode(null)
      await refreshLedger(selectedCustomer.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The Udhaar entry could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const formTitle = mode === 'customer' ? 'Add customer' : mode === 'charge' ? 'Add manual udhaar charge' : 'Receive repayment'

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Udhaar ledger</h1>
          <p className="mt-1 text-sm text-gray-500">Track customer credit, repayments, and outstanding balances.</p>
        </div>
        <button type="button" onClick={() => openMode('customer')} className="bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500">
          + Add customer
        </button>
      </div>

      {error && <div role="alert" className="mb-4 border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}
      {notice && <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 border border-green-800 bg-green-950/30 px-4 py-3 text-sm text-green-300">
        <span>{notice}</span>
        {latestReceipt && <button type="button" onClick={() => printReceipt(latestReceipt)} className="text-green-200 underline">Print receipt</button>}
      </div>}

      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setView('all')}
          className={`px-3 py-2 text-sm ${view === 'all' ? 'bg-brand-700 text-white' : 'border border-gray-700 text-gray-400 hover:text-gray-200'}`}>
          All outstanding
        </button>
        <button type="button" onClick={() => setView('ledger')}
          className={`px-3 py-2 text-sm ${view === 'ledger' ? 'bg-brand-700 text-white' : 'border border-gray-700 text-gray-400 hover:text-gray-200'}`}>
          Customer Udhaar ledger
        </button>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {view === 'all' ? <>
          <SummaryCard label="Customers with outstanding" value={String(outstandingGroups.length)} />
          <SummaryCard label="Outstanding records" value={String(outstandingGroups.reduce((sum, group) => sum + group.items.length, 0))} />
          <SummaryCard label="All module outstanding" value={money(allOutstandingTotal)} />
        </> : <>
          <SummaryCard label="Customer ledgers" value={String(totals.customers)} />
          <SummaryCard label="With outstanding balance" value={String(totals.outstanding)} />
          <SummaryCard label="Udhaar outstanding total" value={money(totals.balance)} />
        </>}
      </div>

      {view === 'all' ? (
        <section className={sectionClass}>
          <h2 className="mb-3 text-sm font-semibold text-gray-100">Outstanding by customer</h2>
          <input value={outstandingSearch} onChange={(event) => setOutstandingSearch(event.target.value)}
            placeholder="Search customer, module, or reference…" aria-label="Search all outstanding records" className={`${inputClass} mb-3 max-w-xl`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-gray-800 text-gray-500">
                <tr>{['Customer', 'Phone', 'Outstanding modules', 'Records', 'Total outstanding', 'Details'].map((head) =>
                  <th key={head} className="px-3 py-3 font-medium">{head}</th>
                )}</tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {matchingOutstandingGroups.map((group) => (
                  <tr key={group.id} className="hover:bg-gray-800/40">
                    <td className="px-3 py-3 font-medium text-gray-200">{group.name}</td>
                    <td className="px-3 py-3 text-gray-400">{group.phone || '—'}</td>
                    <td className="px-3 py-3 text-gray-400">{[...new Set(group.items.map((item) => item.sourceLabel))].join(' · ')}</td>
                    <td className="px-3 py-3 text-gray-400">{group.items.length}</td>
                    <td className="px-3 py-3 font-semibold text-orange-300">{money(group.totalOutstanding)}</td>
                    <td className="px-3 py-3">
                      <button type="button" onClick={() => setSelectedGroupId(group.id)}
                        className="text-brand-300 hover:text-brand-200">View details</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {matchingOutstandingGroups.length === 0 && <p className="py-8 text-center text-xs text-gray-500">No outstanding balances found.</p>}
          </div>
          <p className="mt-3 text-[11px] text-gray-600">Records are grouped by exact CNIC when available, otherwise by exact phone number. Records without either identifier remain separate to avoid merging different people.</p>
        </section>
      ) : <div className={`grid gap-4 ${selectedCustomer ? 'grid-cols-1' : 'xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.8fr)]'}`}>
        {!selectedCustomer && <section className={sectionClass}>
          <h2 className="mb-3 text-sm font-semibold text-gray-100">Customer accounts</h2>
          <div className="mb-3 grid gap-2">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or phone…" aria-label="Search customers" className={inputClass} />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter customer balance status" className={inputClass}>
              <option value="">All accounts</option>
              <option value="OUTSTANDING">Outstanding</option>
              <option value="SETTLED">Settled</option>
            </select>
          </div>
          <div className="max-h-[650px] overflow-y-auto divide-y divide-gray-800">
            {customers.map((customer) => (
              <button key={customer.id} type="button" onClick={() => selectCustomer(customer.id)}
                className={`w-full px-3 py-3 text-left transition-colors ${selectedId === customer.id ? 'bg-brand-950/50' : 'hover:bg-gray-800/60'}`}>
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-200">{customer.name}</span>
                    <span className="mt-1 block text-xs text-gray-500">{customer.phone || 'No phone recorded'}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`block text-sm font-semibold ${customer.balance > 0 ? 'text-orange-300' : 'text-green-300'}`}>{money(customer.balance)}</span>
                    <span className="text-[11px] text-gray-500">{customer.balance > 0 ? 'Outstanding' : 'Settled'}</span>
                  </span>
                </span>
              </button>
            ))}
            {customers.length === 0 && <p className="py-8 text-center text-xs text-gray-500">No customer accounts found.</p>}
          </div>
        </section>}

        <section className={`${sectionClass} ${selectedCustomer ? '' : 'hidden'}`}>
          {!selectedCustomer ? (
            <div className="flex min-h-64 items-center justify-center text-sm text-gray-500">Select a customer to view their ledger.</div>
          ) : (
            <>
              <div className="mb-4">
                <button type="button" onClick={backToCustomers} className="mb-4 text-xs text-brand-300 hover:text-brand-200">
                  ← Back to customer accounts
                </button>
                <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-100">{selectedCustomer.name}</h2>
                  <p className="mt-1 text-xs text-gray-500">{selectedCustomer.phone || 'No phone'}{selectedCustomer.address ? ` · ${selectedCustomer.address}` : ''}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">Current balance</p>
                  <p className={`text-xl font-semibold ${selectedCustomer.balance > 0 ? 'text-orange-300' : 'text-green-300'}`}>{money(selectedCustomer.balance)}</p>
                </div>
                </div>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div className="rounded border border-gray-800 bg-gray-950 p-3"><p className="text-xs text-gray-500">Total charges</p><p className="mt-1 font-medium text-gray-200">{money(selectedCustomer.total_charges)}</p></div>
                <div className="rounded border border-gray-800 bg-gray-950 p-3"><p className="text-xs text-gray-500">Total repayments</p><p className="mt-1 font-medium text-gray-200">{money(selectedCustomer.total_repayments)}</p></div>
              </div>
              <div className="mb-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => openMode('charge')} className="border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800">+ Add charge</button>
                <button type="button" disabled={selectedCustomer.balance <= 0} onClick={() => openMode('repayment')}
                  className="bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40">Receive repayment</button>
              </div>

              {mode && mode !== 'customer' && (
                <form onSubmit={(event) => void submit(event)} className="mb-4 border border-gray-700 bg-gray-950/70 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-200">{formTitle}</h3>
                    <button type="button" disabled={busy} onClick={() => setMode(null)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                      <label><span className={labelClass}>Amount (PKR) *</span><input required type="number" min="1" max={mode === 'repayment' ? selectedCustomer.balance : 100_000_000} step="1" value={entryForm.amount} onChange={(event) => setEntryForm((current) => ({ ...current, amount: event.target.value }))} className={inputClass} /></label>
                      <label><span className={labelClass}>Date *</span><input required type="date" value={entryForm.entryDate} onChange={(event) => setEntryForm((current) => ({ ...current, entryDate: event.target.value }))} className={inputClass} /></label>
                      {mode === 'repayment' && <>
                        <label><span className={labelClass}>Payment method *</span><select value={entryForm.method} onChange={(event) => setEntryForm((current) => ({ ...current, method: event.target.value as EntryForm['method'] }))} className={inputClass}>{methods.map((method) => <option key={method} value={method}>{method}</option>)}</select></label>
                        <label><span className={labelClass}>Reference number</span><input maxLength={100} value={entryForm.referenceNumber} onChange={(event) => setEntryForm((current) => ({ ...current, referenceNumber: event.target.value }))} className={inputClass} /></label>
                      </>}
                      <label className="sm:col-span-2"><span className={labelClass}>Note</span><input maxLength={500} value={entryForm.note} onChange={(event) => setEntryForm((current) => ({ ...current, note: event.target.value }))} className={inputClass} /></label>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button type="submit" disabled={busy} className="bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : mode === 'charge' ? 'Add charge' : 'Record repayment'}</button>
                  </div>
                </form>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[660px] text-left text-xs">
                  <thead className="border-b border-gray-800 text-gray-500"><tr>{['Date', 'Entry', 'Details', 'Charge', 'Repayment', 'Balance', 'Receipt', 'Entered by'].map((head) => <th key={head} className="px-2 py-2 font-medium">{head}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-800">
                    {entries.map((entry, index) => {
                      const newerEntriesEffect = entries.slice(0, index).reduce(
                        (sum, item) => sum + (item.type === 'CHARGE' ? item.amount : -item.amount), 0
                      )
                      const balanceAfterEntry = selectedCustomer.balance - newerEntriesEffect
                      return <tr key={entry.id}>
                        <td className="px-2 py-2 text-gray-300">{entry.entry_date}</td>
                        <td className={`px-2 py-2 ${entry.type === 'CHARGE' ? 'text-orange-300' : 'text-green-300'}`}>{entry.type === 'CHARGE' ? entry.sale_id ? 'Sale credit' : 'Manual charge' : 'Repayment'}</td>
                        <td className="px-2 py-2 text-gray-400">{entry.invoice_no ? `Invoice ${entry.invoice_no}` : entry.note || entry.method || '—'}{entry.reference_no ? ` · ${entry.reference_no}` : ''}</td>
                        <td className="px-2 py-2 text-gray-300">{entry.type === 'CHARGE' ? money(entry.amount) : '—'}</td>
                        <td className="px-2 py-2 text-gray-300">{entry.type === 'REPAYMENT' ? money(entry.amount) : '—'}</td>
                        <td className="px-2 py-2 font-medium text-gray-200">{money(balanceAfterEntry)}</td>
                        <td className="px-2 py-2">{entry.receipt_no ? <button type="button" onClick={() => printReceipt({
                          id: entry.id, receiptNumber: entry.receipt_no!, amount: entry.amount,
                          balance: balanceAfterEntry, entryDate: entry.entry_date,
                          method: entry.method as UdhaarRepaymentResult['method'],
                          referenceNumber: entry.reference_no, customerName: selectedCustomer.name
                        })} className="text-brand-300 hover:text-brand-200">{entry.receipt_no}</button> : '—'}</td>
                        <td className="px-2 py-2 text-gray-500">{entry.created_by_name}</td>
                      </tr>
                    })}
                  </tbody>
                </table>
                {entries.length === 0 && <p className="py-8 text-center text-xs text-gray-500">No charges or repayments recorded yet.</p>}
              </div>
            </>
          )}
        </section>
      </div>}

      {view === 'all' && selectedGroup && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
          role="presentation"
          onClick={closeOutstandingDetails}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="outstanding-details-title"
            className="max-h-[90vh] w-full max-w-6xl overflow-y-auto border border-gray-700 bg-gray-900 p-4 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="outstanding-details-title" className="text-lg font-semibold text-gray-100">{selectedGroup.name}</h2>
                <p className="mt-1 text-xs text-gray-500">{selectedGroup.phone || 'Contact number not recorded'} · {selectedGroup.items.length} outstanding record(s)</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-xs text-gray-500">Combined outstanding</p>
                  <p className="text-xl font-semibold text-orange-300">{money(selectedGroup.totalOutstanding)}</p>
                </div>
                <button type="button" autoFocus onClick={closeOutstandingDetails}
                  className="border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800">
                  Close
                </button>
              </div>
            </div>
            {selectedGroup.items.some((item) => item.source === 'UDHAAR') && (
              <button type="button" onClick={() => openCustomerLedger(selectedGroup)}
                className="mb-3 border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800">
                Open customer Udhaar ledger
              </button>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="border-b border-gray-800 text-gray-500">
                  <tr>{['Module', 'Customer / record detail', 'Reference', 'Date / due', 'Total', 'Paid', 'Outstanding'].map((head) =>
                    <th key={head} className="px-2 py-2 font-medium">{head}</th>
                  )}</tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {selectedGroup.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-2 py-3 text-brand-300">{item.sourceLabel}</td>
                      <td className="px-2 py-3">
                        <span className="block text-gray-200">{item.personName !== selectedGroup.name ? item.personName : item.detail}</span>
                        {item.personName !== selectedGroup.name && <span className="mt-1 block text-gray-500">{item.detail}</span>}
                      </td>
                      <td className="px-2 py-3 text-gray-400">{item.reference || '—'}</td>
                      <td className="px-2 py-3 text-gray-400">{item.entryDate || '—'}</td>
                      <td className="px-2 py-3 text-gray-300">{money(item.totalAmount)}</td>
                      <td className="px-2 py-3 text-gray-300">{money(item.paidAmount)}</td>
                      <td className="px-2 py-3 font-semibold text-orange-300">{money(item.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-gray-700">
                  <tr><td colSpan={6} className="px-2 py-3 text-right font-semibold text-gray-200">Combined outstanding</td>
                    <td className="px-2 py-3 font-semibold text-orange-300">{money(selectedGroup.totalOutstanding)}</td></tr>
                </tfoot>
              </table>
            </div>
          </section>
        </div>
      )}

      {mode === 'customer' && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/70 p-4" role="presentation">
          <form onSubmit={(event) => void submit(event)} className="w-full max-w-lg border border-gray-700 bg-gray-900 p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="udhaar-customer-title">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="udhaar-customer-title" className="text-base font-semibold text-gray-100">Add customer account</h2>
              <button type="button" disabled={busy} onClick={() => setMode(null)} className="text-xs text-gray-400">Cancel</button>
            </div>
            <div className="grid gap-3">
              <label><span className={labelClass}>Customer name *</span><input required maxLength={120} value={customerForm.name} onChange={(event) => setCustomerForm((current) => ({ ...current, name: event.target.value }))} className={inputClass} /></label>
              <label><span className={labelClass}>Phone</span><input maxLength={30} value={customerForm.phone} onChange={(event) => setCustomerForm((current) => ({ ...current, phone: event.target.value }))} className={inputClass} /></label>
              <label><span className={labelClass}>Address</span><input maxLength={500} value={customerForm.address} onChange={(event) => setCustomerForm((current) => ({ ...current, address: event.target.value }))} className={inputClass} /></label>
            </div>
            <div className="mt-5 flex justify-end"><button type="submit" disabled={busy} className="bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : 'Create account'}</button></div>
          </form>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return <div className="border border-gray-800 bg-gray-900/60 p-4"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-lg font-semibold text-gray-100">{value}</p></div>
}
