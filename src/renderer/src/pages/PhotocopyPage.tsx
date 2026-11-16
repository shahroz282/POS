import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PhotocopySaleRow } from '@shared/schemas'

type PayMethod = 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH'
const inputClass = 'w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none'

function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function money(amount: number): string {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(amount)
}

export default function PhotocopyPage() {
  const [serviceType, setServiceType] = useState<'MONO' | 'COLOR'>('MONO')
  const [pageCount, setPageCount] = useState('1')
  const [copyCount, setCopyCount] = useState('1')
  const [duplex, setDuplex] = useState(false)
  const [unitPrice, setUnitPrice] = useState('5')
  const [customerName, setCustomerName] = useState('')
  const [reference, setReference] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PayMethod>('CASH')
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [rows, setRows] = useState<PhotocopySaleRow[]>([])
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [role, setRole] = useState('CASHIER')
  const [selected, setSelected] = useState<PhotocopySaleRow | null>(null)
  const [refundReason, setRefundReason] = useState('')
  const [refundMethod, setRefundMethod] = useState<PayMethod>('CASH')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const total = (Number(pageCount) || 0) * (Number(copyCount) || 0) * (Number(unitPrice) || 0)
  const load = useCallback(async () => {
    const result = await window.api.photocopyList({ fromDate, toDate })
    if (result.ok) setRows(result.data)
    else setError(result.error.message)
  }, [fromDate, toDate])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    void window.api.authGetSession().then((result) => {
      if (result.ok && result.data) setRole(result.data.role)
    })
  }, [])

  const totals = useMemo(() => rows.reduce((result, row) => ({
    jobs: result.jobs + (row.status === 'COMPLETED' ? 1 : 0),
    billed: result.billed + (row.status === 'COMPLETED' ? row.total_amount : 0),
    refunds: result.refunds + row.refund_amount
  }), { jobs: 0, billed: 0, refunds: 0 }), [rows])

  const createSale = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    const result = await window.api.photocopyCreate({
      idempotencyKey,
      serviceType,
      pageCount: Number(pageCount),
      copyCount: Number(copyCount),
      duplex,
      unitPrice: Number(unitPrice),
      customerName,
      reference,
      paymentMethod
    })
    if (!result.ok) setError(result.error.message)
    else {
      setNotice(`Photocopy job saved. Receipt ${result.data.receipt_number}.`)
      setIdempotencyKey(crypto.randomUUID())
      setCustomerName('')
      setReference('')
      await load()
    }
    setBusy(false)
  }

  const refund = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    setError('')
    const result = await window.api.photocopyRefund({
      saleId: selected.id,
      idempotencyKey: crypto.randomUUID(),
      method: refundMethod,
      reason: refundReason
    })
    if (!result.ok) setError(result.error.message)
    else {
      setSelected(result.data)
      setNotice(`Refund recorded for ${result.data.receipt_number}.`)
      await load()
    }
    setBusy(false)
  }

  const printReceipt = (sale: PhotocopySaleRow) => {
    const receipt = window.open('', '_blank', 'width=420,height=600')
    if (!receipt) {
      setError('Receipt window was blocked. Allow pop-ups to print the receipt.')
      return
    }
    const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character] ?? character)
    receipt.document.write(`<html><head><title>${escape(sale.receipt_number)}</title></head><body>
      <h2>Photocopy receipt</h2><p>Receipt: ${escape(sale.receipt_number)}</p>
      <p>Date: ${escape(sale.created_at)}</p><p>Type: ${sale.service_type}</p>
      <p>Pages/sides: ${sale.page_count} × Copies: ${sale.copy_count}${sale.duplex ? ' (duplex)' : ''}</p>
      <p>Unit price: ${money(sale.unit_price)}</p><h3>Total: ${money(sale.total_amount)}</h3>
      <p>Paid: ${money(sale.amount_received)} · ${sale.status}</p>
      <script>window.onload=()=>window.print()</script></body></html>`)
    receipt.document.close()
  }

  return <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
    <header>
      <p className="text-xs font-semibold uppercase tracking-widest text-brand-400">Service counter</p>
      <h1 className="mt-1 text-2xl font-semibold text-white">Photocopy</h1>
      <p className="mt-1 text-sm text-gray-400">Record photocopy jobs and payments without changing inventory stock.</p>
    </header>
    {error && <div role="alert" className="border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}
    {notice && <div role="status" className="border border-green-800 bg-green-950/30 p-3 text-sm text-green-300">{notice}</div>}
    <section className="border border-gray-800 bg-gray-900/60 p-4">
      <h2 className="mb-4 text-sm font-semibold text-white">New photocopy job</h2>
      <form onSubmit={(event) => void createSale(event)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-gray-400">Print type<select className={`mt-1 ${inputClass}`} value={serviceType} onChange={(event) => setServiceType(event.target.value as 'MONO' | 'COLOR')}><option value="MONO">Black and white</option><option value="COLOR">Color</option></select></label>
        <label className="text-xs text-gray-400">Pages / printed sides<input className={`mt-1 ${inputClass}`} type="number" min="1" max="100000" required value={pageCount} onChange={(event) => setPageCount(event.target.value)} /></label>
        <label className="text-xs text-gray-400">Copies<input className={`mt-1 ${inputClass}`} type="number" min="1" max="10000" required value={copyCount} onChange={(event) => setCopyCount(event.target.value)} /></label>
        <label className="text-xs text-gray-400">Price per side/copy (PKR)<input className={`mt-1 ${inputClass}`} type="number" min="0" max="10000" required value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} /></label>
        <label className="flex items-center gap-2 text-xs text-gray-300"><input type="checkbox" checked={duplex} onChange={(event) => setDuplex(event.target.checked)} /> Duplex printing</label>
        <label className="text-xs text-gray-400">Customer (optional)<input className={`mt-1 ${inputClass}`} maxLength={150} value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></label>
        <label className="text-xs text-gray-400">Reference / department (optional)<input className={`mt-1 ${inputClass}`} maxLength={150} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
        <label className="text-xs text-gray-400">Payment method<select className={`mt-1 ${inputClass}`} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PayMethod)}><option value="CASH">Cash</option><option value="BANK">Bank</option><option value="EASYPAISA">EasyPaisa</option><option value="JAZZCASH">JazzCash</option></select></label>
        <p className="self-center text-sm font-semibold text-gray-100">Total: {money(total)}</p>
        <button type="submit" disabled={busy || !Number.isSafeInteger(total) || total > 100_000_000} className="bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50">{busy ? 'Saving…' : 'Save and print later'}</button>
      </form>
      <p className="mt-3 text-xs text-gray-500">The charge is calculated as pages/sides × copies × unit price. Duplex is recorded for the job; pages/sides should reflect the billable printed sides.</p>
    </section>
    <section className="border border-gray-800 bg-gray-900/60 p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-sm font-semibold text-white">Job history</h2><p className="mt-1 text-xs text-gray-500">{totals.jobs} completed jobs · {money(totals.billed)} billed · {money(totals.refunds)} refunded</p></div>
        <div className="flex gap-2"><label className="text-xs text-gray-400">From<input className={`mt-1 block ${inputClass}`} type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label className="text-xs text-gray-400">To<input className={`mt-1 block ${inputClass}`} type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></div>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs">
        <thead className="border-b border-gray-800 text-gray-500"><tr>{['Receipt / Date','Type','Pages × Copies','Customer / Ref','Total','Paid','Status',''].map((head) => <th key={head} className="px-2 py-2">{head}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-800">{rows.map((row) => <tr key={row.id}>
          <td className="px-2 py-3"><span className="text-brand-300">{row.receipt_number}</span><span className="block text-gray-500">{row.created_at}</span></td>
          <td className="px-2 py-3 text-gray-300">{row.service_type}{row.duplex ? ' · Duplex' : ''}</td>
          <td className="px-2 py-3 text-gray-300">{row.page_count} × {row.copy_count}</td>
          <td className="px-2 py-3 text-gray-300">{row.customer_name || 'Walk-in'}{row.reference ? ` · ${row.reference}` : ''}</td>
          <td className="px-2 py-3 text-gray-200">{money(row.total_amount)}</td><td className="px-2 py-3 text-gray-300">{money(row.amount_received)}</td>
          <td className="px-2 py-3 text-gray-300">{row.status}</td><td className="px-2 py-3 text-right">
            <button type="button" onClick={() => printReceipt(row)} className="text-brand-300">Print</button>
            {role !== 'CASHIER' && row.status === 'COMPLETED' && <button type="button" onClick={() => { setSelected(row); setRefundReason(''); setError('') }} className="ml-3 text-red-300">Refund</button>}
          </td>
        </tr>)}
        {!rows.length && <tr><td colSpan={8} className="py-8 text-center text-gray-500">No photocopy jobs for this period.</td></tr>}</tbody>
      </table></div>
    </section>
    {selected && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" role="presentation" onClick={() => setSelected(null)}>
      <form role="dialog" aria-modal="true" aria-labelledby="photocopy-refund-title" className="w-full max-w-md space-y-3 border border-gray-700 bg-gray-900 p-5" onClick={(event) => event.stopPropagation()} onSubmit={(event) => void refund(event)}>
        <h2 id="photocopy-refund-title" className="text-lg font-semibold text-white">Refund {selected.receipt_number}</h2>
        <p className="text-sm text-gray-300">Full refund: {money(selected.amount_received)}</p>
        <label className="block text-xs text-gray-400">Refund method<select className={`mt-1 ${inputClass}`} value={refundMethod} onChange={(event) => setRefundMethod(event.target.value as PayMethod)}><option value="CASH">Cash</option><option value="BANK">Bank</option><option value="EASYPAISA">EasyPaisa</option><option value="JAZZCASH">JazzCash</option></select></label>
        <label className="block text-xs text-gray-400">Reason<input className={`mt-1 ${inputClass}`} required maxLength={500} value={refundReason} onChange={(event) => setRefundReason(event.target.value)} /></label>
        <div className="flex justify-end gap-2"><button type="button" onClick={() => setSelected(null)} className="border border-gray-700 px-3 py-2 text-sm text-gray-300">Cancel</button><button type="submit" disabled={busy} className="bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50">Confirm full refund</button></div>
      </form>
    </div>}
  </div>
}
