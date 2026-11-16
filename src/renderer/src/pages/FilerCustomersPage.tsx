import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { FilerCustomerPaymentRow, FilerCustomerRow } from '@shared/schemas'

type CustomerForm = {
  customerName: string
  cnic: string
  mobile: string
  filingDate: string
  category: FilerCustomerRow['category']
  totalFee: string
  advancePaid: string
}

const inputClass = 'w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-brand-500 focus:outline-none'
const labelClass = 'mb-1 block text-xs font-medium text-gray-400'
const categories: Array<{ value: FilerCustomerRow['category']; label: string }> = [
  { value: 'FRESH_FILER', label: 'Fresh Filer' },
  { value: 'ANNUAL_RETURN', label: 'Annual Return' },
  { value: 'OTHER_SERVICES', label: 'Other Services' }
]

function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function money(amount: number): string {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(amount)
}

function categoryLabel(category: FilerCustomerRow['category']): string {
  return categories.find((item) => item.value === category)?.label ?? category
}

function fileMimeType(file: File): 'image/jpeg' | 'image/png' | 'application/pdf' | null {
  if (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'application/pdf') return file.type
  const extension = file.name.toLowerCase().split('.').pop()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'pdf') return 'application/pdf'
  return null
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not read the selected proof file'))
        return
      }
      resolve(reader.result.slice(reader.result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(new Error('Could not read the selected proof file'))
    reader.readAsDataURL(file)
  })
}

export default function FilerCustomersPage() {
  const [customers, setCustomers] = useState<FilerCustomerRow[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<FilerCustomerRow | null>(null)
  const [form, setForm] = useState<CustomerForm>({
    customerName: '', cnic: '', mobile: '', filingDate: today(), category: 'FRESH_FILER', totalFee: '0', advancePaid: '0'
  })
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [ledgerCustomer, setLedgerCustomer] = useState<FilerCustomerRow | null>(null)
  const [payments, setPayments] = useState<FilerCustomerPaymentRow[]>([])
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH'>('CASH')
  const [paymentDate, setPaymentDate] = useState(today)
  const [paymentNote, setPaymentNote] = useState('')

  const loadCustomers = useCallback(async () => {
    const result = await window.api.filerCustomersList(
      search, statusFilter ? statusFilter as FilerCustomerRow['payment_status'] : undefined
    )
    if (result.ok) {
      setCustomers(result.data)
      return result.data
    }
    setError(result.error.message)
    return null
  }, [search, statusFilter])

  useEffect(() => {
    void loadCustomers()
  }, [loadCustomers])

  const totals = useMemo(() => ({
    customers: customers.length,
    pending: customers.filter((customer) => customer.payment_status === 'PENDING').length,
    balance: customers.reduce((sum, customer) => sum + customer.pending_balance, 0)
  }), [customers])

  const startCreate = () => {
    setFormOpen(true)
    setEditing(null)
    setForm({ customerName: '', cnic: '', mobile: '', filingDate: today(), category: 'FRESH_FILER', totalFee: '0', advancePaid: '0' })
    setProofFile(null)
    setError('')
    setNotice('')
  }

  const startEdit = (customer: FilerCustomerRow) => {
    setFormOpen(true)
    setEditing(customer)
    setForm({
      customerName: customer.customer_name,
      cnic: customer.cnic,
      mobile: customer.mobile ?? '',
      filingDate: customer.filing_date,
      category: customer.category,
      totalFee: String(customer.total_fee),
      advancePaid: String(customer.advance_paid)
    })
    setProofFile(null)
    setError('')
    setNotice('')
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditing(null)
    setProofFile(null)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    let stagedToken: string | null = null
    const discardStagedProof = async (token: string): Promise<string> => {
      try {
        const discarded = await window.api.filerCustomerDocumentDiscard(token)
        return discarded.ok ? '' : ` Temporary proof cleanup failed: ${discarded.error.message}`
      } catch (caught) {
        return ` Temporary proof cleanup failed: ${caught instanceof Error ? caught.message : 'Unknown error'}`
      }
    }
    try {
      if (proofFile) {
        const mimeType = fileMimeType(proofFile)
        if (!mimeType) {
          setError('Choose a PDF, JPG, or PNG proof file.')
          return
        }
        const staged = await window.api.filerCustomerDocumentStage({
          originalFilename: proofFile.name,
          mimeType,
          contentBase64: await fileToBase64(proofFile)
        })
        if (!staged.ok) {
          setError(staged.error.message)
          return
        }
        stagedToken = staged.data.token
      }

      const values = {
        customerName: form.customerName,
        cnic: form.cnic,
        mobile: form.mobile,
        filingDate: form.filingDate,
        category: form.category,
        totalFee: Number(form.totalFee),
        advancePaid: Number(form.advancePaid)
      }
      let customerId: number
      if (editing) {
        const saved = await window.api.filerCustomerUpdate({ ...values, customerId: editing.id })
        if (!saved.ok) {
          const cleanupError = stagedToken ? await discardStagedProof(stagedToken) : ''
          setError(`${saved.error.message}${cleanupError}`)
          return
        }
        customerId = editing.id
      } else {
        const saved = await window.api.filerCustomerCreate(values)
        if (!saved.ok) {
          const cleanupError = stagedToken ? await discardStagedProof(stagedToken) : ''
          setError(`${saved.error.message}${cleanupError}`)
          return
        }
        customerId = saved.data.id
      }

      if (stagedToken) {
        const committed = await window.api.filerCustomerDocumentCommit(customerId, stagedToken)
        if (!committed.ok) {
          const cleanupError = await discardStagedProof(stagedToken)
          setError(`Customer saved, but proof upload failed: ${committed.error.message}${cleanupError}`)
          closeForm()
          await loadCustomers()
          return
        }
      }

      closeForm()
      setNotice(editing ? 'Filer customer updated.' : 'Filer customer added.')
      await loadCustomers()
    } catch (caught) {
      const cleanupError = stagedToken ? await discardStagedProof(stagedToken) : ''
      setError(`${caught instanceof Error ? caught.message : 'The filer customer could not be saved.'}${cleanupError}`)
    } finally {
      setBusy(false)
    }
  }

  const openPayments = async (customer: FilerCustomerRow) => {
    const result = await window.api.filerCustomerPayments(customer.id)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setLedgerCustomer(customer)
    setPayments(result.data)
    setPaymentAmount('')
    setPaymentDate(today())
    setPaymentNote('')
  }

  const recordPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!ledgerCustomer) return
    setBusy(true)
    setError('')
    try {
      const result = await window.api.filerCustomerPaymentCreate({
        customerId: ledgerCustomer.id,
        idempotencyKey: crypto.randomUUID(),
        entryType: 'RECEIVED',
        amount: Number(paymentAmount),
        method: paymentMethod,
        paymentDate,
        note: paymentNote
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setNotice('Filer payment recorded.')
      const advancePaid = ledgerCustomer.advance_paid + Number(paymentAmount)
      const updatedCustomer = {
        ...ledgerCustomer,
        advance_paid: advancePaid,
        pending_balance: Math.max(0, ledgerCustomer.pending_balance - Number(paymentAmount)),
        payment_status: advancePaid >= ledgerCustomer.total_fee ? 'DONE' as const : 'PENDING' as const
      }
      await Promise.all([loadCustomers(), openPayments(updatedCustomer)])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not record filer payment.')
    } finally {
      setBusy(false)
    }
  }

  const viewProof = async (customer: FilerCustomerRow) => {
    if (!customer.proof_document_id) return
    const result = await window.api.filerCustomerDocumentRead(customer.id, customer.proof_document_id)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    const binary = atob(result.data.contentBase64)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: result.data.mimeType }))
    const link = document.createElement('a')
    link.href = url
    link.target = '_blank'
    link.rel = 'noreferrer'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const pendingBalance = Math.max(0, Number(form.totalFee || 0) - Number(form.advancePaid || 0))

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Filer Customers</h1>
          <p className="mt-1 text-sm text-gray-500">Manage filing clients, fee balances, and payment proof.</p>
        </div>
        {!formOpen && (
          <button type="button" onClick={startCreate} className="bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500">
            + Add customer
          </button>
        )}
      </div>

      {error && <div role="alert" className="mb-4 border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}
      {notice && <div role="status" className="mb-4 border border-green-800 bg-green-950/30 px-4 py-3 text-sm text-green-300">{notice}</div>}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Customers" value={String(totals.customers)} />
        <SummaryCard label="Pending payments" value={String(totals.pending)} />
        <SummaryCard label="Pending balance" value={money(totals.balance)} />
      </div>

      {formOpen && (
        <form id="filer-customer-form-open" onSubmit={(event) => void submit(event)} className="mb-5 border border-gray-800 bg-gray-900/60 p-4 sm:p-5">
          <fieldset disabled={busy} className="min-w-0">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-100">{editing ? 'Edit filer customer' : 'Add filer customer'}</h2>
            <button type="button" onClick={closeForm} className="text-xs text-gray-400 hover:text-gray-200">Cancel</button>
          </div>
          <CustomerFields form={form} setForm={setForm} proofFile={proofFile} setProofFile={setProofFile} pendingBalance={pendingBalance} />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={closeForm} className="border border-gray-700 px-4 py-2 text-sm text-gray-300">Cancel</button>
            <button type="submit" disabled={busy} className="bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : editing ? 'Save changes' : 'Add customer'}</button>
          </div>
          </fieldset>
        </form>
      )}

      <div className="mb-3 flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by customer name or CNIC…"
          className={`${inputClass} min-w-[240px] flex-1`}
          aria-label="Search filer customers"
        />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={`${inputClass} sm:w-48`} aria-label="Filter by payment status">
          <option value="">All payment statuses</option>
          <option value="PENDING">Pending</option>
          <option value="DONE">Done</option>
        </select>
      </div>

      <div className="overflow-x-auto border border-gray-800">
        <table className="w-full min-w-[1050px] text-left text-xs">
          <thead className="border-b border-gray-800 bg-gray-900 text-gray-500">
            <tr>{['Client name', 'CNIC', 'Mobile', 'Filing date', 'Category', 'Total fee', 'Advance', 'Pending', 'Status', 'Proof', ''].map((heading) =>
              <th key={heading} className="px-3 py-3 font-medium">{heading}</th>
            )}</tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {customers.map((customer) => (
              <tr key={customer.id} className="hover:bg-gray-900/50">
                <td className="px-3 py-3 font-medium text-gray-200">{customer.customer_name}</td>
                <td className="px-3 py-3 text-gray-300">{customer.cnic}</td>
                <td className="px-3 py-3 text-gray-300">{customer.mobile || '—'}</td>
                <td className="px-3 py-3 text-gray-300">{customer.filing_date}</td>
                <td className="px-3 py-3 text-gray-300">{categoryLabel(customer.category)}</td>
                <td className="px-3 py-3 text-gray-300">{money(customer.total_fee)}</td>
                <td className="px-3 py-3 text-gray-300">{money(customer.advance_paid)}</td>
                <td className="px-3 py-3 text-gray-200">{money(customer.pending_balance)}</td>
                <td className="px-3 py-3"><span className={`rounded px-2 py-1 font-medium ${customer.payment_status === 'DONE' ? 'bg-green-950 text-green-300' : 'bg-orange-950 text-orange-300'}`}>{customer.payment_status === 'DONE' ? 'Done' : 'Pending'}</span></td>
                <td className="px-3 py-3">
                  {customer.proof_document_id
                    ? <button type="button" onClick={() => void viewProof(customer)} className="text-brand-300 hover:text-brand-200">{customer.proof_filename || 'View proof'}</button>
                    : <span className="text-gray-600">—</span>}
                </td>
                <td className="px-3 py-3"><button type="button" onClick={() => void openPayments(customer)} className="mr-3 text-brand-300 hover:text-brand-200">Payments</button><button type="button" onClick={() => startEdit(customer)} className="text-gray-300 hover:text-white">Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {customers.length === 0 && <p className="py-10 text-center text-sm text-gray-500">No filer customers found.</p>}
      </div>

      {ledgerCustomer && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" role="presentation" onClick={() => setLedgerCustomer(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="filer-ledger-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-gray-700 bg-gray-900 p-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3"><div><h2 id="filer-ledger-title" className="text-lg font-semibold text-white">Filer payment ledger</h2><p className="mt-1 text-xs text-gray-400">{ledgerCustomer.customer_name} · balance {money(ledgerCustomer.pending_balance)}</p></div><button type="button" onClick={() => setLedgerCustomer(null)} className="text-sm text-gray-400">Close</button></div>
            <form onSubmit={(event) => void recordPayment(event)} className="grid gap-3 border-b border-gray-800 pb-4 sm:grid-cols-2">
              <label className="text-xs text-gray-400">Amount (PKR)<input className={`mt-1 ${inputClass}`} type="number" min="1" step="1" required max={ledgerCustomer.pending_balance} value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label>
              <label className="text-xs text-gray-400">Payment method<select className={`mt-1 ${inputClass}`} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}><option value="CASH">Cash</option><option value="BANK">Bank</option><option value="EASYPAISA">EasyPaisa</option><option value="JAZZCASH">JazzCash</option></select></label>
              <label className="text-xs text-gray-400">Payment date<input className={`mt-1 ${inputClass}`} type="date" required max={today()} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
              <label className="text-xs text-gray-400">Remark (optional)<input className={`mt-1 ${inputClass}`} maxLength={500} value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} /></label>
              <button type="submit" disabled={busy || ledgerCustomer.pending_balance <= 0} className="bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : 'Record payment'}</button>
            </form>
            <p className="my-3 text-xs text-gray-500">Only dated cash payments affect the till reconciliation; historical advances without payment details remain unclassified.</p>
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="border-b border-gray-800 text-gray-500"><tr>{['Date', 'Entry', 'Method', 'Amount', 'Note', 'Entered by'].map((head) => <th key={head} className="px-2 py-2">{head}</th>)}</tr></thead><tbody className="divide-y divide-gray-800">{payments.map((payment) => <tr key={payment.id}><td className="px-2 py-2 text-gray-400">{payment.payment_date}</td><td className={payment.entry_type === 'RECEIVED' ? 'px-2 py-2 text-green-300' : 'px-2 py-2 text-orange-300'}>{payment.entry_type}</td><td className="px-2 py-2 text-gray-300">{payment.method}</td><td className="px-2 py-2 text-gray-200">{money(payment.amount)}</td><td className="px-2 py-2 text-gray-400">{payment.note || '—'}</td><td className="px-2 py-2 text-gray-400">{payment.created_by_name}</td></tr>)}{payments.length === 0 && <tr><td colSpan={6} className="py-5 text-center text-gray-500">No payment entries.</td></tr>}</tbody></table></div>
          </section>
        </div>
      )}

    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return <div className="border border-gray-800 bg-gray-900/60 p-4"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-lg font-semibold text-gray-100">{value}</p></div>
}

function CustomerFields({
  form, setForm, proofFile, setProofFile, pendingBalance
}: {
  form: CustomerForm
  setForm: React.Dispatch<React.SetStateAction<CustomerForm>>
  proofFile: File | null
  setProofFile: (file: File | null) => void
  pendingBalance: number
}) {
  const setField = (field: keyof CustomerForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label><span className={labelClass}>Customer name *</span><input required maxLength={120} value={form.customerName} onChange={(event) => setField('customerName', event.target.value)} className={inputClass} /></label>
      <label><span className={labelClass}>CNIC *</span><input required maxLength={15} placeholder="XXXXX-XXXXXXX-X" value={form.cnic} onChange={(event) => setField('cnic', event.target.value)} className={inputClass} /></label>
      <label><span className={labelClass}>Mobile / WhatsApp</span><input maxLength={30} value={form.mobile} onChange={(event) => setField('mobile', event.target.value)} className={inputClass} /></label>
      <label><span className={labelClass}>Filing date *</span><input required type="date" value={form.filingDate} onChange={(event) => setField('filingDate', event.target.value)} className={inputClass} /></label>
      <label><span className={labelClass}>Filing category *</span><select value={form.category} onChange={(event) => setField('category', event.target.value)} className={inputClass}>{categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
      <label><span className={labelClass}>Total fee (PKR) *</span><input required type="number" min="0" step="1" value={form.totalFee} onChange={(event) => setField('totalFee', event.target.value)} className={inputClass} /></label>
      <label><span className={labelClass}>Opening advance (unclassified) (PKR) *</span><input required type="number" min="0" step="1" value={form.advancePaid} onChange={(event) => setField('advancePaid', event.target.value)} className={inputClass} /></label>
      <div className="rounded border border-gray-800 bg-gray-950 px-3 py-2"><span className={labelClass}>Pending balance</span><p className="text-sm font-medium text-gray-100">{money(pendingBalance)}</p></div>
      <label><span className={labelClass}>Filing / payment proof (PDF, JPG, PNG; max 10 MB)</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setProofFile(event.target.files?.[0] ?? null)} className={`${inputClass} file:mr-3 file:border-0 file:bg-gray-800 file:px-2 file:py-1 file:text-xs`} />{proofFile && <span className="mt-1 block truncate text-xs text-gray-500">{proofFile.name}</span>}</label>
    </div>
  )
}
