import { useEffect, useMemo, useRef, useState } from 'react'
import type { Role } from '@shared/constants'
import type {
  StampDocumentRow, StampInventoryRow, StampPartyInput, StampPartySummary,
  StampSaleDetail, StampSaleListRow
} from '@shared/schemas'

type Tab = 'sale' | 'history' | 'inventory'
type DocumentCategory = 'FIRST_PHOTO' | 'FIRST_CNIC_FRONT' | 'FIRST_CNIC_BACK' | 'SECOND_PHOTO' | 'SECOND_CNIC_FRONT' | 'SECOND_CNIC_BACK' | 'SUPPORTING'
type StagedDocument = { token: string; category: DocumentCategory; name: string; mimeType: string; size: number; previewUrl: string }
type PartyKey = 'firstParty' | 'secondParty'

const emptyParty = (): StampPartyInput => ({ fullName: '', fatherOrHusbandName: '', cnicNumber: '', mobileNumber: '', address: '', city: '', district: '' })

function parsePaisa(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null
  const [rupees, fraction = ''] = value.trim().split('.')
  return Number(rupees) * 100 + Number(fraction.padEnd(2, '0'))
}

function formatPkr(paisa: number): string {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', minimumFractionDigits: 2 }).format(paisa / 100)
}

function localDateTime(): string {
  return new Date().toLocaleString('en-PK')
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      const comma = result.indexOf(',')
      if (comma < 0) reject(new Error('Could not read the selected file'))
      else resolve(result.slice(comma + 1))
    }
    reader.onerror = () => reject(new Error('Could not read the selected file'))
    reader.readAsDataURL(file)
  })
}

const fieldClass = 'w-full min-w-0 border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-brand-500 focus:outline-none'
const labelClass = 'mb-1 block text-xs font-medium text-gray-400'
const sectionClass = 'border border-gray-800 bg-gray-900/60 p-4 sm:p-5'

export default function StampPaperPage() {
  const [tab, setTab] = useState<Tab>('sale')
  const [role, setRole] = useState<Role>('CASHIER')
  const [operator, setOperator] = useState('')
  const [inventory, setInventory] = useState<StampInventoryRow[]>([])
  const [selectedInventoryId, setSelectedInventoryId] = useState('')
  const [inventoryQuery, setInventoryQuery] = useState('')
  const [firstParty, setFirstParty] = useState<StampPartyInput>(emptyParty)
  const [secondParty, setSecondParty] = useState<StampPartyInput>(emptyParty)
  const [purpose, setPurpose] = useState('')
  const [documentReference, setDocumentReference] = useState('')
  const [serviceCharges, setServiceCharges] = useState('0.00')
  const [otherFees, setOtherFees] = useState('0.00')
  const [amountReceived, setAmountReceived] = useState('0.00')
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH'>('CASH')
  const [paymentReference, setPaymentReference] = useState('')
  const [remarks, setRemarks] = useState('')
  const [documents, setDocuments] = useState<StagedDocument[]>([])
  const [transactionId, setTransactionId] = useState(() => crypto.randomUUID())
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [sales, setSales] = useState<StampSaleListRow[]>([])
  const [salesQuery, setSalesQuery] = useState('')
  const [salesFromDate, setSalesFromDate] = useState('')
  const [salesToDate, setSalesToDate] = useState('')
  const [selectedSale, setSelectedSale] = useState<StampSaleDetail | null>(null)
  const [savedDocuments, setSavedDocuments] = useState<StampDocumentRow[]>([])
  const [documentPreview, setDocumentPreview] = useState<{ name: string; mimeType: string; url: string } | null>(null)
  const [cameraCategory, setCameraCategory] = useState<DocumentCategory | null>(null)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethodLater, setPaymentMethodLater] = useState<'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH'>('CASH')
  const [inventoryFormOpen, setInventoryFormOpen] = useState(false)
  const [newInventory, setNewInventory] = useState({ itemType: '', denomination: '', serialNumber: '', registerNumber: '', bookNumber: '', issuingSource: '', vendorEmployeeName: '', purchaseCost: '', salePrice: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const documentsRef = useRef(documents)
  const previewRef = useRef(documentPreview)
  documentsRef.current = documents
  previewRef.current = documentPreview

  const selectedInventory = inventory.find((item) => String(item.id) === selectedInventoryId)
  const denominationPaisa = selectedInventory?.sale_price_paisa ?? 0
  const chargesPaisa = parsePaisa(serviceCharges) ?? 0
  const feesPaisa = parsePaisa(otherFees) ?? 0
  const totalPaisa = denominationPaisa + chargesPaisa + feesPaisa
  const receivedPaisa = parsePaisa(amountReceived) ?? 0
  const outstandingPaisa = totalPaisa - receivedPaisa
  const canManage = role === 'ADMIN' || role === 'MANAGER'

  const filteredInventory = useMemo(() => {
    const query = inventoryQuery.toLowerCase().trim()
    return inventory.filter((item) => !query || `${item.item_type} ${item.serial_number}`.toLowerCase().includes(query))
  }, [inventory, inventoryQuery])

  const loadInventory = async (query = '') => {
    const result = await window.api.stampInventoryList(query)
    if (result.ok) setInventory(result.data)
    else setError(result.error.message)
  }

  const loadSales = async (query = salesQuery) => {
    const result = await window.api.stampSalesList(query, salesFromDate || undefined, salesToDate || undefined)
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
      await Promise.all([loadInventory(), loadSales('')])
    })()
  }, [])

  useEffect(() => () => {
    for (const document of documentsRef.current) URL.revokeObjectURL(document.previewUrl)
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url)
  }, [])

  const updateParty = (key: PartyKey, value: StampPartyInput) => {
    if (key === 'firstParty') setFirstParty(value)
    else setSecondParty(value)
  }

  const selectParty = (key: PartyKey, party: StampPartySummary) => {
    const current = key === 'firstParty' ? firstParty : secondParty
    updateParty(key, {
      partyId: party.id,
      fullName: party.full_name,
      fatherOrHusbandName: party.father_or_husband_name ?? '',
      cnicNumber: party.cnic_number?.includes('*') ? '' : party.cnic_number ?? '',
      mobileNumber: party.mobile_number ?? '',
      address: party.address ?? '',
      city: party.city ?? '',
      district: party.district ?? ''
    })
  }

  const uploadDocument = async (category: DocumentCategory, file?: File) => {
    if (!file) return
    setError('')
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
      setError('Choose a JPEG, PNG, or PDF file. The file contents will also be validated.')
      return
    }
    if (file.size < 1 || file.size > 10 * 1024 * 1024) {
      setError('Document must be smaller than 10 MB.')
      return
    }
    if (category !== 'SUPPORTING' && file.type === 'application/pdf') {
      setError('Party photographs and CNIC images must be JPEG or PNG.')
      return
    }
    setBusy(true)
    try {
      const result = await window.api.stampDocumentStage({
        category,
        originalFilename: file.name,
        mimeType: file.type,
        contentBase64: await toBase64(file)
      })
      if (!result.ok) throw new Error(result.error.message)
      const replaced = category === 'SUPPORTING' ? [] : documents.filter((item) => item.category === category)
      for (const item of replaced) {
        await window.api.stampDocumentDiscard(item.token)
        URL.revokeObjectURL(item.previewUrl)
      }
      setDocuments((current) => [
        ...current.filter((item) => category === 'SUPPORTING' || item.category !== category),
        { ...result.data, category, name: result.data.originalFilename, previewUrl: URL.createObjectURL(file) }
      ])
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Document upload failed')
    } finally {
      setBusy(false)
    }
  }

  const removeStagedDocument = async (document: StagedDocument) => {
    await window.api.stampDocumentDiscard(document.token)
    URL.revokeObjectURL(document.previewUrl)
    setDocuments((current) => current.filter((item) => item.token !== document.token))
  }

  const handleCreateSale = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setNotice('')
    if (!selectedInventory) return setError('Select an available stamp paper serial number.')
    const charges = parsePaisa(serviceCharges)
    const other = parsePaisa(otherFees)
    const received = parsePaisa(amountReceived)
    if (charges === null || other === null || received === null) return setError('Enter valid amounts with no more than two decimal places.')
    if (received > selectedInventory.sale_price_paisa + charges + other) return setError('Amount received cannot exceed total payable.')
    setBusy(true)
    try {
      const result = await window.api.stampSaleCreate({
        transactionId,
        idempotencyKey,
        inventoryId: selectedInventory.id,
        firstParty,
        secondParty,
        documentPurpose: purpose,
        documentReferenceNumber: documentReference,
        serviceChargesPaisa: charges,
        otherFeesPaisa: other,
        amountReceivedPaisa: received,
        paymentMethod,
        paymentReferenceNumber: paymentReference,
        paymentRemarks: '',
        remarks,
        stagedDocumentTokens: documents.map((document) => document.token)
      })
      if (!result.ok) throw new Error(result.error.message)
      const detail = await window.api.stampSaleDetail(result.data.id)
      if (detail.ok) setSelectedSale(detail.data)
      setDocuments((current) => {
        for (const document of current) URL.revokeObjectURL(document.previewUrl)
        return []
      })
      setNotice(`Sale saved. Invoice ${result.data.invoice_number}`)
      setTransactionId(crypto.randomUUID())
      setIdempotencyKey(crypto.randomUUID())
      setFirstParty(emptyParty())
      setSecondParty(emptyParty())
      setPurpose('')
      setDocumentReference('')
      setServiceCharges('0.00')
      setOtherFees('0.00')
      setAmountReceived('0.00')
      setPaymentReference('')
      setRemarks('')
      setSelectedInventoryId('')
      await Promise.all([loadInventory(), loadSales('')])
      setTab('history')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save stamp paper sale')
    } finally {
      setBusy(false)
    }
  }

  const openSale = async (sale: StampSaleListRow) => {
    setError('')
    setSavedDocuments([])
    const result = await window.api.stampSaleDetail(sale.id)
    if (!result.ok) return setError(result.error.message)
    setSelectedSale(result.data)
    setPaymentAmount((result.data.outstanding_balance_paisa / 100).toFixed(2))
    if (canManage) {
      const docs = await window.api.stampDocumentsList(sale.id)
      if (docs.ok) setSavedDocuments(docs.data)
    }
  }

  const receivePayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedSale) return
    const amount = parsePaisa(paymentAmount)
    if (!amount || amount <= 0) return setError('Enter a payment amount greater than zero.')
    setBusy(true)
    setError('')
    const result = await window.api.stampPaymentCreate({ saleId: selectedSale.id, amountPaisa: amount, method: paymentMethodLater })
    if (!result.ok) setError(result.error.message)
    else {
      setNotice(`Payment recorded. Receipt ${result.data.receiptNumber}`)
      await Promise.all([loadSales(), openSale({ ...selectedSale, amount_received_paisa: 0 } as StampSaleListRow)])
    }
    setBusy(false)
  }

  const addInventory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const denomination = parsePaisa(newInventory.denomination)
    const purchaseCost = parsePaisa(newInventory.purchaseCost)
    const salePrice = parsePaisa(newInventory.salePrice)
    if (denomination === null || purchaseCost === null || salePrice === null) return setError('Enter valid inventory amounts.')
    setBusy(true)
    setError('')
    const result = await window.api.stampInventoryAdd({
      itemType: newInventory.itemType,
      denominationPaisa: denomination,
      serialNumber: newInventory.serialNumber,
      registerNumber: newInventory.registerNumber,
      bookNumber: newInventory.bookNumber,
      issuingSource: newInventory.issuingSource,
      vendorEmployeeName: newInventory.vendorEmployeeName,
      purchaseCostPaisa: purchaseCost,
      salePricePaisa: salePrice
    })
    setBusy(false)
    if (!result.ok) setError(result.error.message)
    else {
      setNotice('Stamp paper serial added to available inventory.')
      setNewInventory({ itemType: '', denomination: '', serialNumber: '', registerNumber: '', bookNumber: '', issuingSource: '', vendorEmployeeName: '', purchaseCost: '', salePrice: '' })
      setInventoryFormOpen(false)
      await loadInventory()
    }
  }

  const handleCancel = async () => {
    if (!selectedSale || !window.confirm('Cancel this sale? Any amount already received must be refunded in full, and the stamp serial will be returned to available inventory.')) return
    const reason = window.prompt('Enter the cancellation reason:')
    if (!reason?.trim()) return
    let refundMethod: 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH' | undefined
    if (selectedSale.amount_received_paisa > 0) {
      const selectedMethod = window.prompt('Refund method: CASH, BANK, EASYPAISA, or JAZZCASH')?.trim().toUpperCase()
      if (!selectedMethod || !['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH'].includes(selectedMethod)) {
        setError('Enter a valid refund method to cancel this paid sale.')
        return
      }
      refundMethod = selectedMethod as typeof refundMethod
    }
    setBusy(true)
    const result = await window.api.stampSaleCancel(selectedSale.id, reason.trim(), refundMethod)
    setBusy(false)
    if (!result.ok) setError(result.error.message)
    else {
      setNotice('Sale cancelled and inventory reversal recorded.')
      setSelectedSale(null)
      await Promise.all([loadSales(), loadInventory()])
    }
  }

  const showSavedDocument = async (document: StampDocumentRow) => {
    if (!selectedSale) return
    const result = await window.api.stampDocumentRead(selectedSale.id, document.id)
    if (!result.ok) return setError(result.error.message)
    const url = `data:${result.data.mimeType};base64,${result.data.contentBase64}`
    setDocumentPreview({ name: result.data.originalFilename, mimeType: result.data.mimeType, url })
  }

  const removeSavedDocument = async (document: StampDocumentRow) => {
    if (!selectedSale || !window.confirm(`Remove ${document.original_filename}?`)) return
    const result = await window.api.stampDocumentRemove(selectedSale.id, document.id)
    if (!result.ok) setError(result.error.message)
    else setSavedDocuments((current) => current.filter((item) => item.id !== document.id))
  }

  const printReceipt = () => window.print()

  const amountInput = (label: string, value: string, onChange: (value: string) => void, required = false) => (
    <label className="block">
      <span className={labelClass}>{label} (PKR)</span>
      <input className={fieldClass} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} required={required} placeholder="0.00" />
    </label>
  )

  const documentInput = (category: DocumentCategory, label: string, accept: string) => {
    const current = documents.filter((document) => document.category === category)
    const multiple = category === 'SUPPORTING'
    return (
      <div className="border border-gray-800 bg-gray-950/60 p-3">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="truncate text-xs text-gray-300">{label}</span>
          <label className="shrink-0 cursor-pointer text-xs font-medium text-brand-300 hover:text-brand-200">
            {multiple || current.length === 0 ? 'Upload' : 'Replace'}
            <input type="file" accept={accept} multiple={multiple} capture={category.includes('PHOTO') ? 'user' : undefined} className="sr-only" onChange={(event) => { for (const file of Array.from(event.target.files ?? [])) void uploadDocument(category, file); event.currentTarget.value = '' }} />
          </label>
        </div>
        {current.map((document) => <div key={document.token} className="mt-2 flex items-center gap-2">
          {document.mimeType.startsWith('image/') ? <img src={document.previewUrl} alt={label} className="h-12 w-12 object-cover" /> : <span className="grid h-12 w-12 place-items-center bg-gray-800 text-xs text-gray-300">PDF</span>}
          <span className="min-w-0 flex-1 truncate text-xs text-gray-500">{document.name}</span>
          {document.mimeType.startsWith('image/') && <button type="button" className="text-xs text-brand-300" onClick={() => setDocumentPreview({ name: document.name, mimeType: document.mimeType, url: document.previewUrl })}>Preview</button>}
          <button type="button" className="text-xs text-red-400" onClick={() => void removeStagedDocument(document)}>Remove</button>
        </div>)}
      </div>
    )
  }

  const partyFields = (title: string, key: PartyKey, party: StampPartyInput) => (
    <PartyForm
      title={title}
      party={party}
      onChange={(value) => updateParty(key, value)}
      onSelect={(value) => selectParty(key, value)}
      onCapturePhoto={() => setCameraCategory(key === 'firstParty' ? 'FIRST_PHOTO' : 'SECOND_PHOTO')}
      canManage={canManage}
      fieldClass={fieldClass}
      labelClass={labelClass}
    />
  )

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <style>{`@media print { body * { visibility: hidden !important; } #stamp-receipt, #stamp-receipt * { visibility: visible !important; } #stamp-receipt { display: block !important; position: absolute; inset: 0; width: 80mm; padding: 6mm; color: #000; background: #fff; font: 12px Arial, sans-serif; } }`}</style>
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-800 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase text-brand-400">Module 4</p>
          <h1 className="mt-1 text-xl font-semibold text-gray-100">Stamp Paper</h1>
          <p className="mt-1 text-sm text-gray-500">Serial-controlled sales, party records and collections.</p>
        </div>
        <div className="text-right text-xs text-gray-500">Operator: <span className="text-gray-300">{operator || 'Loading…'}</span></div>
      </header>

      <nav className="flex gap-1 border-b border-gray-800" aria-label="Stamp paper sections">
        {([['sale', 'New Sale'], ['history', 'Sales History'], ['inventory', 'Inventory']] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`border-b-2 px-4 py-2.5 text-sm ${tab === id ? 'border-brand-400 text-brand-300' : 'border-transparent text-gray-500 hover:text-gray-200'}`}>{label}</button>
        ))}
      </nav>

      {error && <div role="alert" className="border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}
      {notice && <div role="status" className="border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300">{notice}</div>}

      {tab === 'sale' && (
        <form onSubmit={handleCreateSale} className="space-y-5">
          <section className={sectionClass}>
            <h2 className="mb-4 text-sm font-semibold text-gray-100">Transaction Information</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Info label="Transaction ID" value={transactionId} />
              <Info label="Invoice Number" value="Assigned when saved" />
              <Info label="Date and time" value={localDateTime()} />
              <Info label="Status" value="Draft" />
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            {partyFields('First Party Information', 'firstParty', firstParty)}
            {partyFields('Second Party Information', 'secondParty', secondParty)}
          </div>

          <section className={sectionClass}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-sm font-semibold text-gray-100">Supporting Documents</h2><p className="mt-1 text-xs text-gray-500">JPEG, PNG, or PDF up to 10 MB. Files are stored under app data.</p></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {documentInput('FIRST_PHOTO', 'First party photograph', 'image/jpeg,image/png')}
              {documentInput('FIRST_CNIC_FRONT', 'First party CNIC front', 'image/jpeg,image/png')}
              {documentInput('FIRST_CNIC_BACK', 'First party CNIC back', 'image/jpeg,image/png')}
              {documentInput('SECOND_PHOTO', 'Second party photograph', 'image/jpeg,image/png')}
              {documentInput('SECOND_CNIC_FRONT', 'Second party CNIC front', 'image/jpeg,image/png')}
              {documentInput('SECOND_CNIC_BACK', 'Second party CNIC back', 'image/jpeg,image/png')}
              {documentInput('SUPPORTING', 'Supporting document', 'image/jpeg,image/png,application/pdf')}
            </div>
          </section>

          <section className={sectionClass}>
            <h2 className="mb-4 text-sm font-semibold text-gray-100">Stamp Paper Details</h2>
            <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
              <label><span className={labelClass}>Search available inventory</span><input className={fieldClass} value={inventoryQuery} onChange={(event) => setInventoryQuery(event.target.value)} placeholder="Type, denomination, or serial number" /></label>
              <label><span className={labelClass}>Available serial</span><select className={fieldClass} value={selectedInventoryId} onChange={(event) => setSelectedInventoryId(event.target.value)} required><option value="">Select serial</option>{filteredInventory.map((item) => <option key={item.id} value={item.id}>{item.item_type} · {formatPkr(item.denomination_paisa)} · {item.serial_number}</option>)}</select></label>
            </div>
            {selectedInventory && <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><Info label="Face value" value={formatPkr(selectedInventory.denomination_paisa)} /><Info label="Sale price" value={formatPkr(selectedInventory.sale_price_paisa)} /><Info label="Register / book" value={[selectedInventory.register_number, selectedInventory.book_number].filter(Boolean).join(' / ') || 'Not recorded'} /><Info label="Issuing source" value={selectedInventory.issuing_source || 'Not recorded'} /></div>}
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><label><span className={labelClass}>Document purpose</span><input className={fieldClass} value={purpose} onChange={(event) => setPurpose(event.target.value)} required maxLength={500} /></label><label><span className={labelClass}>Document reference number (optional)</span><input className={fieldClass} value={documentReference} onChange={(event) => setDocumentReference(event.target.value)} maxLength={100} /></label><label className="sm:col-span-2"><span className={labelClass}>Remarks (optional)</span><textarea className={fieldClass} value={remarks} onChange={(event) => setRemarks(event.target.value)} rows={2} maxLength={1000} /></label></div>
          </section>

          <section className={sectionClass}>
            <h2 className="mb-4 text-sm font-semibold text-gray-100">Payment Information</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Info label="Stamp paper sale price" value={formatPkr(denominationPaisa)} />
              {amountInput('Service charges', serviceCharges, setServiceCharges, true)}
              {amountInput('Other authorized fees', otherFees, setOtherFees, true)}
              {amountInput('Amount received', amountReceived, setAmountReceived, true)}
              <Info label="Total payable" value={formatPkr(totalPaisa)} />
              <Info label="Remaining balance" value={formatPkr(outstandingPaisa)} />
              <label><span className={labelClass}>Payment method</span><select className={fieldClass} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}><PaymentOptions /></select></label>
              <label><span className={labelClass}>Payment reference (optional)</span><input className={fieldClass} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} maxLength={100} /></label>
            </div>
          </section>

          <div className="flex flex-wrap justify-end gap-3">
            <button type="submit" disabled={busy} className="bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">{busy ? 'Saving…' : 'Save Sale'}</button>
            <button type="button" disabled={!selectedSale} onClick={printReceipt} className="border border-gray-700 px-5 py-2.5 text-sm font-medium text-gray-200 hover:bg-gray-800 disabled:opacity-50">Print Receipt</button>
          </div>
        </form>
      )}

      {tab === 'history' && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
          <section className={sectionClass}>
            <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(160px,1fr)_auto_auto_auto]"><input className={fieldClass} aria-label="Search stamp sales" value={salesQuery} onChange={(event) => setSalesQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void loadSales() } }} placeholder="Invoice, transaction, party, or serial" /><input className={fieldClass} aria-label="From date" type="date" value={salesFromDate} onChange={(event) => setSalesFromDate(event.target.value)} /><input className={fieldClass} aria-label="To date" type="date" value={salesToDate} onChange={(event) => setSalesToDate(event.target.value)} /><button type="button" onClick={() => void loadSales()} className="border border-gray-700 px-4 text-sm text-gray-200 hover:bg-gray-800">Search</button></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[690px] text-left text-xs"><thead className="border-b border-gray-800 text-gray-500"><tr>{['Invoice / Date', 'Parties', 'Serial / Value', 'Payable', 'Received', 'Balance'].map((head) => <th key={head} className="px-2 py-3 font-medium">{head}</th>)}</tr></thead><tbody className="divide-y divide-gray-800">{sales.map((sale) => <tr key={sale.id} onClick={() => void openSale(sale)} className={`cursor-pointer hover:bg-gray-800/60 ${selectedSale?.id === sale.id ? 'bg-gray-800/50' : ''}`}><td className="px-2 py-3"><span className="block text-gray-200">{sale.invoice_number}</span><span className="text-gray-500">{sale.transaction_date}</span></td><td className="px-2 py-3 text-gray-300">{sale.first_party_name}<br />{sale.second_party_name}</td><td className="px-2 py-3 text-gray-300">{sale.serial_number}<br />{formatPkr(sale.denomination_paisa)}</td><td className="px-2 py-3 text-gray-300">{formatPkr(sale.total_payable_paisa)}</td><td className="px-2 py-3 text-gray-300">{formatPkr(sale.amount_received_paisa)}</td><td className="px-2 py-3 text-gray-300">{formatPkr(sale.outstanding_balance_paisa)}</td></tr>)}</tbody></table>{sales.length === 0 && <p className="py-8 text-center text-sm text-gray-500">No stamp paper sales found.</p>}</div>
          </section>

          <section className={sectionClass}>
            {!selectedSale ? <div className="py-10 text-center text-sm text-gray-500">Select a transaction to view details.</div> : <div className="space-y-4">
              <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-gray-100">{selectedSale.invoice_number}</h2><p className="mt-1 text-xs text-gray-500">{selectedSale.transaction_id} · {selectedSale.transaction_date}</p></div><span className={`text-xs ${selectedSale.status === 'COMPLETED' ? 'text-emerald-400' : 'text-red-400'}`}>{selectedSale.status}</span></div>
              <div className="grid grid-cols-2 gap-3"><PartySummary title="First party" party={selectedSale.first_party} /><PartySummary title="Second party" party={selectedSale.second_party} /></div>
              <div className="grid grid-cols-2 gap-3 text-xs"><Info label="Purpose" value={selectedSale.document_purpose} /><Info label="Stamp serial" value={selectedSale.serial_number} /><Info label="Face value" value={formatPkr(selectedSale.denomination_paisa)} />{canManage && selectedSale.purchase_cost_paisa !== null && <Info label="Purchase cost" value={formatPkr(selectedSale.purchase_cost_paisa)} />}<Info label="Service charges" value={formatPkr(selectedSale.service_charges_paisa)} /><Info label="Other fees" value={formatPkr(selectedSale.other_fees_paisa)} /><Info label="Total payable" value={formatPkr(selectedSale.total_payable_paisa)} /><Info label="Received" value={formatPkr(selectedSale.amount_received_paisa)} /><Info label="Balance" value={formatPkr(selectedSale.outstanding_balance_paisa)} /></div>
              <div><h3 className="mb-2 text-xs font-semibold text-gray-300">Payment history</h3>{selectedSale.payments.length ? <ul className="divide-y divide-gray-800">{selectedSale.payments.map((payment) => <li key={payment.id} className="flex justify-between gap-3 py-2 text-xs"><span className="text-gray-400">{payment.receipt_number} · {payment.method} · {payment.paid_at}</span><span className="text-gray-200">{formatPkr(payment.amount_paisa)}</span></li>)}</ul> : <p className="text-xs text-gray-500">No payments recorded.</p>}</div>
              {selectedSale.refunds.length > 0 && <div><h3 className="mb-2 text-xs font-semibold text-gray-300">Refund history</h3><ul className="divide-y divide-gray-800">{selectedSale.refunds.map((refund) => <li key={refund.id} className="flex justify-between gap-3 py-2 text-xs"><span className="text-gray-400">{refund.method} · {refund.created_at} · {refund.remarks}</span><span className="text-red-300">-{formatPkr(refund.amount_paisa)}</span></li>)}</ul></div>}
              {selectedSale.outstanding_balance_paisa > 0 && selectedSale.status === 'COMPLETED' && <form onSubmit={(event) => void receivePayment(event)} className="grid gap-2 border-t border-gray-800 pt-3 sm:grid-cols-[1fr_1fr_auto]"><label><span className={labelClass}>Receive payment (PKR)</span><input className={fieldClass} inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></label><label><span className={labelClass}>Method</span><select className={fieldClass} value={paymentMethodLater} onChange={(event) => setPaymentMethodLater(event.target.value as typeof paymentMethodLater)}><PaymentOptions /></select></label><button disabled={busy} className="self-end bg-brand-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Record payment</button></form>}
              {canManage && savedDocuments.length > 0 && <div><h3 className="mb-2 text-xs font-semibold text-gray-300">Restricted documents</h3><ul className="space-y-2">{savedDocuments.map((document) => <li key={document.id} className="flex items-center justify-between gap-2 text-xs"><span className="truncate text-gray-400">{document.category} · {document.original_filename}</span><span className="flex shrink-0 gap-3"><button type="button" className="text-brand-300" onClick={() => void showSavedDocument(document)}>Preview</button><button type="button" className="text-red-400" onClick={() => void removeSavedDocument(document)}>Remove</button></span></li>)}</ul></div>}
              <div className="flex flex-wrap gap-2 border-t border-gray-800 pt-3"><button type="button" onClick={printReceipt} className="border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800">Print receipt</button>{canManage && selectedSale.status === 'COMPLETED' && selectedSale.amount_received_paisa === 0 && <button type="button" onClick={() => void handleCancel()} className="border border-red-900 px-3 py-2 text-xs text-red-300 hover:bg-red-950/40">Cancel sale</button>}</div>
            </div>}
          </section>
        </div>
      )}

      {tab === 'inventory' && (
        <section className={sectionClass}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-gray-100">Available stamp paper</h2><p className="mt-1 text-xs text-gray-500">Serial numbers can only be sold once.</p></div>{canManage && <button type="button" onClick={() => setInventoryFormOpen((open) => !open)} className="bg-brand-600 px-4 py-2 text-xs font-medium text-white hover:bg-brand-500">{inventoryFormOpen ? 'Close form' : 'Add serial'}</button>}</div>
          {inventoryFormOpen && canManage && <form onSubmit={(event) => void addInventory(event)} className="mb-5 grid gap-3 border border-gray-800 bg-gray-950/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <InputField label="Stamp paper type" value={newInventory.itemType} onChange={(itemType) => setNewInventory({ ...newInventory, itemType })} required />
            <InputField label="Face value (PKR)" value={newInventory.denomination} onChange={(denomination) => setNewInventory({ ...newInventory, denomination })} required />
            <InputField label="Serial number" value={newInventory.serialNumber} onChange={(serialNumber) => setNewInventory({ ...newInventory, serialNumber })} required />
            <InputField label="Sale price (PKR)" value={newInventory.salePrice} onChange={(salePrice) => setNewInventory({ ...newInventory, salePrice })} required />
            <InputField label="Purchase cost (PKR)" value={newInventory.purchaseCost} onChange={(purchaseCost) => setNewInventory({ ...newInventory, purchaseCost })} required />
            <InputField label="Register number" value={newInventory.registerNumber} onChange={(registerNumber) => setNewInventory({ ...newInventory, registerNumber })} />
            <InputField label="Book number" value={newInventory.bookNumber} onChange={(bookNumber) => setNewInventory({ ...newInventory, bookNumber })} />
            <InputField label="Issuing bank / vendor" value={newInventory.issuingSource} onChange={(issuingSource) => setNewInventory({ ...newInventory, issuingSource })} />
            <InputField label="Employee / vendor name" value={newInventory.vendorEmployeeName} onChange={(vendorEmployeeName) => setNewInventory({ ...newInventory, vendorEmployeeName })} />
            <div className="flex items-end"><button disabled={busy} className="w-full bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Adding…' : 'Add to inventory'}</button></div>
          </form>}
          <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-b border-gray-800 text-xs text-gray-500"><tr>{['Type', 'Face value', 'Sale price', ...(canManage ? ['Purchase cost'] : []), 'Serial', 'Register / book', 'Source'].map((head) => <th key={head} className="px-3 py-3 font-medium">{head}</th>)}</tr></thead><tbody className="divide-y divide-gray-800">{inventory.map((item) => <tr key={item.id}><td className="px-3 py-3 text-gray-200">{item.item_type}</td><td className="px-3 py-3 text-gray-300">{formatPkr(item.denomination_paisa)}</td><td className="px-3 py-3 text-gray-300">{formatPkr(item.sale_price_paisa)}</td>{canManage && <td className="px-3 py-3 text-gray-300">{item.purchase_cost_paisa === null ? '—' : formatPkr(item.purchase_cost_paisa)}</td>}<td className="px-3 py-3 font-mono text-gray-300">{item.serial_number}</td><td className="px-3 py-3 text-gray-400">{[item.register_number, item.book_number].filter(Boolean).join(' / ') || '—'}</td><td className="px-3 py-3 text-gray-400">{item.issuing_source || '—'}</td></tr>)}</tbody></table>{inventory.length === 0 && <p className="py-8 text-center text-sm text-gray-500">No available inventory. Add serials to make a sale.</p>}</div>
        </section>
      )}

      {selectedSale && <Receipt sale={selectedSale} />}
      {documentPreview && <div role="dialog" aria-modal="true" aria-label="Document preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setDocumentPreview(null)}><div className="flex max-h-full max-w-5xl flex-col bg-gray-900 p-3" onClick={(event) => event.stopPropagation()}><div className="mb-2 flex items-center justify-between gap-3"><span className="max-w-[70vw] truncate text-sm text-gray-200">{documentPreview.name}</span><button type="button" onClick={() => setDocumentPreview(null)} className="px-2 text-gray-300" aria-label="Close preview">Close</button></div>{documentPreview.mimeType.startsWith('image/') ? <img src={documentPreview.url} alt={documentPreview.name} className="max-h-[80vh] max-w-full object-contain" /> : <iframe title={documentPreview.name} src={documentPreview.url} className="h-[80vh] w-[80vw] bg-white" />}</div></div>}
      {cameraCategory && <CameraCapture onCapture={(file) => { void uploadDocument(cameraCategory, file); setCameraCategory(null) }} onClose={() => setCameraCategory(null)} />}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border border-gray-800 bg-gray-950/50 px-3 py-2"><p className="text-[10px] uppercase text-gray-500">{label}</p><p className="mt-1 break-words text-xs text-gray-200">{value}</p></div>
}

function InputField({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label><span className={labelClass}>{label}</span><input className={fieldClass} value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label>
}

function PaymentOptions() {
  return <><option value="CASH">Cash</option><option value="BANK">Bank transfer</option><option value="EASYPAISA">Easypaisa</option><option value="JAZZCASH">JazzCash</option></>
}

function PartyForm({ title, party, onChange, onSelect, onCapturePhoto, canManage, fieldClass: inputClass, labelClass: label }: {
  title: string; party: StampPartyInput; onChange: (party: StampPartyInput) => void; onSelect: (party: StampPartySummary) => void; onCapturePhoto: () => void; canManage: boolean; fieldClass: string; labelClass: string
}) {
  const [searchText, setSearchText] = useState('')
  const [matches, setMatches] = useState<StampPartySummary[]>([])
  const [searchError, setSearchError] = useState('')
  const search = async () => {
    if (!searchText.trim()) return
    const result = await window.api.stampPartySearch(searchText.trim())
    if (result.ok) {
      setMatches(result.data)
      setSearchError('')
    } else setSearchError(result.error.message)
  }
  const set = (key: keyof StampPartyInput, value: string) => onChange({ ...party, [key]: value })
  return (
    <section className={sectionClass}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-gray-100">{title}</h2><div className="flex items-center gap-3"><button type="button" onClick={onCapturePhoto} className="text-xs text-brand-300 hover:text-brand-200">Capture photo</button><span className="text-[10px] text-gray-500">Name required; other identity/contact fields optional</span></div></div>
      <div className="mb-4 flex gap-2"><input className={inputClass} aria-label={`${title} customer search`} value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Find saved party by name, phone or CNIC" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void search() } }} /><button type="button" onClick={() => void search()} className="border border-gray-700 px-3 text-xs text-gray-200 hover:bg-gray-800">Search</button></div>
      {searchError && <p role="alert" className="mb-2 text-xs text-red-400">{searchError}</p>}
      {matches.length > 0 && <div className="mb-3 max-h-32 overflow-y-auto border border-gray-800">{matches.map((match) => <button key={match.id} type="button" onClick={() => { onSelect(match); setMatches([]); setSearchText(match.full_name) }} className="flex w-full justify-between gap-3 border-b border-gray-800 px-3 py-2 text-left text-xs hover:bg-gray-800"><span className="text-gray-200">{match.full_name}</span><span className="text-gray-500">{match.mobile_number || match.cnic_number || ''}</span></button>)}</div>}
      {canManage && party.partyId && <label className="mb-3 flex items-center gap-2 text-xs text-gray-400"><input type="checkbox" checked={Boolean(party.updateExisting)} onChange={(event) => onChange({ ...party, updateExisting: event.target.checked })} />Update saved party details as well as this transaction</label>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className={label}>Full name *</span><input className={inputClass} value={party.fullName} onChange={(event) => set('fullName', event.target.value)} required maxLength={100} /></label>
        <label><span className={label}>Father / husband name</span><input className={inputClass} value={party.fatherOrHusbandName || ''} onChange={(event) => set('fatherOrHusbandName', event.target.value)} maxLength={100} /></label>
        <label><span className={label}>CNIC (XXXXX-XXXXXXX-X)</span><input className={inputClass} value={party.cnicNumber || ''} onChange={(event) => set('cnicNumber', event.target.value)} placeholder="12345-1234567-1" maxLength={30} pattern="[0-9\s-]+" /></label>
        <label><span className={label}>Mobile number</span><input className={inputClass} value={party.mobileNumber || ''} onChange={(event) => set('mobileNumber', event.target.value)} maxLength={30} /></label>
        <label className="sm:col-span-2"><span className={label}>Full address</span><input className={inputClass} value={party.address || ''} onChange={(event) => set('address', event.target.value)} maxLength={300} /></label>
        <label><span className={label}>City</span><input className={inputClass} value={party.city || ''} onChange={(event) => set('city', event.target.value)} maxLength={100} /></label>
        <label><span className={label}>District</span><input className={inputClass} value={party.district || ''} onChange={(event) => set('district', event.target.value)} maxLength={100} /></label>
      </div>
    </section>
  )
}

function CameraCapture({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [cameraError, setCameraError] = useState('')
  useEffect(() => {
    let stream: MediaStream | null = null
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((cameraStream) => {
        stream = cameraStream
        if (videoRef.current) videoRef.current.srcObject = cameraStream
      })
      .catch(() => setCameraError('Camera access is unavailable or permission was denied.'))
    return () => stream?.getTracks().forEach((track) => track.stop())
  }, [])

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return setCameraError('Camera is not ready yet.')
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) return setCameraError('Could not capture from camera.')
    context.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return setCameraError('Could not create the photo image.')
      onCapture(new File([blob], `party-photo-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.9)
  }

  return <div role="dialog" aria-modal="true" aria-label="Capture party photograph" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"><div className="w-full max-w-xl border border-gray-700 bg-gray-900 p-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-gray-100">Capture photograph</h2><button type="button" onClick={onClose} className="text-sm text-gray-400">Close</button></div><video ref={videoRef} autoPlay playsInline className="max-h-[65vh] w-full bg-black object-contain" />{cameraError && <p role="alert" className="mt-3 text-sm text-red-400">{cameraError}</p>}<div className="mt-3 flex justify-end"><button type="button" onClick={capture} disabled={Boolean(cameraError)} className="bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50">Capture</button></div></div></div>
}

function PartySummary({ title, party }: { title: string; party: StampSaleDetail['first_party'] }) {
  return <div className="border border-gray-800 bg-gray-950/50 p-3"><h3 className="mb-2 text-[10px] uppercase text-gray-500">{title}</h3><p className="text-sm text-gray-200">{party.full_name}</p>{party.father_or_husband_name && <p className="mt-1 text-xs text-gray-400">{party.father_or_husband_name}</p>}{party.cnic_number && <p className="mt-1 text-xs text-gray-400">CNIC: {party.cnic_number}</p>}{party.mobile_number && <p className="mt-1 text-xs text-gray-400">{party.mobile_number}</p>}</div>
}

function Receipt({ sale }: { sale: StampSaleDetail }) {
  return <article id="stamp-receipt" className="hidden">
    <h1>SAQIB PHOTO STATE</h1><p>Stamp Paper Receipt</p><hr />
    <p>Invoice: {sale.invoice_number}</p><p>Transaction: {sale.transaction_id}</p><p>Date: {sale.transaction_date}</p>
    <hr /><p>First party: {sale.first_party.full_name}</p><p>Second party: {sale.second_party.full_name}</p>
    <p>Type: {sale.item_type}</p><p>Face value: {formatPkr(sale.denomination_paisa)}</p><p>Serial: {sale.serial_number}</p>
    {sale.register_number && <p>Register: {sale.register_number}</p>}{sale.book_number && <p>Book: {sale.book_number}</p>}
    <p>Purpose: {sale.document_purpose}</p><hr /><p>Service charges: {formatPkr(sale.service_charges_paisa)}</p><p>Other fees: {formatPkr(sale.other_fees_paisa)}</p>
    <p>Total: {formatPkr(sale.total_payable_paisa)}</p><p>Received: {formatPkr(sale.amount_received_paisa)}</p><p>Balance: {formatPkr(sale.outstanding_balance_paisa)}</p>
    {sale.remarks && <><hr /><p>Remarks: {sale.remarks}</p></>}<hr /><p>Thank you</p>
  </article>
}
