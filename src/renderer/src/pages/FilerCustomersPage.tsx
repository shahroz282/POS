import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { FilerCustomerRow } from '@shared/schemas'

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

  const loadCustomers = useCallback(async () => {
    const result = await window.api.filerCustomersList(
      search, statusFilter ? statusFilter as FilerCustomerRow['payment_status'] : undefined
    )
    if (result.ok) setCustomers(result.data)
    else setError(result.error.message)
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
                <td className="px-3 py-3"><button type="button" onClick={() => startEdit(customer)} className="text-brand-300 hover:text-brand-200">Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {customers.length === 0 && <p className="py-10 text-center text-sm text-gray-500">No filer customers found.</p>}
      </div>

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
      <label><span className={labelClass}>Advance paid (PKR) *</span><input required type="number" min="0" step="1" value={form.advancePaid} onChange={(event) => setField('advancePaid', event.target.value)} className={inputClass} /></label>
      <div className="rounded border border-gray-800 bg-gray-950 px-3 py-2"><span className={labelClass}>Pending balance</span><p className="text-sm font-medium text-gray-100">{money(pendingBalance)}</p></div>
      <label><span className={labelClass}>Filing / payment proof (PDF, JPG, PNG; max 10 MB)</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setProofFile(event.target.files?.[0] ?? null)} className={`${inputClass} file:mr-3 file:border-0 file:bg-gray-800 file:px-2 file:py-1 file:text-xs`} />{proofFile && <span className="mt-1 block truncate text-xs text-gray-500">{proofFile.name}</span>}</label>
    </div>
  )
}
