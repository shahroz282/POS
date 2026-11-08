import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  InventoryProductRow, SaleDetail, SaleRow, SettingsRow, UdhaarCustomerRow
} from '@shared/schemas'
import { getReceiptSettings, receiptWidthMm } from '../utils/receipt-settings'

type CartLine = { productId: number; quantity: number }
type SalesTab = 'new-sale' | 'history'
const inputClass = 'w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-brand-500 focus:outline-none'
const sectionClass = 'border border-gray-800 bg-gray-900/60 p-4'
const labelClass = 'mb-1 block text-xs font-medium text-gray-400'
const methods = ['CASH', 'BANK', 'EASYPAISA', 'JAZZCASH'] as const

function money(value: number): string {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(value)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character] ?? character)
}

async function printSale(sale: SaleDetail, onError: (message: string) => void): Promise<void> {
  let settings: SettingsRow
  try {
    settings = await getReceiptSettings()
  } catch (reason) {
    onError(reason instanceof Error ? reason.message : 'Receipt settings could not be loaded.')
    return
  }
  const printWindow = window.open('', '_blank', 'width=420,height=700')
  if (!printWindow) return
  const lines = sale.items.map((item) => `<tr><td>${escapeHtml(item.product_name)} × ${item.quantity}</td><td>${escapeHtml(money(item.line_total))}</td></tr>`).join('')
  printWindow.document.write(`<!doctype html><html><head><title>Sale ${escapeHtml(sale.invoice_no)}</title><style>
    @page{size:${receiptWidthMm(settings)}mm auto;margin:0}
    body{font:13px Arial,sans-serif;color:#111;padding:6mm;width:${receiptWidthMm(settings)}mm;box-sizing:border-box}h1{text-align:center;font-size:19px}
    hr{border:0;border-top:1px solid #aaa;margin:14px 0}table{width:100%;border-collapse:collapse}
    td{padding:7px 0;border-bottom:1px dotted #bbb}.right{text-align:right}.row{display:flex;justify-content:space-between;margin:8px 0}
    .total{font-size:17px;font-weight:bold}.foot{text-align:center;margin-top:24px;font-size:12px}
  </style></head><body><h1>${escapeHtml(settings.shop_name)}</h1><div class="row"><span>Sale Receipt</span><strong>${escapeHtml(sale.invoice_no)}</strong></div>
    <div class="row"><span>Date</span><strong>${escapeHtml(sale.created_at)}</strong></div>
    <div class="row"><span>Customer</span><strong>${escapeHtml(sale.customer_name || 'Walk-in')}</strong></div><hr>
    <table>${lines}</table><hr><div class="row"><span>Subtotal</span><strong>${escapeHtml(money(sale.subtotal))}</strong></div>
    <div class="row"><span>Discount</span><strong>${escapeHtml(money(sale.discount))}</strong></div>
    <div class="row total"><span>Total</span><strong>${escapeHtml(money(sale.total))}</strong></div>
    <div class="row"><span>Received</span><strong>${escapeHtml(money(sale.received_amount))}</strong></div>
    <div class="row"><span>Balance</span><strong>${escapeHtml(money(sale.balance))}</strong></div>
    <div class="foot">Thank you for your purchase</div><script>window.onload=()=>window.print()</script></body></html>`)
  printWindow.document.close()
}

export default function SalesPage() {
  const [activeTab, setActiveTab] = useState<SalesTab>('new-sale')
  const [products, setProducts] = useState<InventoryProductRow[]>([])
  const [customers, setCustomers] = useState<UdhaarCustomerRow[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [productQuery, setProductQuery] = useState('')
  const [productPickerOpen, setProductPickerOpen] = useState(false)
  const [customerQuery, setCustomerQuery] = useState('')
  const [sales, setSales] = useState<SaleRow[]>([])
  const [salesQuery, setSalesQuery] = useState('')
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [discount, setDiscount] = useState('0')
  const [receivedAmount, setReceivedAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<typeof methods[number]>('CASH')
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null)
  const [role, setRole] = useState('CASHIER')
  const [returnQuantities, setReturnQuantities] = useState<Record<number, string>>({})
  const [refundMethod, setRefundMethod] = useState<'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH' | 'UDHAAR_ADJUST'>('CASH')
  const [returnReason, setReturnReason] = useState('')
  const [returnKey, setReturnKey] = useState(() => crypto.randomUUID())
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const loadSales = useCallback(async () => {
    const result = await window.api.salesList(salesQuery)
    if (result.ok) setSales(result.data)
    else setError(result.error.message)
  }, [salesQuery])

  useEffect(() => {
    let active = true
    void window.api.inventoryProducts('', false).then((result) => {
      if (!active) return
      if (result.ok) setProducts(result.data)
      else setError(result.error.message)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    void window.api.udhaarCustomers(customerQuery).then((result) => {
      if (!active) return
      if (result.ok) setCustomers(result.data)
      else setError(result.error.message)
    })
    return () => { active = false }
  }, [customerQuery])

  useEffect(() => { void loadSales() }, [loadSales])

  useEffect(() => {
    void window.api.authGetSession().then((result) => {
      if (result.ok && result.data) setRole(result.data.role)
    })
  }, [])

  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products])
  const filteredProducts = useMemo(() => {
    const search = productQuery.trim().toLocaleLowerCase()
    return products.filter((product) => product.name.toLocaleLowerCase().includes(search))
  }, [products, productQuery])
  const subtotal = cart.reduce((sum, line) => sum + (productMap.get(line.productId)?.sale_price ?? 0) * line.quantity, 0)
  const discountValue = Number(discount) || 0
  const total = Math.max(0, subtotal - discountValue)
  const received = receivedAmount === '' ? total : Number(receivedAmount)
  const balance = total - received

  const addProduct = (product: InventoryProductRow) => {
    setProductPickerOpen(false)
    setProductQuery('')
    setError(''); setNotice('')
    if (product.stock_qty < 1) { setError(`${product.name} is out of stock.`); return }
    const line = cart.find((item) => item.productId === product.id)
    if (line && line.quantity >= product.stock_qty) { setError(`Only ${product.stock_qty} ${product.name} in stock.`); return }
    if (line) setCart((current) => current.map((item) =>
      item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item))
    else setCart((current) => [...current, { productId: product.id, quantity: 1 }])
  }

  const updateQuantity = (productId: number, quantity: number) => {
    const product = productMap.get(productId)
    if (quantity < 1) { setCart((current) => current.filter((line) => line.productId !== productId)); return }
    if (product && quantity > product.stock_qty) { setError(`Only ${product.stock_qty} ${product.name} in stock.`); return }
    setCart((current) => current.map((line) => line.productId === productId ? { ...line, quantity } : line))
  }

  const submitSale = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    const result = await window.api.salesCreate({
      idempotencyKey, customerId: selectedCustomerId ? Number(selectedCustomerId) : null,
      discount: discountValue, receivedAmount: received, paymentMethod,
      items: cart.map((line) => ({ productId: line.productId, quantity: line.quantity }))
    })
    setBusy(false)
    if (!result.ok) { setError(result.error.message); return }
    void printSale(result.data, setError)
    setNotice(`Sale ${result.data.invoice_no} saved.`)
    setCart([]); setSelectedCustomerId(''); setDiscount('0'); setReceivedAmount('')
    setIdempotencyKey(crypto.randomUUID())
    await Promise.all([loadSales(), window.api.inventoryProducts('', false).then((response) => {
      if (response.ok) setProducts(response.data)
    })])
  }

  const openSale = async (saleId: number) => {
    setError('')
    const result = await window.api.salesDetail(saleId)
    if (!result.ok) { setError(result.error.message); return }
    setSelectedSale(result.data)
    setReturnQuantities({})
    setReturnReason('')
    setRefundMethod('CASH')
    setReturnKey(crypto.randomUUID())
  }

  const submitReturn = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedSale) return
    const items = Object.entries(returnQuantities)
      .filter(([, quantity]) => Number(quantity) > 0)
      .map(([saleItemId, quantity]) => ({ saleItemId: Number(saleItemId), quantity: Number(quantity) }))
    if (!items.length) { setError('Enter a return quantity for at least one item.'); return }
    setBusy(true); setError(''); setNotice('')
    const result = await window.api.salesReturn({
      saleId: selectedSale.id, idempotencyKey: returnKey, refundMethod, reason: returnReason, items
    })
    setBusy(false)
    if (!result.ok) { setError(result.error.message); return }
    setNotice(`Return recorded for ${money(result.data.returnAmount)}. ${result.data.creditAdjusted > 0
      ? `${money(result.data.creditAdjusted)} customer credit adjusted.` : ''}`)
    setReturnQuantities({}); setReturnReason(''); setReturnKey(crypto.randomUUID())
    await Promise.all([loadSales(), openSale(selectedSale.id)])
  }

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-gray-100">Normal Sales</h1>
        <p className="mt-1 text-sm text-gray-500">Build a cart, collect payment, and save inventory and customer credit together.</p>
      </header>
      {error && <div role="alert" className="mb-4 border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}
      {notice && <div role="status" className="mb-4 border border-green-800 bg-green-950/30 px-4 py-3 text-sm text-green-300">{notice}</div>}

      <div className="mb-4 flex gap-2 border-b border-gray-800" role="tablist" aria-label="Sales sections">
        <button type="button" role="tab" aria-selected={activeTab === 'new-sale'} onClick={() => setActiveTab('new-sale')}
          className={`border-b-2 px-4 py-2 text-sm ${activeTab === 'new-sale' ? 'border-brand-400 text-brand-300' : 'border-transparent text-gray-500 hover:text-gray-200'}`}>
          New sale
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'history'} onClick={() => setActiveTab('history')}
          className={`border-b-2 px-4 py-2 text-sm ${activeTab === 'history' ? 'border-brand-400 text-brand-300' : 'border-transparent text-gray-500 hover:text-gray-200'}`}>
          Sales History
        </button>
      </div>

      {activeTab === 'new-sale' && <div className="mx-auto w-full max-w-4xl space-y-4">
        <section className={sectionClass}>
          <div className="relative">
            <span className="mb-1 block text-xs font-medium text-gray-400">Add product</span>
            <input value={productQuery} onFocus={() => setProductPickerOpen(true)}
              onChange={(event) => { setProductQuery(event.target.value); setProductPickerOpen(true) }}
              onKeyDown={(event) => { if (event.key === 'Escape') setProductPickerOpen(false) }}
              placeholder="Search product name…" aria-label="Search sale products"
              aria-expanded={productPickerOpen} aria-controls="sale-product-options" role="combobox"
              aria-autocomplete="list" className={inputClass} />
            {productPickerOpen && <div id="sale-product-options" role="listbox"
              className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto border border-gray-700 bg-gray-900 shadow-xl">
              {filteredProducts.map((product) => <button key={product.id} type="button" role="option"
                onMouseDown={(event) => event.preventDefault()}
                aria-selected={false} disabled={product.stock_qty <= 0} onClick={() => addProduct(product)}
                className="flex w-full items-center justify-between gap-3 border-b border-gray-800 px-3 py-3 text-left last:border-0 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40">
                <span className="min-w-0"><span className="block truncate text-sm font-medium text-gray-200">{product.name}</span>
                  <span className="mt-1 block text-xs text-gray-500">{product.stock_qty > 0 ? `Stock ${product.stock_qty}` : 'Out of stock'}</span></span>
                <span className="shrink-0 text-sm font-semibold text-brand-300">{money(product.sale_price)}</span>
              </button>)}
              {!filteredProducts.length && <p className="px-3 py-5 text-center text-xs text-gray-500">
                {productQuery ? 'No matching products found.' : 'No active products. Add products in Inventory first.'}
              </p>}
            </div>}
          </div>
        </section>

        <form onSubmit={(event) => void submitSale(event)} className={sectionClass}>
          <h2 className="mb-3 text-sm font-semibold text-gray-100">Current sale</h2>
          <div className="mb-3 max-h-56 overflow-y-auto divide-y divide-gray-800">
            {cart.map((line) => {
              const product = productMap.get(line.productId)
              if (!product) return null
              return <div key={line.productId} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0"><p className="truncate text-sm text-gray-200">{product.name}</p>
                  <p className="mt-1 text-xs text-gray-500">{money(product.sale_price)} each</p></div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => updateQuantity(product.id, line.quantity - 1)} className="h-7 w-7 border border-gray-700 text-gray-300">−</button>
                  <input aria-label={`Quantity ${product.name}`} type="number" min="1" max={product.stock_qty} value={line.quantity}
                    onChange={(event) => updateQuantity(product.id, Number(event.target.value))}
                    className="w-14 border border-gray-700 bg-gray-950 px-1 py-1 text-center text-xs text-gray-100" />
                  <button type="button" disabled={line.quantity >= product.stock_qty} onClick={() => updateQuantity(product.id, line.quantity + 1)}
                    className="h-7 w-7 border border-gray-700 text-gray-300 disabled:opacity-40">+</button>
                  <span className="w-20 text-right text-xs text-gray-300">{money(product.sale_price * line.quantity)}</span>
                </div>
              </div>
            })}
            {!cart.length && <p className="py-8 text-center text-xs text-gray-500">Select products to add them to the cart.</p>}
          </div>
          <div className="grid gap-3 border-t border-gray-800 pt-3 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className={labelClass}>Customer (required for credit)</span>
              <input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Search customers"
                aria-label="Search customers for sale" className={inputClass} />
              <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}
                className={`${inputClass} mt-2`}>
                <option value="">Walk-in / no customer</option>{customers.map((customer) =>
                  <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ''}</option>)}
              </select>
            </label>
            <label><span className={labelClass}>Discount (PKR)</span><input type="number" min="0" max={subtotal} step="1" value={discount}
              onChange={(event) => setDiscount(event.target.value)} className={inputClass} /></label>
            <label><span className={labelClass}>Amount received</span><input type="number" min="0" max={total} step="1"
              value={receivedAmount === '' ? total : receivedAmount} onChange={(event) => setReceivedAmount(event.target.value)}
              className={inputClass} /></label>
            <label className="sm:col-span-2"><span className={labelClass}>Payment method</span><select value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)} className={inputClass}>
              {methods.map((method) => <option key={method} value={method}>{method}</option>)}</select></label>
          </div>
          <div className="mt-4 space-y-2 border-t border-gray-800 pt-3 text-sm">
            <div className="flex justify-between text-gray-400"><span>Subtotal</span><span>{money(subtotal)}</span></div>
            <div className="flex justify-between text-gray-400"><span>Discount</span><span>− {money(discountValue)}</span></div>
            <div className="flex justify-between text-base font-semibold text-gray-100"><span>Total</span><span>{money(total)}</span></div>
            <div className="flex justify-between text-gray-400"><span>Remaining balance</span><span className={balance > 0 ? 'text-orange-300' : ''}>{money(balance)}</span></div>
          </div>
          <button type="submit" disabled={busy || !cart.length || discountValue > subtotal || received < 0 || received > total}
            className="mt-4 w-full bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? 'Saving…' : 'Complete sale & print receipt'}
          </button>
        </form>
      </div>}

      {activeTab === 'history' && <section className={sectionClass}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-100">Sales History</h2>
          <input value={salesQuery} onChange={(event) => setSalesQuery(event.target.value)} placeholder="Search invoice or customer"
            aria-label="Search sales history" className={`${inputClass} max-w-xs`} />
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs">
          <thead className="border-b border-gray-800 text-gray-500"><tr>{['Invoice', 'Date', 'Customer', 'Total', 'Received', 'Balance', 'Status', ''].map((head) =>
            <th key={head} className="px-2 py-2 font-medium">{head}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-800">{sales.map((sale) => <tr key={sale.id}>
            <td className="px-2 py-3 text-brand-300">{sale.invoice_no}</td><td className="px-2 py-3 text-gray-400">{sale.created_at}</td>
            <td className="px-2 py-3 text-gray-300">{sale.customer_name || 'Walk-in'}</td><td className="px-2 py-3 text-gray-200">{money(sale.total)}</td>
            <td className="px-2 py-3 text-gray-300">{money(sale.received_amount)}</td><td className="px-2 py-3 text-orange-300">{money(sale.balance)}</td>
            <td className="px-2 py-3 text-gray-400">{sale.status}</td><td className="px-2 py-3 text-right">
              <button type="button" onClick={() => void openSale(sale.id)} className="text-brand-300 hover:text-brand-200">View / print</button>
            </td></tr>)}
            {!sales.length && <tr><td colSpan={8} className="py-8 text-center text-gray-500">No sales recorded.</td></tr>}</tbody>
        </table></div>
      </section>}

      {selectedSale && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" role="presentation"
        onClick={() => setSelectedSale(null)}>
        <section role="dialog" aria-modal="true" aria-labelledby="sale-detail-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-gray-700 bg-gray-900 p-5"
          onClick={(event) => event.stopPropagation()}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div><h2 id="sale-detail-title" className="text-lg font-semibold text-gray-100">{selectedSale.invoice_no}</h2>
              <p className="mt-1 text-xs text-gray-500">{selectedSale.customer_name || 'Walk-in'} · {selectedSale.created_at}</p></div>
            <button type="button" onClick={() => setSelectedSale(null)} className="text-xs text-gray-400 hover:text-gray-100">Close</button>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-left text-xs">
            <thead className="border-b border-gray-800 text-gray-500"><tr>{['Product', 'Qty', 'Unit price', 'Total'].map((head) =>
              <th key={head} className="px-2 py-2">{head}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-800">{selectedSale.items.map((item) => <tr key={item.id}>
              <td className="px-2 py-2 text-gray-200">{item.product_name}</td><td className="px-2 py-2 text-gray-300">
                {item.quantity}{item.returned_quantity ? <span className="ml-1 text-orange-300">({item.returned_quantity} returned)</span> : null}
              </td>
              <td className="px-2 py-2 text-gray-300">{money(item.unit_price)}</td><td className="px-2 py-2 text-gray-200">{money(item.line_total)}</td>
            </tr>)}</tbody>
          </table></div>
          {!!selectedSale.returns.length && <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold text-gray-100">Return history</h3>
            <div className="overflow-x-auto"><table className="w-full text-left text-xs">
              <thead className="border-b border-gray-800 text-gray-500"><tr>{['Date', 'Returned', 'Refund', 'Method', 'Reason', 'Entered by'].map((head) =>
                <th key={head} className="px-2 py-2">{head}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-800">{selectedSale.returns.map((item) => <tr key={item.id}>
                <td className="px-2 py-2 text-gray-400">{item.created_at}</td>
                <td className="px-2 py-2 text-gray-200">{money(item.return_amount)}</td>
                <td className="px-2 py-2 text-gray-300">{money(item.refund_amount)}</td>
                <td className="px-2 py-2 text-gray-400">{item.refund_method || '—'}</td>
                <td className="px-2 py-2 text-gray-400">{item.reason || '—'}</td>
                <td className="px-2 py-2 text-gray-500">{item.created_by_name}</td>
              </tr>)}</tbody>
            </table></div>
          </div>}
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <p className="text-gray-500">Subtotal <strong className="float-right text-gray-200">{money(selectedSale.subtotal)}</strong></p>
            <p className="text-gray-500">Discount <strong className="float-right text-gray-200">{money(selectedSale.discount)}</strong></p>
            <p className="text-gray-500">Total <strong className="float-right text-gray-100">{money(selectedSale.total)}</strong></p>
            <p className="text-gray-500">Balance <strong className="float-right text-orange-300">{money(selectedSale.balance)}</strong></p>
          </div>
          <button type="button" onClick={() => void printSale(selectedSale, setError)}
            className="mt-5 bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-500">Print receipt</button>
          {role !== 'CASHIER' && selectedSale.status !== 'RETURNED' && <form onSubmit={(event) => void submitReturn(event)}
            className="mt-5 border-t border-gray-800 pt-4">
            <h3 className="mb-1 text-sm font-semibold text-gray-100">Process return</h3>
            <p className="mb-3 text-xs text-gray-500">Returned items go back into stock; any sale credit is adjusted before a refund.</p>
            <div className="mb-3 grid gap-2">
              {selectedSale.items.filter((item) => item.quantity > item.returned_quantity).map((item) => {
                const remaining = item.quantity - item.returned_quantity
                return <label key={item.id} className="flex items-center justify-between gap-3 border border-gray-800 p-2">
                  <span className="text-xs text-gray-300">{item.product_name} · {remaining} remaining to return</span>
                  <input aria-label={`Return quantity ${item.product_name}`} type="number" min="0" max={remaining} step="1"
                    value={returnQuantities[item.id] ?? '0'}
                    onChange={(event) => setReturnQuantities((current) => ({ ...current, [item.id]: event.target.value }))}
                    className="w-20 border border-gray-700 bg-gray-950 px-2 py-1 text-right text-xs text-gray-100" />
                </label>
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className={labelClass}>Refund method</span><select value={refundMethod}
                onChange={(event) => setRefundMethod(event.target.value as typeof refundMethod)} className={inputClass}>
                <option value="CASH">Cash</option><option value="BANK">Bank</option>
                <option value="EASYPAISA">Easypaisa</option><option value="JAZZCASH">JazzCash</option>
                <option value="UDHAAR_ADJUST">Udhaar adjustment only</option>
              </select></label>
              <label><span className={labelClass}>Reason *</span><input required minLength={2} maxLength={300} value={returnReason}
                onChange={(event) => setReturnReason(event.target.value)} className={inputClass} /></label>
            </div>
            <button type="submit" disabled={busy} className="mt-3 border border-orange-800 px-4 py-2 text-xs text-orange-200 hover:bg-orange-950/40 disabled:opacity-50">
              {busy ? 'Recording…' : 'Record return & restore stock'}
            </button>
          </form>}
        </section>
      </div>}
    </div>
  )
}
