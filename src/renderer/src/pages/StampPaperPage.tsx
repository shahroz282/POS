import { useEffect, useRef, useState } from 'react'
import type { Role } from '@shared/constants'
import type { SimpleStampSaleDetail, SimpleStampSaleRow, StampDocumentRow } from '@shared/schemas'

type PaymentMethod = 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH'
type TransactionStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED'
type Attachment = { token: string; name: string; mimeType: string; size: number; previewUrl: string }

const inputClass = 'w-full min-w-0 border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-brand-500 focus:outline-none'
const labelClass = 'mb-1 block text-xs font-medium text-gray-400'
const sectionClass = 'border border-gray-800 bg-gray-900/60 p-4 sm:p-5'

function parsePaisa(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null
  const [rupees, fraction = ''] = value.trim().split('.')
  return Number(rupees) * 100 + Number(fraction.padEnd(2, '0'))
}

function formatPkr(paisa: number): string {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', minimumFractionDigits: 2 }).format(paisa / 100)
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const encoded = String(reader.result)
      const comma = encoded.indexOf(',')
      if (comma < 0) reject(new Error('Could not read the selected file'))
      else resolve(encoded.slice(comma + 1))
    }
    reader.onerror = () => reject(new Error('Could not read the selected file'))
    reader.readAsDataURL(file)
  })
}

export default function StampPaperPage() {
  const [role, setRole] = useState<Role>('CASHIER')
  const [operator, setOperator] = useState('')
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new')
  const [transactionId, setTransactionId] = useState(() => crypto.randomUUID())
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [referenceName, setReferenceName] = useState('')
  const [hasTicketNumber, setHasTicketNumber] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [registration, setRegistration] = useState('')
  const [status, setStatus] = useState<TransactionStatus>('PENDING')
  const [salePrice, setSalePrice] = useState('0.00')
  const [serviceCharges, setServiceCharges] = useState('0.00')
  const [otherFees, setOtherFees] = useState('0.00')
  const [amountReceived, setAmountReceived] = useState('0.00')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentRemarks, setPaymentRemarks] = useState('')
  const [remarks, setRemarks] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sales, setSales] = useState<SimpleStampSaleRow[]>([])
  const [query, setQuery] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [selectedSale, setSelectedSale] = useState<SimpleStampSaleDetail | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [laterPaymentMethod, setLaterPaymentMethod] = useState<PaymentMethod>('CASH')
  const [preview, setPreview] = useState<{ name: string; mimeType: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [requiredFieldErrors, setRequiredFieldErrors] = useState<{ registration?: string }>({})
  const attachmentsRef = useRef(attachments)
  const previewRef = useRef(preview)
  attachmentsRef.current = attachments
  previewRef.current = preview

  const salePricePaisa = parsePaisa(salePrice) ?? 0
  const servicePaisa = parsePaisa(serviceCharges) ?? 0
  const otherPaisa = parsePaisa(otherFees) ?? 0
  const receivedPaisa = parsePaisa(amountReceived) ?? 0
  const totalPaisa = salePricePaisa + servicePaisa + otherPaisa
  const balancePaisa = totalPaisa - receivedPaisa
  const canManageDocuments = role === 'ADMIN' || role === 'MANAGER'

  const loadSales = async (search = query) => {
    const result = await window.api.simpleStampList(search, fromDate || undefined, toDate || undefined)
    if (result.ok) setSales(result.data)
    else setError(result.error.message)
  }

  useEffect(() => {
    void (async () => {
      const session = await window.api.authGetSession()
      if (session.ok && session.data) {
        setRole(session.data.role)
        setOperator(session.data.name)
      }
      const result = await window.api.simpleStampList('')
      if (result.ok) setSales(result.data)
      else setError(result.error.message)
    })()
  }, [])

  useEffect(() => () => {
    for (const attachment of attachmentsRef.current) URL.revokeObjectURL(attachment.previewUrl)
    if (previewRef.current?.url.startsWith('blob:')) URL.revokeObjectURL(previewRef.current.url)
  }, [])

  const uploadFiles = async (files: FileList | File[]) => {
    setError('')
    for (const file of Array.from(files)) {
      if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
        setError(`${file.name}: select a JPEG, PNG, or PDF file.`)
        continue
      }
      if (file.size < 1 || file.size > 10 * 1024 * 1024) {
        setError(`${file.name}: each attachment must be 10 MB or smaller.`)
        continue
      }
      setBusy(true)
      try {
        const result = await window.api.simpleStampDocumentStage({
          category: 'SUPPORTING',
          originalFilename: file.name,
          mimeType: file.type,
          contentBase64: await readBase64(file)
        })
        if (!result.ok) throw new Error(result.error.message)
        setAttachments((current) => [...current, {
          token: result.data.token,
          name: result.data.originalFilename,
          mimeType: result.data.mimeType,
          size: result.data.fileSize,
          previewUrl: URL.createObjectURL(file)
        }])
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : `Could not upload ${file.name}`)
      } finally {
        setBusy(false)
      }
    }
  }

  const removeAttachment = async (attachment: Attachment) => {
    await window.api.simpleStampDocumentDiscard(attachment.token)
    URL.revokeObjectURL(attachment.previewUrl)
    setAttachments((current) => current.filter((item) => item.token !== attachment.token))
  }

  const saveTransaction = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setNotice('')
    const requiredErrors = {
      registration: registration.trim() ? undefined : 'Enter the registration.'
    }
    setRequiredFieldErrors(requiredErrors)
    if (requiredErrors.registration) {
      setError('Please complete the highlighted required fields.')
      return
    }
    const sale = parsePaisa(salePrice)
    const charges = parsePaisa(serviceCharges)
    const fees = parsePaisa(otherFees)
    const received = parsePaisa(amountReceived)
    if (sale === null || charges === null || fees === null || received === null) {
      setError('Enter valid amounts with no more than two decimal places.')
      return
    }
    if (received > sale + charges + fees) {
      setError('Amount received cannot exceed total payable.')
      return
    }
    if (status === 'CANCELLED' && received > 0) {
      setError('Cancelled transactions cannot receive payment. Record it as Pending or Completed instead.')
      return
    }

    setBusy(true)
    try {
      const result = await window.api.simpleStampCreate({
        transactionId,
        idempotencyKey,
        referenceName,
        hasTicketNumber,
        customerName,
        registration,
        status,
        salePricePaisa: sale,
        serviceChargesPaisa: charges,
        otherFeesPaisa: fees,
        amountReceivedPaisa: received,
        paymentMethod,
        paymentReferenceNumber: paymentReference,
        paymentRemarks,
        remarks,
        stagedDocumentTokens: attachments.map((attachment) => attachment.token)
      })
      if (!result.ok) throw new Error(result.error.message)
      const detail = await window.api.simpleStampDetail(result.data.id)
      if (detail.ok) setSelectedSale(detail.data)
      attachments.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl))
      setAttachments([])
      setNotice(`Transaction saved. Invoice ${result.data.invoice_number}`)
      setTransactionId(crypto.randomUUID())
      setIdempotencyKey(crypto.randomUUID())
      setReferenceName('')
      setHasTicketNumber(false)
      setRequiredFieldErrors({})
      setCustomerName('')
      setRegistration('')
      setStatus('PENDING')
      setSalePrice('0.00')
      setServiceCharges('0.00')
      setOtherFees('0.00')
      setAmountReceived('0.00')
      setPaymentReference('')
      setPaymentRemarks('')
      setRemarks('')
      await loadSales('')
      setActiveTab('history')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save stamp paper transaction')
    } finally {
      setBusy(false)
    }
  }

  const openTransaction = async (sale: SimpleStampSaleRow) => {
    setError('')
    const result = await window.api.simpleStampDetail(sale.id)
    if (!result.ok) return setError(result.error.message)
    setSelectedSale(result.data)
    setPaymentAmount((result.data.outstanding_balance_paisa / 100).toFixed(2))
  }

  const recordPayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedSale) return
    const amount = parsePaisa(paymentAmount)
    if (!amount || amount <= 0) return setError('Enter a payment amount greater than zero.')
    setBusy(true)
    setError('')
    const result = await window.api.simpleStampPayment({ saleId: selectedSale.id, amountPaisa: amount, method: laterPaymentMethod })
    if (!result.ok) setError(result.error.message)
    else {
      setNotice(`Payment recorded. Receipt ${result.data.receiptNumber}`)
      await loadSales()
      const refreshed = await window.api.simpleStampDetail(selectedSale.id)
      if (refreshed.ok) {
        setSelectedSale(refreshed.data)
        setPaymentAmount((refreshed.data.outstanding_balance_paisa / 100).toFixed(2))
      }
    }
    setBusy(false)
  }

  const openAttachment = async (document: StampDocumentRow) => {
    if (!selectedSale) return
    const result = await window.api.simpleStampDocumentRead(selectedSale.id, document.id)
    if (!result.ok) return setError(result.error.message)
    setPreview({ name: result.data.originalFilename, mimeType: result.data.mimeType, url: `data:${result.data.mimeType};base64,${result.data.contentBase64}` })
  }

  const removeSavedAttachment = async (document: StampDocumentRow) => {
    if (!selectedSale || !window.confirm(`Remove ${document.original_filename}?`)) return
    const result = await window.api.simpleStampDocumentRemove(selectedSale.id, document.id)
    if (!result.ok) setError(result.error.message)
    else {
      const detail = await window.api.simpleStampDetail(selectedSale.id)
      if (detail.ok) setSelectedSale(detail.data)
    }
  }

  const amountField = (label: string, value: string, onChange: (value: string) => void) => (
    <label><span className={labelClass}>{label} (PKR)</span><input className={inputClass} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} required placeholder="0.00" /></label>
  )

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <style>{`@media print { body * { visibility: hidden !important; } #stamp-receipt, #stamp-receipt * { visibility: visible !important; } #stamp-receipt { display: block !important; position: absolute; inset: 0; width: 80mm; padding: 6mm; color: #000; background: #fff; font: 12px Arial, sans-serif; } }`}</style>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-800 pb-4">
        <div><p className="text-xs font-semibold uppercase text-brand-400">Module 4</p><h1 className="mt-1 text-xl font-semibold text-gray-100">Stamp Paper</h1><p className="mt-1 text-sm text-gray-500">Transactions, attachments and payment history.</p></div>
        <div className="text-right text-xs text-gray-500">Operator: <span className="text-gray-300">{operator || 'Loading…'}</span></div>
      </header>

      <nav className="flex gap-1 border-b border-gray-800" aria-label="Stamp paper sections">
        {([['new', 'New Transaction'], ['history', 'History']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setActiveTab(id)} className={`border-b-2 px-4 py-2.5 text-sm ${activeTab === id ? 'border-brand-400 text-brand-300' : 'border-transparent text-gray-500 hover:text-gray-200'}`}>{label}</button>)}
      </nav>

      {error && <div role="alert" className="border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}
      {notice && <div role="status" className="border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">{notice}</div>}

      {activeTab === 'new' && <form onSubmit={(event) => void saveTransaction(event)} className="space-y-5">
        <section className={sectionClass}>
          <h2 className="mb-4 text-sm font-semibold text-gray-100">Transaction Information</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Info label="Transaction ID" value={transactionId} />
            <Info label="Invoice Number" value="Assigned when saved" />
            <Info label="Date and time" value={new Date().toLocaleString('en-PK')} />
            <label><span className={labelClass}>Status</span><select className={inputClass} value={status} onChange={(event) => setStatus(event.target.value as TransactionStatus)}><option value="PENDING">Pending</option><option value="COMPLETED">Complete</option><option value="CANCELLED">Cancel</option></select></label>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TextField label="Reference name" value={referenceName} onChange={setReferenceName} required maxLength={150} />
            <div>
              <label className="flex min-h-8 items-center gap-2 text-xs font-medium text-gray-400">
                <input
                  type="checkbox"
                  checked={hasTicketNumber}
                  onChange={(event) => setHasTicketNumber(event.target.checked)}
                  className="accent-brand-500"
                />
                Ticket number
              </label>
            </div>
            <TextField label="Customer name" value={customerName} onChange={setCustomerName} required maxLength={150} />
            <TextField label="Registration" value={registration} onChange={(value) => { setRegistration(value); setRequiredFieldErrors((current) => ({ ...current, registration: undefined })) }} required error={requiredFieldErrors.registration} maxLength={150} />
          </div>
        </section>

        <section className={sectionClass}>
          <div className="mb-4"><h2 className="text-sm font-semibold text-gray-100">Documents</h2><p className="mt-1 text-xs text-gray-500">Upload multiple JPEG, PNG, or PDF files; each file can be up to 10 MB.</p></div>
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center border border-dashed border-gray-700 bg-gray-950/50 px-4 py-5 text-center hover:border-brand-500">
            <span className="text-sm font-medium text-gray-200">Choose transaction documents</span>
            <span className="mt-1 text-xs text-gray-500">You can select multiple files</span>
            <input type="file" multiple accept="image/jpeg,image/png,application/pdf" className="sr-only" onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); event.currentTarget.value = '' }} />
          </label>
          {attachments.length > 0 && <ul className="mt-3 divide-y divide-gray-800 border border-gray-800">{attachments.map((attachment) => <li key={attachment.token} className="flex items-center gap-3 px-3 py-2">
            {attachment.mimeType.startsWith('image/') ? <img src={attachment.previewUrl} alt="" className="h-10 w-10 object-cover" /> : <span className="grid h-10 w-10 place-items-center bg-gray-800 text-[10px] text-gray-300">PDF</span>}
            <span className="min-w-0 flex-1 truncate text-xs text-gray-300">{attachment.name}<span className="ml-2 text-gray-600">{(attachment.size / 1024).toFixed(0)} KB</span></span>
            <button type="button" onClick={() => setPreview({ name: attachment.name, mimeType: attachment.mimeType, url: attachment.previewUrl })} className="text-xs text-brand-300">Preview</button>
            <button type="button" onClick={() => void removeAttachment(attachment)} className="text-xs text-red-400">Remove</button>
          </li>)}</ul>}
        </section>

        <section className={sectionClass}>
          <h2 className="mb-4 text-sm font-semibold text-gray-100">Remarks</h2>
          <label><span className={labelClass}>Remarks (optional)</span><textarea className={inputClass} value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={3} maxLength={1000} /></label>
        </section>

        <section className={sectionClass}>
          <h2 className="mb-4 text-sm font-semibold text-gray-100">Payment Information</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {amountField('Sale price', salePrice, setSalePrice)}
            {amountField('Service charges', serviceCharges, setServiceCharges)}
            {amountField('Other fees', otherFees, setOtherFees)}
            {amountField('Amount received', amountReceived, setAmountReceived)}
            <Info label="Total payable" value={formatPkr(totalPaisa)} />
            <Info label="Remaining balance" value={formatPkr(balancePaisa)} />
            <label><span className={labelClass}>Payment method</span><select className={inputClass} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}><PaymentOptions /></select></label>
            <TextField label="Payment reference (optional)" value={paymentReference} onChange={setPaymentReference} maxLength={100} />
            <label className="sm:col-span-2"><span className={labelClass}>Payment remarks (optional)</span><input className={inputClass} value={paymentRemarks} onChange={(event) => setPaymentRemarks(event.target.value)} maxLength={500} /></label>
          </div>
        </section>
        <div className="flex justify-end"><button type="submit" disabled={busy} className="bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">{busy ? 'Saving…' : 'Save Transaction'}</button></div>
      </form>}

      {activeTab === 'history' && <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
        <section className={sectionClass}>
          <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(150px,1fr)_auto_auto_auto]"><input className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void loadSales() } }} aria-label="Search stamp transactions" placeholder="Invoice, ticket, reference, customer or registration" /><input className={inputClass} type="date" aria-label="From date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /><input className={inputClass} type="date" aria-label="To date" value={toDate} onChange={(event) => setToDate(event.target.value)} /><button type="button" onClick={() => void loadSales()} className="border border-gray-700 px-4 text-sm text-gray-200 hover:bg-gray-800">Search</button></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="border-b border-gray-800 text-gray-500"><tr>{['Invoice / Date', 'Reference', 'Ticket', 'Customer', 'Registration', 'Status', 'Total', 'Received', 'Balance'].map((head) => <th key={head} className="px-2 py-3 font-medium">{head}</th>)}</tr></thead><tbody className="divide-y divide-gray-800">{sales.map((sale) => <tr key={sale.id} onClick={() => void openTransaction(sale)} className={`cursor-pointer hover:bg-gray-800/60 ${selectedSale?.id === sale.id ? 'bg-gray-800/50' : ''}`}><td className="px-2 py-3"><span className="block text-gray-200">{sale.invoice_number}</span><span className="text-gray-500">{sale.transaction_date}</span></td><td className="px-2 py-3 text-gray-300">{sale.reference_name}</td><td className="px-2 py-3 text-gray-300">{sale.ticket_number || (sale.has_ticket_number ? 'Yes' : 'No')}</td><td className="px-2 py-3 text-gray-300">{sale.customer_name}</td><td className="px-2 py-3 text-gray-400">{sale.registration || '—'}</td><td className="px-2 py-3 text-gray-300">{sale.status}</td><td className="px-2 py-3 text-gray-300">{formatPkr(sale.total_payable_paisa)}</td><td className="px-2 py-3 text-gray-300">{formatPkr(sale.amount_received_paisa)}</td><td className="px-2 py-3 text-gray-300">{formatPkr(sale.outstanding_balance_paisa)}</td></tr>)}</tbody></table>{sales.length === 0 && <p className="py-8 text-center text-sm text-gray-500">No stamp paper transactions found.</p>}</div>
        </section>

        <section className={sectionClass}>
          {!selectedSale ? <div className="py-10 text-center text-sm text-gray-500">Select a transaction to view details.</div> : <div className="space-y-4">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-gray-100">{selectedSale.invoice_number}</h2><p className="mt-1 text-xs text-gray-500">{selectedSale.transaction_id} · {selectedSale.transaction_date}</p></div><span className="text-xs text-gray-300">{selectedSale.status}</span></div>
            <div className="grid grid-cols-2 gap-3"><Info label="Reference name" value={selectedSale.reference_name} /><Info label="Ticket available" value={selectedSale.ticket_number || (selectedSale.has_ticket_number ? 'Yes' : 'No')} /><Info label="Customer name" value={selectedSale.customer_name} /><Info label="Registration" value={selectedSale.registration || '—'} /><Info label="Remarks" value={selectedSale.remarks || '—'} /></div>
            <div className="grid grid-cols-2 gap-3"><Info label="Sale price" value={formatPkr(selectedSale.sale_price_paisa)} /><Info label="Service charges" value={formatPkr(selectedSale.service_charges_paisa)} /><Info label="Other fees" value={formatPkr(selectedSale.other_fees_paisa)} /><Info label="Total payable" value={formatPkr(selectedSale.total_payable_paisa)} /><Info label="Received" value={formatPkr(selectedSale.amount_received_paisa)} /><Info label="Balance" value={formatPkr(selectedSale.outstanding_balance_paisa)} /></div>
            <div><h3 className="mb-2 text-xs font-semibold text-gray-300">Payment history</h3>{selectedSale.payments.length ? <ul className="divide-y divide-gray-800">{selectedSale.payments.map((payment) => <li key={payment.id} className="flex justify-between gap-3 py-2 text-xs"><span className="text-gray-400">{payment.receipt_number} · {payment.method} · {payment.paid_at}</span><span className="text-gray-200">{formatPkr(payment.amount_paisa)}</span></li>)}</ul> : <p className="text-xs text-gray-500">No payments recorded.</p>}</div>
            {selectedSale.status !== 'CANCELLED' && selectedSale.outstanding_balance_paisa > 0 && <form onSubmit={(event) => void recordPayment(event)} className="grid gap-2 border-t border-gray-800 pt-3 sm:grid-cols-[1fr_1fr_auto]"><label><span className={labelClass}>Receive payment (PKR)</span><input className={inputClass} inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></label><label><span className={labelClass}>Method</span><select className={inputClass} value={laterPaymentMethod} onChange={(event) => setLaterPaymentMethod(event.target.value as PaymentMethod)}><PaymentOptions /></select></label><button disabled={busy} className="self-end bg-brand-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Record payment</button></form>}
            {canManageDocuments && selectedSale.documents.length > 0 && <div><h3 className="mb-2 text-xs font-semibold text-gray-300">Attachments</h3><ul className="space-y-2">{selectedSale.documents.map((document) => <li key={document.id} className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-gray-400">{document.original_filename}</span><span className="flex shrink-0 gap-3"><button type="button" className="text-brand-300" onClick={() => void openAttachment(document as unknown as StampDocumentRow)}>Preview</button><button type="button" className="text-red-400" onClick={() => void removeSavedAttachment(document as unknown as StampDocumentRow)}>Remove</button></span></li>)}</ul></div>}
            <button type="button" onClick={() => window.print()} className="border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800">Print receipt</button>
          </div>}
        </section>
      </div>}

      {selectedSale && <Receipt sale={selectedSale} />}
      {preview && <div role="dialog" aria-modal="true" aria-label="Attachment preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPreview(null)}><div className="flex max-h-full max-w-5xl flex-col bg-gray-900 p-3" onClick={(event) => event.stopPropagation()}><div className="mb-2 flex items-center justify-between gap-3"><span className="max-w-[70vw] truncate text-sm text-gray-200">{preview.name}</span><button type="button" onClick={() => setPreview(null)} className="px-2 text-gray-300">Close</button></div>{preview.mimeType.startsWith('image/') ? <img src={preview.url} alt={preview.name} className="max-h-[80vh] max-w-full object-contain" /> : <iframe title={preview.name} src={preview.url} className="h-[80vh] w-[80vw] bg-white" />}</div></div>}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border border-gray-800 bg-gray-950/50 px-3 py-2"><p className="text-[10px] uppercase text-gray-500">{label}</p><p className="mt-1 break-words text-xs text-gray-200">{value}</p></div>
}

function TextField({ label, value, onChange, required = false, error, maxLength }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; error?: string; maxLength: number }) {
  return <label><span className={labelClass}>{label}{required ? ' *' : ''}</span><input className={`${inputClass} ${error ? 'border-red-500' : ''}`} value={value} onChange={(event) => onChange(event.target.value)} required={required} maxLength={maxLength} aria-invalid={Boolean(error)} />{error && <span className="mt-1 block text-xs text-red-400">{error}</span>}</label>
}

function PaymentOptions() {
  return <><option value="CASH">Cash</option><option value="BANK">Bank transfer</option><option value="EASYPAISA">Easypaisa</option><option value="JAZZCASH">JazzCash</option></>
}

function Receipt({ sale }: { sale: SimpleStampSaleDetail }) {
  return <article id="stamp-receipt" className="hidden"><h1>SAQIB PHOTO STATE</h1><p>Stamp Paper Receipt</p><hr /><p>Invoice: {sale.invoice_number}</p><p>Transaction: {sale.transaction_id}</p><p>Date: {sale.transaction_date}</p><p>Status: {sale.status}</p><hr /><p>Reference: {sale.reference_name}</p><p>Ticket available: {sale.ticket_number || (sale.has_ticket_number ? 'Yes' : 'No')}</p><p>Customer: {sale.customer_name}</p>{sale.registration && <p>Registration: {sale.registration}</p>}<hr /><p>Sale price: {formatPkr(sale.sale_price_paisa)}</p><p>Service charges: {formatPkr(sale.service_charges_paisa)}</p><p>Other fees: {formatPkr(sale.other_fees_paisa)}</p><p>Total: {formatPkr(sale.total_payable_paisa)}</p><p>Received: {formatPkr(sale.amount_received_paisa)}</p><p>Balance: {formatPkr(sale.outstanding_balance_paisa)}</p>{sale.remarks && <><hr /><p>Remarks: {sale.remarks}</p></>}<hr /><p>Thank you</p></article>
}
