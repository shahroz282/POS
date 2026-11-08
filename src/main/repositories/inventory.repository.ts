import type {
  InventoryMovementRow, InventoryProductRow, InventoryPurchaseRow,
  InventorySupplierRow, InventorySummary, SaleDetail, SaleRow
} from '@shared/schemas'
import type { DB } from '../db/db'

export class InventoryRepository {
  constructor(private readonly db: DB) {}

  summary(): InventorySummary {
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM products WHERE is_active = 1) AS productCount,
        (SELECT COUNT(*) FROM products WHERE is_active = 1 AND stock_qty <= low_stock_level) AS lowStockCount,
        COALESCE((SELECT SUM(stock_qty * purchase_price) FROM products WHERE is_active = 1), 0) AS stockValue,
        COALESCE((SELECT SUM(total) FROM sales WHERE date(created_at) = date('now','localtime')
          AND status <> 'RETURNED'), 0) AS todaySales,
        COALESCE((SELECT SUM(total) FROM purchases WHERE purchase_date = date('now','localtime')), 0) AS todayPurchases
    `).get() as unknown as InventorySummary
    return row
  }

  products(query: string, activeOnly: boolean, revealCosts: boolean): InventoryProductRow[] {
    const search = `%${query}%`
    return this.db.prepare(`
      SELECT p.id, p.name, ${revealCosts ? 'p.purchase_price' : 'NULL'} AS purchase_price,
        p.sale_price, p.stock_qty, p.low_stock_level, p.is_active
      FROM products p
      WHERE (? = '%%' OR p.name LIKE ?)
        AND (? = 0 OR p.is_active = 1)
      ORDER BY p.name COLLATE NOCASE
    `).all(search, search, activeOnly ? 1 : 0) as unknown as InventoryProductRow[]
  }

  createProduct(input: {
    name: string; purchasePrice: number; salePrice: number; lowStockLevel: number
  }): number {
    return Number(this.db.prepare(`
      INSERT INTO products (name, purchase_price, sale_price, low_stock_level)
      VALUES (?, ?, ?, ?)
    `).run(input.name, input.purchasePrice, input.salePrice, input.lowStockLevel).lastInsertRowid)
  }

  updateProduct(input: {
    id: number; name: string; purchasePrice: number; salePrice: number; lowStockLevel: number
  }): void {
    const result = this.db.prepare(`
      UPDATE products SET name = ?, purchase_price = ?, sale_price = ?, low_stock_level = ?
      WHERE id = ? AND is_active = 1
    `).run(input.name, input.purchasePrice, input.salePrice, input.lowStockLevel, input.id)
    if (result.changes !== 1) throw new Error('Active product not found')
  }

  ensureUniqueProductName(name: string, exceptId?: number): void {
    const duplicate = this.db.prepare(`
      SELECT id FROM products WHERE lower(trim(name)) = lower(trim(?)) AND (? IS NULL OR id <> ?)
      LIMIT 1
    `).get(name, exceptId ?? null, exceptId ?? null)
    if (duplicate) throw new Error('A product with this name already exists')
  }

  changeStock(productId: number, quantity: number, allowArchived = false): void {
    const result = this.db.prepare(`
      UPDATE products SET stock_qty = stock_qty + ?
      WHERE id = ? AND (? = 1 OR is_active = 1) AND stock_qty + ? >= 0
    `).run(quantity, productId, allowArchived ? 1 : 0, quantity)
    if (result.changes !== 1) throw new Error('Product is missing, inactive, or has insufficient stock')
  }

  setProductActive(id: number, active: boolean): void {
    const result = this.db.prepare('UPDATE products SET is_active = ? WHERE id = ?')
      .run(active ? 1 : 0, id)
    if (result.changes !== 1) throw new Error('Product not found')
  }

  product(id: number): InventoryProductRow | undefined {
    return this.db.prepare(`
      SELECT p.id, p.name, p.purchase_price, p.sale_price, p.stock_qty, p.low_stock_level, p.is_active
      FROM products p WHERE p.id = ?
    `).get(id) as unknown as InventoryProductRow | undefined
  }

  suppliers(): InventorySupplierRow[] {
    return this.db.prepare('SELECT id, name, phone FROM suppliers ORDER BY name COLLATE NOCASE')
      .all() as unknown as InventorySupplierRow[]
  }

  createSupplier(name: string, phone?: string): number {
    return Number(this.db.prepare('INSERT INTO suppliers (name, phone) VALUES (?, ?)')
      .run(name, phone || null).lastInsertRowid)
  }

  nextNumber(name: string, day: string): number {
    this.db.prepare(`
      INSERT INTO counters (name, day, last_value) VALUES (?, ?, 1)
      ON CONFLICT(name, day) DO UPDATE SET last_value = last_value + 1
    `).run(name, day)
    return (this.db.prepare('SELECT last_value FROM counters WHERE name = ? AND day = ?')
      .get(name, day) as unknown as { last_value: number }).last_value
  }

  insertPurchase(input: {
    purchaseNo: string; idempotencyKey: string; supplierId?: number | null
    purchaseDate: string; total: number; note?: string; createdBy: number
  }): number {
    return Number(this.db.prepare(`
      INSERT INTO purchases (purchase_no, idempotency_key, supplier_id, purchase_date, total, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.purchaseNo, input.idempotencyKey, input.supplierId ?? null, input.purchaseDate,
      input.total, input.note || null, input.createdBy).lastInsertRowid)
  }

  insertPurchaseItem(purchaseId: number, productId: number, quantity: number, unitCost: number): void {
    this.db.prepare(`
      INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?)
    `).run(purchaseId, productId, quantity, unitCost)
  }

  listPurchases(): InventoryPurchaseRow[] {
    return this.db.prepare(`
      SELECT pu.id, pu.purchase_no, s.name AS supplier_name, pu.purchase_date, pu.total,
        (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = pu.id) AS item_count,
        pu.note, u.name AS created_by_name
      FROM purchases pu LEFT JOIN suppliers s ON s.id = pu.supplier_id
      JOIN users u ON u.id = pu.created_by
      ORDER BY pu.purchase_date DESC, pu.id DESC LIMIT 200
    `).all() as unknown as InventoryPurchaseRow[]
  }

  purchaseByKey(key: string): {
    id: number; purchase_no: string; purchase_date: string; supplier_id: number | null; total: number; note: string | null
  } | undefined {
    return this.db.prepare('SELECT id, purchase_no, purchase_date, supplier_id, total, note FROM purchases WHERE idempotency_key = ?')
      .get(key) as unknown as {
        id: number; purchase_no: string; purchase_date: string; supplier_id: number | null; total: number; note: string | null
      } | undefined
  }

  purchaseItems(purchaseId: number): Array<{ product_id: number; quantity: number; unit_cost: number }> {
    return this.db.prepare('SELECT product_id, quantity, unit_cost FROM purchase_items WHERE purchase_id = ?')
      .all(purchaseId) as unknown as Array<{ product_id: number; quantity: number; unit_cost: number }>
  }

  insertMovement(productId: number, type: 'PURCHASE' | 'SALE' | 'RETURN' | 'ADJUSTMENT',
    quantity: number, refType: string | null, refId: number | null, note: string | null, userId: number): void {
    this.db.prepare(`
      INSERT INTO stock_movements (product_id, type, quantity, ref_type, ref_id, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(productId, type, quantity, refType, refId, note, userId)
  }

  movements(): InventoryMovementRow[] {
    return this.db.prepare(`
      SELECT m.id, m.product_id, p.name AS product_name, m.type, m.quantity, m.ref_type, m.ref_id,
        m.note, u.name AS created_by_name, m.created_at
      FROM stock_movements m JOIN products p ON p.id = m.product_id
      LEFT JOIN users u ON u.id = m.created_by
      ORDER BY m.id DESC LIMIT 300
    `).all() as unknown as InventoryMovementRow[]
  }

  insertSale(input: {
    invoiceNo: string; idempotencyKey: string; customerId?: number | null
    subtotal: number; discount: number; total: number; receivedAmount: number; status: 'COMPLETED' | 'PARTIAL'
    createdBy: number
  }): number {
    return Number(this.db.prepare(`
      INSERT INTO sales (invoice_no, idempotency_key, customer_id, subtotal, discount, total,
        received_amount, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.invoiceNo, input.idempotencyKey, input.customerId ?? null, input.subtotal,
      input.discount, input.total, input.receivedAmount, input.status, input.createdBy).lastInsertRowid)
  }

  insertSaleItem(saleId: number, productId: number, quantity: number,
    unitPrice: number, unitCost: number, lineTotal: number): void {
    this.db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, unit_cost, line_total)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(saleId, productId, quantity, unitPrice, unitCost, lineTotal)
  }

  insertPayment(input: {
    saleId: number; receiptNo: string; amount: number; method: string; idempotencyKey: string
    balanceAfter: number; createdBy: number
  }): void {
    this.db.prepare(`
      INSERT INTO payments (receipt_no, sale_id, amount, method, created_by, idempotency_key, balance_after)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.receiptNo, input.saleId, input.amount, input.method, input.createdBy,
      input.idempotencyKey, input.balanceAfter)
  }

  insertUdhaar(customerId: number, saleId: number, amount: number, idempotencyKey: string, userId: number): void {
    this.db.prepare(`
      INSERT INTO udhaar_entries (customer_id, sale_id, type, amount, note, entry_date, created_by, idempotency_key)
      VALUES (?, ?, 'CHARGE', ?, 'Sale credit', date('now','localtime'), ?, ?)
    `).run(customerId, saleId, amount, userId, idempotencyKey)
  }

  saleForReturn(saleId: number): {
    id: number; customer_id: number | null; subtotal: number; total: number
    received_amount: number; status: string
  } | undefined {
    return this.db.prepare(`
      SELECT id, customer_id, subtotal, total, received_amount, status FROM sales WHERE id = ?
    `).get(saleId) as unknown as {
      id: number; customer_id: number | null; subtotal: number; total: number
      received_amount: number; status: string
    } | undefined
  }

  saleReturnableItems(saleId: number): Array<{
    id: number; product_id: number; quantity: number; unit_price: number; returned_quantity: number
  }> {
    return this.db.prepare(`
      SELECT si.id, si.product_id, si.quantity, si.unit_price,
        COALESCE((SELECT SUM(ri.quantity) FROM sale_return_items ri
          JOIN sale_returns r ON r.id = ri.return_id WHERE ri.sale_item_id = si.id), 0) AS returned_quantity
      FROM sale_items si WHERE si.sale_id = ? ORDER BY si.id
    `).all(saleId) as unknown as Array<{
      id: number; product_id: number; quantity: number; unit_price: number; returned_quantity: number
    }>
  }

  returnByKey(key: string): {
    id: number; sale_id: number; return_amount: number; refund_method: string | null; refund_amount: number; reason: string | null
  } | undefined {
    return this.db.prepare(`
      SELECT id, sale_id, return_amount, refund_method, refund_amount, reason
      FROM sale_returns WHERE idempotency_key = ?
    `).get(key) as unknown as {
      id: number; sale_id: number; return_amount: number; refund_method: string | null; refund_amount: number; reason: string | null
    } | undefined
  }

  returnItems(returnId: number): Array<{ sale_item_id: number; quantity: number }> {
    return this.db.prepare('SELECT sale_item_id, quantity FROM sale_return_items WHERE return_id = ?')
      .all(returnId) as unknown as Array<{ sale_item_id: number; quantity: number }>
  }

  insertSaleReturn(input: {
    saleId: number; idempotencyKey: string; returnAmount: number; refundAmount: number
    refundMethod: string; reason: string; createdBy: number
  }): number {
    return Number(this.db.prepare(`
      INSERT INTO sale_returns (sale_id, idempotency_key, return_amount, refund_amount, refund_method, reason, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.saleId, input.idempotencyKey, input.returnAmount, input.refundAmount,
      input.refundMethod, input.reason, input.createdBy).lastInsertRowid)
  }

  insertSaleReturnItem(returnId: number, saleItemId: number, quantity: number): void {
    this.db.prepare('INSERT INTO sale_return_items (return_id, sale_item_id, quantity) VALUES (?, ?, ?)')
      .run(returnId, saleItemId, quantity)
  }

  saleReturnTotals(saleId: number): { returnAmount: number; refundAmount: number } {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(return_amount), 0) AS returnAmount,
        COALESCE(SUM(refund_amount), 0) AS refundAmount
      FROM sale_returns WHERE sale_id = ?
    `).get(saleId) as unknown as { returnAmount: number; refundAmount: number }
    return row
  }

  insertSaleCreditAdjustment(customerId: number, saleId: number, amount: number, key: string, userId: number): void {
    this.db.prepare(`
      INSERT INTO udhaar_entries (customer_id, sale_id, type, amount, note, entry_date, created_by, idempotency_key)
      VALUES (?, ?, 'REPAYMENT', ?, 'Sale return credit adjustment', date('now','localtime'), ?, ?)
    `).run(customerId, saleId, amount, userId, key)
  }

  customerBalance(customerId: number): number {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN type = 'CHARGE' THEN amount ELSE -amount END), 0) AS balance
      FROM udhaar_entries WHERE customer_id = ?
    `).get(customerId) as unknown as { balance: number }
    return Math.max(0, row.balance)
  }

  saleBalance(saleId: number): number {
    const row = this.db.prepare(`
      SELECT MAX(0, s.total - s.received_amount
        - COALESCE((SELECT SUM(a.amount) FROM udhaar_sale_allocations a WHERE a.sale_id = s.id), 0)
        - COALESCE((SELECT SUM(u.amount) FROM udhaar_entries u
          WHERE u.sale_id = s.id AND u.type = 'REPAYMENT'), 0)) AS balance
      FROM sales s WHERE s.id = ?
    `).get(saleId) as unknown as { balance: number } | undefined
    if (!row) throw new Error('Sale not found')
    return row.balance
  }

  saleCollectedAmount(saleId: number): number {
    const row = this.db.prepare(`
      SELECT s.received_amount + COALESCE((SELECT SUM(a.amount)
        FROM udhaar_sale_allocations a WHERE a.sale_id = s.id), 0) AS collected
      FROM sales s WHERE s.id = ?
    `).get(saleId) as unknown as { collected: number } | undefined
    if (!row) throw new Error('Sale not found')
    return row.collected
  }

  markSaleReturned(saleId: number): void {
    this.db.prepare("UPDATE sales SET status = 'RETURNED' WHERE id = ?").run(saleId)
  }

  saleByKey(key: string): (SaleDetail & { customer_id: number | null; payment_method: string | null }) | undefined {
    const row = this.db.prepare(`
      SELECT s.id, s.invoice_no, s.customer_id, c.name AS customer_name, c.phone AS customer_phone,
        s.subtotal, s.discount, s.total, s.received_amount,
        MAX(0, s.total - s.received_amount
          - COALESCE((SELECT SUM(a.amount) FROM udhaar_sale_allocations a WHERE a.sale_id = s.id), 0)
          - COALESCE((SELECT SUM(u.amount) FROM udhaar_entries u
            WHERE u.sale_id = s.id AND u.type = 'REPAYMENT'), 0)) AS balance,
        s.status, s.created_at, u.name AS created_by_name, NULL AS note,
        (SELECT method FROM payments WHERE sale_id = s.id ORDER BY id LIMIT 1) AS payment_method
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
      JOIN users u ON u.id = s.created_by WHERE s.idempotency_key = ?
    `).get(key) as unknown as (SaleDetail & { customer_id: number | null; payment_method: string | null }) | undefined
    return row ? { ...row, items: this.saleItems(row.id), returns: this.saleReturns(row.id) } : undefined
  }

  saleItems(saleId: number): SaleDetail['items'] {
    return this.db.prepare(`
      SELECT si.id, si.product_id, p.name AS product_name, si.quantity,
        COALESCE((SELECT SUM(ri.quantity) FROM sale_return_items ri WHERE ri.sale_item_id = si.id), 0) AS returned_quantity,
        si.unit_price, si.line_total
      FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? ORDER BY si.id
    `).all(saleId) as unknown as SaleDetail['items']
  }

  saleReturns(saleId: number): SaleDetail['returns'] {
    return this.db.prepare(`
      SELECT r.id, r.return_amount, r.refund_amount, r.refund_method, r.reason, r.created_at,
        u.name AS created_by_name
      FROM sale_returns r JOIN users u ON u.id = r.created_by WHERE r.sale_id = ?
      ORDER BY r.id DESC
    `).all(saleId) as unknown as SaleDetail['returns']
  }

  listSales(query: string, fromDate?: string, toDate?: string): SaleRow[] {
    const search = `%${query}%`
    return this.db.prepare(`
      SELECT s.id, s.invoice_no, c.name AS customer_name, s.subtotal, s.discount, s.total,
        s.received_amount, MAX(0, s.total - s.received_amount
          - COALESCE((SELECT SUM(a.amount) FROM udhaar_sale_allocations a WHERE a.sale_id = s.id), 0)
          - COALESCE((SELECT SUM(u.amount) FROM udhaar_entries u
            WHERE u.sale_id = s.id AND u.type = 'REPAYMENT'), 0)) AS balance,
        s.status, s.created_at,
        u.name AS created_by_name
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.created_by
      WHERE (? = '%%' OR s.invoice_no LIKE ? OR COALESCE(c.name, '') LIKE ?)
        AND (? IS NULL OR date(s.created_at) >= ?)
        AND (? IS NULL OR date(s.created_at) <= ?)
      ORDER BY s.id DESC LIMIT 300
    `).all(search, search, search, fromDate ?? null, fromDate ?? null, toDate ?? null, toDate ?? null) as unknown as SaleRow[]
  }

  saleDetail(saleId: number): SaleDetail | undefined {
    const row = this.db.prepare(`
      SELECT s.id, s.invoice_no, c.name AS customer_name, c.phone AS customer_phone,
        s.subtotal, s.discount, s.total, s.received_amount,
        MAX(0, s.total - s.received_amount
          - COALESCE((SELECT SUM(a.amount) FROM udhaar_sale_allocations a WHERE a.sale_id = s.id), 0)
          - COALESCE((SELECT SUM(u.amount) FROM udhaar_entries u
            WHERE u.sale_id = s.id AND u.type = 'REPAYMENT'), 0)) AS balance,
        s.status, s.created_at, u.name AS created_by_name,
        (SELECT note FROM udhaar_entries WHERE sale_id = s.id AND type = 'CHARGE' LIMIT 1) AS note
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
      JOIN users u ON u.id = s.created_by WHERE s.id = ?
    `).get(saleId) as unknown as SaleDetail | undefined
    return row ? { ...row, items: this.saleItems(row.id), returns: this.saleReturns(row.id) } : undefined
  }

  productPriceRows(productIds: number[]): Array<{
    id: number; name: string; sale_price: number; purchase_price: number; stock_qty: number; is_active: number
  }> {
    const placeholders = productIds.map(() => '?').join(',')
    return this.db.prepare(`
      SELECT id, name, sale_price, purchase_price, stock_qty, is_active FROM products
      WHERE id IN (${placeholders})
    `).all(...productIds) as unknown as Array<{
      id: number; name: string; sale_price: number; purchase_price: number; stock_qty: number; is_active: number
    }>
  }
}
