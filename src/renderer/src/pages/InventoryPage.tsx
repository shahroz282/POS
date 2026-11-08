import { useCallback, useEffect, useState } from 'react'
import type {
  InventoryMovementRow, InventoryProductRow, InventoryPurchaseRow, InventorySummary, InventorySupplierRow
} from '@shared/schemas'

type Tab = 'products' | 'purchases' | 'movements'
type ProductForm = {
  id?: number; name: string
  purchasePrice: string; salePrice: string; lowStockLevel: string
}

const blankProduct: ProductForm = {
  name: '', purchasePrice: '0', salePrice: '0', lowStockLevel: '0'
}
const inputClass = 'w-full border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-brand-500 focus:outline-none'
const sectionClass = 'border border-gray-800 bg-gray-900/60 p-4'
const labelClass = 'mb-1 block text-xs font-medium text-gray-400'

function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function money(value: number): string {
  return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(value)
}

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>('products')
  const [summary, setSummary] = useState<InventorySummary | null>(null)
  const [products, setProducts] = useState<InventoryProductRow[]>([])
  const [inventoryOptions, setInventoryOptions] = useState<InventoryProductRow[]>([])
  const [suppliers, setSuppliers] = useState<InventorySupplierRow[]>([])
  const [purchases, setPurchases] = useState<InventoryPurchaseRow[]>([])
  const [movements, setMovements] = useState<InventoryMovementRow[]>([])
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<ProductForm>(blankProduct)
  const [showProductForm, setShowProductForm] = useState(false)
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false)
  const [supplierForm, setSupplierForm] = useState({ name: '', phone: '' })
  const [purchaseForm, setPurchaseForm] = useState({
    supplierId: '', items: [{ productId: '', quantity: '1', unitCost: '0' }], purchaseDate: today(), note: ''
  })
  const [purchaseKey, setPurchaseKey] = useState(() => crypto.randomUUID())
  const [adjustForm, setAdjustForm] = useState({
    productId: '', quantity: '', reason: '', adjustmentDate: today()
  })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [summaryResult, productResult, optionsResult, supplierResult, purchaseResult, movementResult] =
      await Promise.all([
        window.api.inventorySummary(), window.api.inventoryProducts(query, true),
        window.api.inventoryProducts('', true),
        window.api.inventorySuppliers(), window.api.inventoryPurchases(), window.api.inventoryMovements()
      ])
    const failed = [summaryResult, productResult, optionsResult, supplierResult, purchaseResult, movementResult]
      .find((result) => !result.ok)
    if (failed && !failed.ok) {
      setError(failed.error.message)
      return
    }
    if (summaryResult.ok) setSummary(summaryResult.data)
    if (productResult.ok) setProducts(productResult.data)
    if (optionsResult.ok) setInventoryOptions(optionsResult.data)
    if (supplierResult.ok) setSuppliers(supplierResult.data)
    if (purchaseResult.ok) setPurchases(purchaseResult.data)
    if (movementResult.ok) setMovements(movementResult.data)
  }, [query])

  useEffect(() => { void load() }, [load])

  const submitProduct = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true); setError(''); setNotice('')
    const input = {
      name: form.name,
      purchasePrice: Number(form.purchasePrice), salePrice: Number(form.salePrice),
      lowStockLevel: Number(form.lowStockLevel)
    }
    const result = form.id
      ? await window.api.inventoryProductUpdate({ ...input, id: form.id })
      : await window.api.inventoryProductCreate(input)
    setBusy(false)
    if (!result.ok) { setError(result.error.message); return }
    setShowProductForm(false); setForm(blankProduct); setNotice(form.id ? 'Product updated.' : 'Product added.')
    await load()
  }

  const submitSupplier = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    const result = await window.api.inventorySupplierCreate(supplierForm)
    setBusy(false)
    if (!result.ok) { setError(result.error.message); return }
    setSupplierForm({ name: '', phone: '' }); setNotice('Supplier added.'); await load()
  }

  const submitPurchase = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    const result = await window.api.inventoryPurchaseCreate({
      idempotencyKey: purchaseKey, supplierId: purchaseForm.supplierId ? Number(purchaseForm.supplierId) : null,
      purchaseDate: purchaseForm.purchaseDate, note: purchaseForm.note,
      items: purchaseForm.items.map((item) => ({
        productId: Number(item.productId), quantity: Number(item.quantity), unitCost: Number(item.unitCost)
      }))
    })
    setBusy(false)
    if (!result.ok) { setError(result.error.message); return }
    setPurchaseKey(crypto.randomUUID())
    setPurchaseForm((current) => ({
      ...current, items: [{ productId: '', quantity: '1', unitCost: '0' }], note: ''
    }))
    setNotice(`Purchase ${result.data.purchaseNo} recorded.`); await load()
  }

  const submitAdjustment = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    const result = await window.api.inventoryAdjustmentCreate({
      productId: Number(adjustForm.productId), quantity: Number(adjustForm.quantity),
      reason: adjustForm.reason, adjustmentDate: adjustForm.adjustmentDate
    })
    setBusy(false)
    if (!result.ok) { setError(result.error.message); return }
    setShowAdjustmentForm(false)
    setAdjustForm((current) => ({ ...current, quantity: '', reason: '' }))
    setNotice('Stock adjustment recorded.'); await load()
  }

  const toggleProduct = async (product: InventoryProductRow) => {
    setError(''); setNotice('')
    const result = await window.api.inventoryProductActive(product.id, product.is_active !== 1)
    if (!result.ok) { setError(result.error.message); return }
    setNotice(product.is_active ? 'Product archived.' : 'Product activated.')
    await load()
  }

  return (
    <div className="p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-bold text-gray-100">Stock &amp; Inventory</h1>
          <p className="mt-1 text-sm text-gray-500">Manage products, purchases, and traceable stock changes.</p></div>
        <button type="button" onClick={() => { setForm(blankProduct); setShowProductForm(true) }}
          className="bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500">+ Add product</button>
      </header>

      {error && <div role="alert" className="mb-4 border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}
      {notice && <div role="status" className="mb-4 border border-green-800 bg-green-950/30 px-4 py-3 text-sm text-green-300">{notice}</div>}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ['Active products', summary?.productCount ?? 0],
          ['Low-stock items', summary?.lowStockCount ?? 0],
          ['Stock purchase value', money(summary?.stockValue ?? 0)],
          ["Today's sales", money(summary?.todaySales ?? 0)],
          ["Today's purchases", money(summary?.todayPurchases ?? 0)]
        ].map(([label, value]) => <div key={label} className={sectionClass}>
          <p className="text-xs text-gray-500">{label}</p><p className="mt-2 text-lg font-semibold text-gray-100">{value}</p>
        </div>)}
      </div>

      <div className="mb-4 flex flex-wrap gap-2 border-b border-gray-800">
        {([
          ['products', 'Products'], ['purchases', 'Purchases'], ['movements', 'Stock history']
        ] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)}
          className={`border-b-2 px-4 py-2 text-sm ${tab === id ? 'border-brand-400 text-brand-300' : 'border-transparent text-gray-500 hover:text-gray-200'}`}>
          {label}
        </button>)}
      </div>

      {tab === 'products' && <div className="grid gap-4">
        <section className={sectionClass}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-100">Products</h2>
            <div className="flex flex-wrap gap-2">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product name"
                aria-label="Search products" className={`${inputClass} min-w-48 max-w-xs`} />
              <button type="button" onClick={() => setShowAdjustmentForm(true)}
                className="border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800">Adjust stock</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="border-b border-gray-800 text-gray-500"><tr>
                {['Product', 'Cost', 'Sale price', 'Stock', ''].map((head) =>
                  <th key={head} className="px-2 py-2 font-medium">{head}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-gray-800">
                {products.map((product) => <tr key={product.id}>
                  <td className="px-2 py-3"><span className="font-medium text-gray-200">{product.name}</span>
                    {!product.is_active && <span className="ml-2 text-[10px] text-gray-500">Archived</span>}</td>
                  <td className="px-2 py-3 text-gray-400">{product.purchase_price == null ? '—' : money(product.purchase_price)}</td>
                  <td className="px-2 py-3 text-gray-200">{money(product.sale_price)}</td>
                  <td className={`px-2 py-3 font-medium ${product.stock_qty <= product.low_stock_level ? 'text-orange-300' : 'text-gray-200'}`}>
                    {product.stock_qty} {product.stock_qty <= product.low_stock_level && <span className="text-[10px]">Low</span>}</td>
                  <td className="px-2 py-3 text-right">
                    <button type="button" onClick={() => {
                      setForm({ id: product.id, name: product.name, purchasePrice: String(product.purchase_price ?? 0),
                        salePrice: String(product.sale_price), lowStockLevel: String(product.low_stock_level) })
                      setShowProductForm(true)
                    }} disabled={!product.is_active} className="mr-2 text-brand-300 hover:text-brand-200 disabled:opacity-40">Edit</button>
                    <button type="button" onClick={() => void toggleProduct(product)}
                      className="text-gray-500 hover:text-red-300">{product.is_active ? 'Archive' : 'Restore'}</button>
                  </td>
                </tr>)}
                {!products.length && <tr><td colSpan={5} className="py-8 text-center text-gray-500">No products found.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

      </div>}

      {tab === 'purchases' && <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.6fr)]">
        <section className={`${sectionClass} mx-auto w-full max-w-xl`}>
            <h2 className="mb-3 text-sm font-semibold text-gray-100">Receive purchase</h2>
            <form onSubmit={(event) => void submitPurchase(event)} className="grid gap-3">
              <label><span className={labelClass}>Supplier (optional)</span><select value={purchaseForm.supplierId}
                onChange={(event) => setPurchaseForm((current) => ({ ...current, supplierId: event.target.value }))} className={inputClass}>
                <option value="">No supplier selected</option>{suppliers.map((supplier) =>
                  <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.phone ? ` · ${supplier.phone}` : ''}</option>)}</select></label>
              <div className="space-y-3">
                {purchaseForm.items.map((item, index) => <div key={index} className="grid grid-cols-2 gap-2 border border-gray-800 p-2">
                  <label className="col-span-2"><span className={labelClass}>Product</span><select required value={item.productId}
                    onChange={(event) => setPurchaseForm((current) => ({
                      ...current, items: current.items.map((line, lineIndex) =>
                        lineIndex === index ? { ...line, productId: event.target.value } : line)
                    }))} className={inputClass}>
                    <option value="">Select product</option>{inventoryOptions.filter((product) => product.is_active &&
                      !purchaseForm.items.some((line, lineIndex) => lineIndex !== index && line.productId === String(product.id)))
                      .map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
                  <label><span className={labelClass}>Quantity</span><input required type="number" min="1" step="1" value={item.quantity}
                    onChange={(event) => setPurchaseForm((current) => ({
                      ...current, items: current.items.map((line, lineIndex) =>
                        lineIndex === index ? { ...line, quantity: event.target.value } : line)
                    }))} className={inputClass} /></label>
                  <label><span className={labelClass}>Unit cost (PKR)</span><input required type="number" min="0" step="1" value={item.unitCost}
                    onChange={(event) => setPurchaseForm((current) => ({
                      ...current, items: current.items.map((line, lineIndex) =>
                        lineIndex === index ? { ...line, unitCost: event.target.value } : line)
                    }))} className={inputClass} /></label>
                  {purchaseForm.items.length > 1 && <button type="button" onClick={() => setPurchaseForm((current) => ({
                    ...current, items: current.items.filter((_, lineIndex) => lineIndex !== index)
                  }))} className="col-span-2 text-right text-xs text-red-300">Remove item</button>}
                </div>)}
                <button type="button" onClick={() => setPurchaseForm((current) => ({
                  ...current, items: [...current.items, { productId: '', quantity: '1', unitCost: '0' }]
                }))} className="text-xs text-brand-300 hover:text-brand-200">+ Add another product</button>
                <p className="text-right text-xs text-gray-400">
                  Purchase total: {money(purchaseForm.items.reduce((sum, item) =>
                    sum + (Number(item.quantity) || 0) * (Number(item.unitCost) || 0), 0))}
                </p>
              </div>
              <label><span className={labelClass}>Purchase date</span><input required type="date" value={purchaseForm.purchaseDate}
                onChange={(event) => setPurchaseForm((current) => ({ ...current, purchaseDate: event.target.value }))} className={inputClass} /></label>
              <label><span className={labelClass}>Note</span><input maxLength={500} value={purchaseForm.note}
                onChange={(event) => setPurchaseForm((current) => ({ ...current, note: event.target.value }))} className={inputClass} /></label>
              <button disabled={busy} className="bg-brand-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Save purchase &amp; update stock</button>
            </form>
        </section>
        <div className="space-y-4">
          <section className={sectionClass}>
            <h2 className="mb-3 text-sm font-semibold text-gray-100">Add supplier</h2>
            <form onSubmit={(event) => void submitSupplier(event)} className="grid gap-2">
              <input required maxLength={120} value={supplierForm.name}
                onChange={(event) => setSupplierForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Supplier name" className={inputClass} />
              <input maxLength={30} value={supplierForm.phone}
                onChange={(event) => setSupplierForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="Phone (optional)" className={inputClass} />
              <button disabled={busy} className="border border-gray-700 px-3 py-2 text-xs text-gray-200 hover:bg-gray-800">Save supplier</button>
            </form>
          </section>
        </div>
        <section className={sectionClass}>
          <h2 className="mb-3 text-sm font-semibold text-gray-100">Purchase history</h2>
          <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs">
            <thead className="border-b border-gray-800 text-gray-500"><tr>{['Purchase', 'Date', 'Supplier', 'Items', 'Total', 'Entered by'].map((head) =>
              <th key={head} className="px-2 py-2 font-medium">{head}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-800">{purchases.map((purchase) => <tr key={purchase.id}>
              <td className="px-2 py-3 text-brand-300">{purchase.purchase_no}</td><td className="px-2 py-3 text-gray-300">{purchase.purchase_date}</td>
              <td className="px-2 py-3 text-gray-400">{purchase.supplier_name || '—'}</td><td className="px-2 py-3 text-gray-300">{purchase.item_count}</td>
              <td className="px-2 py-3 text-gray-200">{money(purchase.total)}</td><td className="px-2 py-3 text-gray-500">{purchase.created_by_name}</td>
            </tr>)}{!purchases.length && <tr><td colSpan={6} className="py-8 text-center text-gray-500">No purchases recorded.</td></tr>}</tbody>
          </table></div>
        </section>
      </div>}

      {tab === 'movements' && <section className={sectionClass}>
        <h2 className="mb-3 text-sm font-semibold text-gray-100">Stock movement history</h2>
        <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs">
          <thead className="border-b border-gray-800 text-gray-500"><tr>{['Date', 'Product', 'Type', 'Quantity', 'Reference', 'Reason', 'Entered by'].map((head) =>
            <th key={head} className="px-2 py-2 font-medium">{head}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-800">{movements.map((movement) => <tr key={movement.id}>
            <td className="px-2 py-3 text-gray-400">{movement.created_at}</td><td className="px-2 py-3 text-gray-200">{movement.product_name}</td>
            <td className="px-2 py-3 text-gray-300">{movement.type}</td>
            <td className={`px-2 py-3 font-medium ${movement.quantity > 0 ? 'text-green-300' : 'text-orange-300'}`}>{movement.quantity > 0 ? '+' : ''}{movement.quantity}</td>
            <td className="px-2 py-3 text-gray-400">{movement.ref_type || '—'}{movement.ref_id ? ` #${movement.ref_id}` : ''}</td>
            <td className="px-2 py-3 text-gray-400">{movement.note || '—'}</td><td className="px-2 py-3 text-gray-500">{movement.created_by_name || '—'}</td>
          </tr>)}{!movements.length && <tr><td colSpan={7} className="py-8 text-center text-gray-500">No stock movements yet.</td></tr>}</tbody>
        </table></div>
      </section>}

      {showProductForm && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" role="presentation"
        onClick={() => setShowProductForm(false)}>
        <section role="dialog" aria-modal="true" aria-labelledby="product-form-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto border border-gray-700 bg-gray-900 p-5"
          onClick={(event) => event.stopPropagation()}>
          <div className="mb-4 flex justify-between"><h2 id="product-form-title" className="text-lg font-semibold text-gray-100">{form.id ? 'Edit product' : 'Add product'}</h2>
            <button type="button" onClick={() => setShowProductForm(false)} className="text-gray-500 hover:text-gray-200">Close</button></div>
          {error && <div role="alert" className="mb-3 border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</div>}
          <form onSubmit={(event) => void submitProduct(event)} className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className={labelClass}>Product name *</span><input required maxLength={160} value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className={inputClass} /></label>
            <label><span className={labelClass}>Purchase price</span><input required type="number" min="0" step="1" value={form.purchasePrice}
              onChange={(event) => setForm((current) => ({ ...current, purchasePrice: event.target.value }))} className={inputClass} /></label>
            <label><span className={labelClass}>Sale price</span><input required type="number" min="0" step="1" value={form.salePrice}
              onChange={(event) => setForm((current) => ({ ...current, salePrice: event.target.value }))} className={inputClass} /></label>
            <label><span className={labelClass}>Low-stock alert at</span><input required type="number" min="0" step="1" value={form.lowStockLevel}
              onChange={(event) => setForm((current) => ({ ...current, lowStockLevel: event.target.value }))} className={inputClass} /></label>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <button type="button" onClick={() => setShowProductForm(false)} className="border border-gray-700 px-4 py-2 text-sm text-gray-300">Cancel</button>
              <button disabled={busy} className="bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save product'}</button>
            </div>
          </form>
        </section>
      </div>}

      {showAdjustmentForm && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" role="presentation"
        onClick={() => setShowAdjustmentForm(false)}>
        <section role="dialog" aria-modal="true" aria-labelledby="stock-adjustment-title"
          className="w-full max-w-md border border-gray-700 bg-gray-900 p-5"
          onClick={(event) => event.stopPropagation()}>
          <div className="mb-4 flex items-center justify-between">
            <h2 id="stock-adjustment-title" className="text-lg font-semibold text-gray-100">Adjust stock</h2>
            <button type="button" onClick={() => setShowAdjustmentForm(false)} className="text-xs text-gray-400 hover:text-gray-100">Close</button>
          </div>
          {error && <div role="alert" className="mb-3 border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</div>}
          <form onSubmit={(event) => void submitAdjustment(event)} className="grid gap-3">
            <label><span className={labelClass}>Product</span><select required value={adjustForm.productId}
              onChange={(event) => setAdjustForm((current) => ({ ...current, productId: event.target.value }))} className={inputClass}>
              <option value="">Select product</option>{inventoryOptions.filter((item) => item.is_active).map((item) =>
                <option key={item.id} value={item.id}>{item.name} · stock {item.stock_qty}</option>)}</select></label>
            <label><span className={labelClass}>Quantity change (+ or -)</span><input required type="number" step="1" value={adjustForm.quantity}
              onChange={(event) => setAdjustForm((current) => ({ ...current, quantity: event.target.value }))} className={inputClass} /></label>
            <label><span className={labelClass}>Reason</span><input required minLength={2} maxLength={300} value={adjustForm.reason}
              onChange={(event) => setAdjustForm((current) => ({ ...current, reason: event.target.value }))} className={inputClass} /></label>
            <label><span className={labelClass}>Date</span><input required type="date" value={adjustForm.adjustmentDate}
              onChange={(event) => setAdjustForm((current) => ({ ...current, adjustmentDate: event.target.value }))} className={inputClass} /></label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAdjustmentForm(false)}
                className="border border-gray-700 px-4 py-2 text-sm text-gray-300">Cancel</button>
              <button disabled={busy} className="bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {busy ? 'Saving…' : 'Save adjustment'}
              </button>
            </div>
          </form>
        </section>
      </div>}
    </div>
  )
}
