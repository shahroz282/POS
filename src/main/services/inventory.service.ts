import type {
  InventoryAdjustmentCreate, InventoryProductCreate,
  InventoryProductUpdate, InventoryPurchaseCreate, InventorySupplierCreate, SaleCreate,
  SaleReturnCreate, SaleReturnResult, SaleSearchSchema
} from '@shared/schemas'
import type { z } from 'zod'
import type { DB } from '../db/db'
import { AuditLogRepository } from '../repositories/audit-log.repository'
import { InventoryRepository } from '../repositories/inventory.repository'

type SaleSearch = z.infer<typeof SaleSearchSchema>

function localDate(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export class InventoryService {
  private readonly repository: InventoryRepository
  private readonly audit: AuditLogRepository

  constructor(private readonly db: DB) {
    this.repository = new InventoryRepository(db)
    this.audit = new AuditLogRepository(db)
  }

  summary(revealCosts = true) {
    const summary = this.repository.summary()
    return revealCosts ? summary : { ...summary, stockValue: null, todayPurchases: null }
  }
  products(query: string, activeOnly: boolean, revealCosts: boolean) {
    return this.repository.products(query, activeOnly, revealCosts)
  }
  suppliers() { return this.repository.suppliers() }
  purchases() { return this.repository.listPurchases() }
  movements() { return this.repository.movements() }
  sales(search: SaleSearch) { return this.repository.listSales(search.query, search.fromDate, search.toDate) }
  saleDetail(saleId: number) {
    const sale = this.repository.saleDetail(saleId)
    if (!sale) throw new Error('Sale not found')
    return sale
  }

  createSaleReturn(input: SaleReturnCreate, userId: number, role: string): SaleReturnResult {
    if (role === 'CASHIER') throw new Error('Only Admin or Manager can process sale returns')
    return this.db.transaction(() => {
      const existing = this.repository.returnByKey(input.idempotencyKey)
      if (existing) {
        const savedItems = this.repository.returnItems(existing.id)
        const sameItems = savedItems.length === input.items.length && input.items.every((item) =>
          savedItems.some((saved) => saved.sale_item_id === item.saleItemId && saved.quantity === item.quantity))
        if (existing.sale_id !== input.saleId || existing.refund_method !== input.refundMethod ||
          existing.reason !== input.reason || !sameItems) {
          throw new Error('This request key was already used for a different return')
        }
        const sale = this.repository.saleForReturn(input.saleId)
        return {
          id: existing.id, saleId: existing.sale_id, returnAmount: existing.return_amount,
          creditAdjusted: existing.return_amount - existing.refund_amount,
          refundAmount: existing.refund_amount, refundMethod: existing.refund_method ?? input.refundMethod,
          fullyReturned: sale?.status === 'RETURNED'
        }
      }

      const sale = this.repository.saleForReturn(input.saleId)
      if (!sale || sale.status === 'RETURNED') throw new Error('Active sale not found')
      this.ensureDayOpen(localDate())
      const availableItems = this.repository.saleReturnableItems(input.saleId)
      const requestedIds = input.items.map((item) => item.saleItemId)
      if (new Set(requestedIds).size !== requestedIds.length) throw new Error('Each sale item can only appear once per return')
      const returnedItems = input.items.map((item) => {
        const saved = availableItems.find((row) => row.id === item.saleItemId)
        if (!saved) throw new Error('One or more selected items do not belong to this sale')
        if (item.quantity > saved.quantity - saved.returned_quantity) {
          throw new Error(`Return quantity exceeds the unreturned quantity for sale item ${saved.id}`)
        }
        return { input: item, saved }
      })

      const previous = this.repository.saleReturnTotals(input.saleId)
      const returnedGross = returnedItems.reduce((sum, item) => sum + item.saved.unit_price * item.input.quantity, 0)
      const fullyReturned = availableItems.every((item) =>
        item.returned_quantity + (returnedItems.find((requested) => requested.saved.id === item.id)?.input.quantity ?? 0)
          === item.quantity)
      const returnAmount = sale.subtotal === 0 ? 0 : fullyReturned
        ? sale.total - previous.returnAmount
        : Math.min(sale.total - previous.returnAmount, Math.round(returnedGross * sale.total / sale.subtotal))
      const currentCustomerBalance = sale.customer_id == null ? 0 : this.repository.customerBalance(sale.customer_id)
      const saleDue = Math.min(currentCustomerBalance, this.repository.saleBalance(input.saleId))
      const creditAdjusted = Math.min(returnAmount, saleDue)
      const refundAmount = returnAmount - creditAdjusted
      const availablePaid = Math.max(0, this.repository.saleCollectedAmount(input.saleId) - previous.refundAmount)
      if (refundAmount > availablePaid) throw new Error('Return exceeds the amount paid against this sale')
      if (refundAmount > 0 && input.refundMethod === 'UDHAAR_ADJUST') {
        throw new Error('Select a refund method for the amount already paid')
      }
      if (creditAdjusted > 0 && sale.customer_id == null) {
        throw new Error('This sale has no customer account to adjust its credit')
      }

      const returnId = this.repository.insertSaleReturn({
        saleId: input.saleId, idempotencyKey: input.idempotencyKey, returnAmount, refundAmount,
        refundMethod: input.refundMethod, reason: input.reason, createdBy: userId
      })
      for (const item of returnedItems) {
        this.repository.insertSaleReturnItem(returnId, item.saved.id, item.input.quantity)
        this.repository.changeStock(item.saved.product_id, item.input.quantity, true)
        this.repository.insertMovement(item.saved.product_id, 'RETURN', item.input.quantity,
          'SALE_RETURN', returnId, input.reason, userId)
      }
      if (creditAdjusted > 0) {
        this.repository.insertSaleCreditAdjustment(sale.customer_id!, input.saleId, creditAdjusted,
          `${input.idempotencyKey}:credit`, userId)
      }
      if (fullyReturned) this.repository.markSaleReturned(input.saleId)
      this.audit.insert(userId, 'SALE_RETURN_CREATED', 'sale_returns', returnId,
        `Sale ${input.saleId}; return ${returnAmount}; refund ${refundAmount}; credit ${creditAdjusted}`)
      return {
        id: returnId, saleId: input.saleId, returnAmount, creditAdjusted, refundAmount,
        refundMethod: input.refundMethod, fullyReturned
      }
    })()
  }

  createProduct(input: InventoryProductCreate, userId: number): number {
    return this.db.transaction(() => {
      this.repository.ensureUniqueProductName(input.name)
      const id = this.repository.createProduct(input)
      this.audit.insert(userId, 'INVENTORY_PRODUCT_CREATED', 'products', id, input.name)
      return id
    })()
  }

  updateProduct(input: InventoryProductUpdate, userId: number): void {
    this.db.transaction(() => {
      this.repository.ensureUniqueProductName(input.name, input.id)
      this.repository.updateProduct(input)
      this.audit.insert(userId, 'INVENTORY_PRODUCT_UPDATED', 'products', input.id, input.name)
    })()
  }

  setProductActive(productId: number, active: boolean, userId: number): void {
    this.db.transaction(() => {
      this.repository.setProductActive(productId, active)
      this.audit.insert(userId, active ? 'INVENTORY_PRODUCT_ACTIVATED' : 'INVENTORY_PRODUCT_ARCHIVED',
        'products', productId, null)
    })()
  }

  createSupplier(input: InventorySupplierCreate, userId: number): number {
    return this.db.transaction(() => {
      const id = this.repository.createSupplier(input.name, input.phone)
      this.audit.insert(userId, 'INVENTORY_SUPPLIER_CREATED', 'suppliers', id, input.name)
      return id
    })()
  }

  createPurchase(input: InventoryPurchaseCreate, userId: number) {
    return this.db.transaction(() => {
      const existing = this.repository.purchaseByKey(input.idempotencyKey)
      if (existing) {
        const total = input.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0)
        const savedItems = this.repository.purchaseItems(existing.id)
        const sameItems = savedItems.length === input.items.length && input.items.every((item) =>
          savedItems.some((saved) => saved.product_id === item.productId &&
            saved.quantity === item.quantity && saved.unit_cost === item.unitCost))
        if (existing.purchase_date !== input.purchaseDate || existing.supplier_id !== (input.supplierId ?? null) ||
          existing.total !== total || existing.note !== (input.note || null) || !sameItems) {
          throw new Error('This request key was already used for a different purchase')
        }
        return { id: existing.id, purchaseNo: existing.purchase_no }
      }
      this.ensureDayOpen(input.purchaseDate)
      if (input.supplierId != null && !this.repository.suppliers().some((supplier) => supplier.id === input.supplierId)) {
        throw new Error('Supplier not found')
      }
      const productIds = input.items.map((item) => item.productId)
      if (new Set(productIds).size !== productIds.length) throw new Error('Each product can only appear once per purchase')
      const products = this.repository.productPriceRows(productIds)
      if (products.length !== input.items.length || products.some((product) => product.is_active !== 1)) {
        throw new Error('One or more selected products are unavailable')
      }
      const total = input.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0)
      if (!Number.isSafeInteger(total) || total > 100_000_000) throw new Error('Purchase total is above the allowed limit')
      const day = input.purchaseDate.replaceAll('-', '')
      const purchaseNo = `PUR-${day}-${String(this.repository.nextNumber('PUR', day)).padStart(4, '0')}`
      const purchaseId = this.repository.insertPurchase({
        purchaseNo, idempotencyKey: input.idempotencyKey, supplierId: input.supplierId,
        purchaseDate: input.purchaseDate, total, note: input.note, createdBy: userId
      })
      for (const item of input.items) {
        this.repository.insertPurchaseItem(purchaseId, item.productId, item.quantity, item.unitCost)
        this.repository.changeStock(item.productId, item.quantity)
        this.db.prepare('UPDATE products SET purchase_price = ? WHERE id = ?')
          .run(item.unitCost, item.productId)
        this.repository.insertMovement(item.productId, 'PURCHASE', item.quantity, 'PURCHASE', purchaseId,
          `Purchase ${purchaseNo}`, userId)
      }
      this.audit.insert(userId, 'INVENTORY_PURCHASE_CREATED', 'purchases', purchaseId,
        `${purchaseNo}; total ${total}`)
      return { id: purchaseId, purchaseNo }
    })()
  }

  adjustStock(input: InventoryAdjustmentCreate, userId: number): void {
    this.db.transaction(() => {
      this.ensureDayOpen(input.adjustmentDate)
      const product = this.repository.product(input.productId)
      if (!product || product.is_active !== 1) throw new Error('Active product not found')
      this.repository.changeStock(input.productId, input.quantity)
      this.repository.insertMovement(input.productId, 'ADJUSTMENT',
        input.quantity, 'ADJUSTMENT', null, input.reason, userId)
      this.audit.insert(userId, 'INVENTORY_STOCK_ADJUSTED', 'products', input.productId,
        `${input.quantity > 0 ? '+' : ''}${input.quantity}; ${input.reason}`)
    })()
  }

  createSale(input: SaleCreate, userId: number, role: string) {
    return this.db.transaction(() => {
      const existing = this.repository.saleByKey(input.idempotencyKey)
      if (existing) {
        const sameItems = existing.items.length === input.items.length && input.items.every((item) =>
          existing.items.some((saved) => saved.product_id === item.productId && saved.quantity === item.quantity))
        if (!sameItems || existing.discount !== input.discount || existing.received_amount !== input.receivedAmount ||
          existing.customer_id !== (input.customerId ?? null) || existing.payment_method !==
          (input.receivedAmount > 0 ? input.paymentMethod : null)) {
          throw new Error('This request key was already used for a different sale')
        }
        return existing
      }
      const saleDate = localDate()
      this.ensureDayOpen(saleDate)
      const uniqueIds = input.items.map((item) => item.productId)
      if (new Set(uniqueIds).size !== uniqueIds.length) throw new Error('Each product can only appear once in the cart')
      const products = this.repository.productPriceRows(uniqueIds)
      if (products.length !== input.items.length || products.some((product) => product.is_active !== 1)) {
        throw new Error('One or more selected products are unavailable')
      }
      for (const item of input.items) {
        const product = products.find((row) => row.id === item.productId)!
        if (product.stock_qty < item.quantity) throw new Error(`Insufficient stock for ${product.name}`)
      }
      const subtotal = input.items.reduce((sum, item) => {
        const product = products.find((row) => row.id === item.productId)!
        return sum + product.sale_price * item.quantity
      }, 0)
      if (!Number.isSafeInteger(subtotal) || subtotal > 100_000_000) throw new Error('Sale subtotal is above the allowed limit')
      if (input.discount > subtotal) throw new Error('Discount cannot exceed the subtotal')
      if (role === 'CASHIER') {
        const limit = Number(this.db.prepare("SELECT value FROM settings WHERE key = 'max_cashier_discount_percent'")
          .get()?.value ?? 5)
        if (input.discount * 100 > subtotal * limit) throw new Error(`Cashier discount cannot exceed ${limit}%`)
      }
      const total = subtotal - input.discount
      if (input.receivedAmount > total) throw new Error('Amount received cannot exceed the sale total')
      const credit = total - input.receivedAmount
      if (credit > 0 && input.customerId == null) throw new Error('Select a customer to record the unpaid balance')
      if (input.customerId != null && !this.db.prepare('SELECT id FROM customers WHERE id = ?').get(input.customerId)) {
        throw new Error('Customer not found')
      }
      const day = saleDate.replaceAll('-', '')
      const invoiceNo = `INV-${day}-${String(this.repository.nextNumber('INV', day)).padStart(4, '0')}`
      const saleId = this.repository.insertSale({
        invoiceNo, idempotencyKey: input.idempotencyKey, customerId: input.customerId,
        subtotal, discount: input.discount, total, receivedAmount: input.receivedAmount,
        status: credit > 0 ? 'PARTIAL' : 'COMPLETED', createdBy: userId
      })
      for (const item of input.items) {
        const product = products.find((row) => row.id === item.productId)!
        const lineTotal = product.sale_price * item.quantity
        this.repository.insertSaleItem(saleId, item.productId, item.quantity, product.sale_price,
          product.purchase_price, lineTotal)
        this.repository.changeStock(item.productId, -item.quantity)
        this.repository.insertMovement(item.productId, 'SALE', -item.quantity, 'SALE', saleId, invoiceNo, userId)
      }
      if (input.receivedAmount > 0) {
        const receiptNo = `PAY-${day}-${String(this.repository.nextNumber('PAY', day)).padStart(4, '0')}`
        this.repository.insertPayment({
          saleId, receiptNo, amount: input.receivedAmount, method: input.paymentMethod,
          idempotencyKey: `${input.idempotencyKey}:payment`, balanceAfter: credit, createdBy: userId
        })
      }
      if (credit > 0) {
        this.repository.insertUdhaar(input.customerId!, saleId, credit,
          `${input.idempotencyKey}:credit`, userId)
      }
      this.audit.insert(userId, 'SALE_CREATED', 'sales', saleId, `${invoiceNo}; total ${total}; credit ${credit}`)
      return this.repository.saleDetail(saleId)!
    })()
  }

  private ensureDayOpen(date: string): void {
    if (this.db.prepare('SELECT id FROM daily_closings WHERE closing_date = ? AND is_locked = 1').get(date)) {
      throw new Error('This date is closed. An Admin must unlock the day before recording this transaction.')
    }
  }
}
