import type { DB } from '../db/db'
import type { StampInventoryRow, StampPartySummary, StampPaymentRow, StampRefundRow, StampSaleDetail, StampSaleListRow } from '@shared/schemas'

export interface StampPartyRow {
  id: number
  full_name: string
  father_or_husband_name: string | null
  cnic_number: string | null
  mobile_number: string | null
  address: string | null
  city: string | null
  district: string | null
}

export class StampPaperRepository {
  constructor(private readonly db: DB) {}

  listInventory(query: string): StampInventoryRow[] {
    return this.db.prepare(`
      SELECT id, item_type, denomination_paisa, serial_number, register_number, book_number,
        issuing_source, vendor_employee_name, purchase_cost_paisa, sale_price_paisa, status
      FROM stamp_paper_inventory
      WHERE status = 'AVAILABLE' AND (? = '' OR item_type LIKE ? OR serial_number LIKE ?)
      ORDER BY item_type, denomination_paisa, serial_number
    `).all(query, `%${query}%`, `%${query}%`) as unknown as StampInventoryRow[]
  }

  findInventory(id: number): StampInventoryRow | undefined {
    return this.db.prepare('SELECT * FROM stamp_paper_inventory WHERE id = ?').get(id) as unknown as StampInventoryRow | undefined
  }

  insertInventory(input: {
    itemType: string; denominationPaisa: number; serialNumber: string; registerNumber?: string;
    bookNumber?: string; issuingSource?: string; vendorEmployeeName?: string;
    purchaseCostPaisa: number; salePricePaisa: number; createdBy: number
  }): number {
    const result = this.db.prepare(`
      INSERT INTO stamp_paper_inventory (
        item_type, denomination_paisa, serial_number, register_number, book_number,
        issuing_source, vendor_employee_name, purchase_cost_paisa, sale_price_paisa, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.itemType, input.denominationPaisa, input.serialNumber, input.registerNumber || null,
      input.bookNumber || null, input.issuingSource || null, input.vendorEmployeeName || null,
      input.purchaseCostPaisa, input.salePricePaisa, input.createdBy)
    return Number(result.lastInsertRowid)
  }

  findParty(id: number): StampPartyRow | undefined {
    return this.db.prepare('SELECT * FROM parties WHERE id = ?').get(id) as unknown as StampPartyRow | undefined
  }

  insertParty(input: Omit<StampPartyRow, 'id'>): number {
    const result = this.db.prepare(`
      INSERT INTO parties (full_name, father_or_husband_name, cnic_number, mobile_number, address, city, district)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.full_name, input.father_or_husband_name, input.cnic_number, input.mobile_number,
      input.address, input.city, input.district)
    return Number(result.lastInsertRowid)
  }

  updateParty(id: number, input: Omit<StampPartyRow, 'id'>): void {
    this.db.prepare(`
      UPDATE parties SET full_name = ?, father_or_husband_name = ?, cnic_number = ?, mobile_number = ?,
        address = ?, city = ?, district = ?, updated_at = datetime('now','localtime') WHERE id = ?
    `).run(input.full_name, input.father_or_husband_name, input.cnic_number, input.mobile_number,
      input.address, input.city, input.district, id)
  }

  searchParties(query: string): StampPartyRow[] {
    const like = `%${query}%`
    return this.db.prepare(`
      SELECT id, full_name, father_or_husband_name, cnic_number, mobile_number, address, city, district
      FROM parties WHERE full_name LIKE ? OR mobile_number LIKE ? OR cnic_number LIKE ?
      ORDER BY full_name LIMIT 30
    `).all(like, like, like) as unknown as StampPartyRow[]
  }

  findSaleByIdempotencyKey(key: string): StampSaleListRow | undefined {
    return this.db.prepare(`
      SELECT s.id, s.transaction_id, s.invoice_number, s.transaction_date, s.status,
        fp.full_name AS first_party_name, sp.full_name AS second_party_name,
        i.serial_number, i.denomination_paisa, s.total_payable_paisa,
          COALESCE((SELECT SUM(p.amount_paisa) FROM stamp_paper_payments p WHERE p.sale_id = s.id), 0)
            - COALESCE((SELECT SUM(r.amount_paisa) FROM stamp_paper_refunds r WHERE r.sale_id = s.id), 0) AS amount_received_paisa,
          s.total_payable_paisa - COALESCE((SELECT SUM(p.amount_paisa) FROM stamp_paper_payments p WHERE p.sale_id = s.id), 0)
            + COALESCE((SELECT SUM(r.amount_paisa) FROM stamp_paper_refunds r WHERE r.sale_id = s.id), 0) AS outstanding_balance_paisa
      FROM stamp_paper_sales s
      JOIN stamp_paper_inventory i ON i.id = s.inventory_id
      JOIN stamp_paper_sale_parties fp ON fp.sale_id = s.id AND fp.party_role = 'FIRST_PARTY'
      JOIN stamp_paper_sale_parties sp ON sp.sale_id = s.id AND sp.party_role = 'SECOND_PARTY'
      WHERE s.idempotency_key = ?
    `).get(key) as unknown as StampSaleListRow | undefined
  }

  nextNumber(name: string, day: string): number {
    this.db.prepare(`
      INSERT INTO counters (name, day, last_value) VALUES (?, ?, 1)
      ON CONFLICT(name, day) DO UPDATE SET last_value = last_value + 1
    `).run(name, day)
    const row = this.db.prepare('SELECT last_value FROM counters WHERE name = ? AND day = ?').get(name, day) as { last_value: number }
    return row.last_value
  }

  insertSale(input: {
    transactionId: string; idempotencyKey: string; invoiceNumber: string; inventoryId: number;
    purpose: string; reference?: string; serviceChargesPaisa: number; otherFeesPaisa: number;
    totalPayablePaisa: number; remarks?: string; createdBy: number
  }): number {
    const result = this.db.prepare(`
      INSERT INTO stamp_paper_sales (
        transaction_id, idempotency_key, invoice_number, inventory_id, document_purpose,
        document_reference_number, service_charges_paisa, other_fees_paisa, total_payable_paisa, remarks, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.transactionId, input.idempotencyKey, input.invoiceNumber, input.inventoryId,
      input.purpose, input.reference || null, input.serviceChargesPaisa, input.otherFeesPaisa,
      input.totalPayablePaisa, input.remarks || null, input.createdBy)
    return Number(result.lastInsertRowid)
  }

  linkParty(saleId: number, partyId: number, role: 'FIRST_PARTY' | 'SECOND_PARTY', party: Omit<StampPartyRow, 'id'>): void {
    this.db.prepare(`
      INSERT INTO stamp_paper_sale_parties (
        sale_id, party_id, party_role, full_name, father_or_husband_name, cnic_number,
        mobile_number, address, city, district
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(saleId, partyId, role, party.full_name, party.father_or_husband_name,
      party.cnic_number, party.mobile_number, party.address, party.city, party.district)
  }

  insertPayment(input: {
    saleId: number; receiptNumber: string; amountPaisa: number; method: string;
    reference?: string; remarks?: string; createdBy: number
  }): void {
    this.db.prepare(`
      INSERT INTO stamp_paper_payments (sale_id, receipt_number, amount_paisa, method, reference_number, remarks, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.saleId, input.receiptNumber, input.amountPaisa, input.method,
      input.reference || null, input.remarks || null, input.createdBy)
  }

  insertRefund(input: { saleId: number; amountPaisa: number; method: string; reason: string; createdBy: number }): void {
    this.db.prepare(`
      INSERT INTO stamp_paper_refunds (sale_id, amount_paisa, method, remarks, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.saleId, input.amountPaisa, input.method, input.reason, input.createdBy)
  }

  insertMovement(inventoryId: number, saleId: number, type: 'SOLD' | 'SALE_REVERSED', userId: number, reason?: string): void {
    this.db.prepare(`
      INSERT INTO stamp_paper_inventory_movements (inventory_id, sale_id, movement_type, reason, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(inventoryId, saleId, type, reason || null, userId)
  }

  markInventorySold(inventoryId: number): void {
    const result = this.db.prepare("UPDATE stamp_paper_inventory SET status = 'SOLD' WHERE id = ? AND status = 'AVAILABLE'").run(inventoryId)
    if (result.changes !== 1) throw new Error('Stamp paper serial is no longer available')
  }

  listSales(query: string, fromDate?: string, toDate?: string, includeSensitive = false): StampSaleListRow[] {
    const like = `%${query}%`
    return this.db.prepare(`
      SELECT s.id, s.transaction_id, s.invoice_number, s.transaction_date, s.status,
        fp.full_name AS first_party_name, sp.full_name AS second_party_name,
        i.serial_number, i.denomination_paisa, s.total_payable_paisa,
        COALESCE((SELECT SUM(p.amount_paisa) FROM stamp_paper_payments p WHERE p.sale_id = s.id), 0)
          - COALESCE((SELECT SUM(r.amount_paisa) FROM stamp_paper_refunds r WHERE r.sale_id = s.id), 0) AS amount_received_paisa,
        s.total_payable_paisa - COALESCE((SELECT SUM(p.amount_paisa) FROM stamp_paper_payments p WHERE p.sale_id = s.id), 0)
          + COALESCE((SELECT SUM(r.amount_paisa) FROM stamp_paper_refunds r WHERE r.sale_id = s.id), 0) AS outstanding_balance_paisa
      FROM stamp_paper_sales s
      JOIN stamp_paper_inventory i ON i.id = s.inventory_id
      JOIN stamp_paper_sale_parties fp ON fp.sale_id = s.id AND fp.party_role = 'FIRST_PARTY'
      JOIN stamp_paper_sale_parties sp ON sp.sale_id = s.id AND sp.party_role = 'SECOND_PARTY'
      WHERE ((? = '' OR s.invoice_number LIKE ? OR s.transaction_id LIKE ? OR fp.full_name LIKE ? OR sp.full_name LIKE ? OR i.serial_number LIKE ?)
        OR (? = 1 AND (fp.cnic_number LIKE ? OR sp.cnic_number LIKE ? OR COALESCE(i.register_number, '') LIKE ? OR COALESCE(i.book_number, '') LIKE ?)))
        AND (? IS NULL OR date(s.transaction_date) >= date(?))
        AND (? IS NULL OR date(s.transaction_date) <= date(?))
      ORDER BY s.id DESC LIMIT 200
    `).all(query, like, like, like, like, like, includeSensitive ? 1 : 0, like, like, like, like, fromDate ?? null, fromDate ?? null, toDate ?? null, toDate ?? null) as unknown as StampSaleListRow[]
  }

  getSaleDetail(saleId: number): StampSaleDetail | undefined {
    const sale = this.db.prepare(`
      SELECT s.id, s.transaction_id, s.invoice_number, s.transaction_date, s.status,
        fp.full_name AS first_party_name, sp.full_name AS second_party_name,
        i.serial_number, i.denomination_paisa, s.total_payable_paisa,
        COALESCE((SELECT SUM(p.amount_paisa) FROM stamp_paper_payments p WHERE p.sale_id = s.id), 0)
          - COALESCE((SELECT SUM(r.amount_paisa) FROM stamp_paper_refunds r WHERE r.sale_id = s.id), 0) AS amount_received_paisa,
        s.total_payable_paisa - COALESCE((SELECT SUM(p.amount_paisa) FROM stamp_paper_payments p WHERE p.sale_id = s.id), 0)
          + COALESCE((SELECT SUM(r.amount_paisa) FROM stamp_paper_refunds r WHERE r.sale_id = s.id), 0) AS outstanding_balance_paisa,
        s.document_purpose, s.document_reference_number, s.service_charges_paisa, s.other_fees_paisa, s.remarks,
        i.item_type, i.purchase_cost_paisa, i.issuing_source, i.register_number, i.book_number
      FROM stamp_paper_sales s
      JOIN stamp_paper_inventory i ON i.id = s.inventory_id
      JOIN stamp_paper_sale_parties fp ON fp.sale_id = s.id AND fp.party_role = 'FIRST_PARTY'
      JOIN stamp_paper_sale_parties sp ON sp.sale_id = s.id AND sp.party_role = 'SECOND_PARTY'
      WHERE s.id = ?
    `).get(saleId) as Omit<StampSaleDetail, 'first_party' | 'second_party' | 'payments' | 'refunds'> | undefined
    if (!sale) return undefined

    const first = this.db.prepare(`SELECT party_id AS id, full_name, father_or_husband_name, cnic_number, mobile_number, address, city, district FROM stamp_paper_sale_parties WHERE sale_id = ? AND party_role = 'FIRST_PARTY'`).get(saleId) as unknown as StampPartySummary
    const second = this.db.prepare(`SELECT party_id AS id, full_name, father_or_husband_name, cnic_number, mobile_number, address, city, district FROM stamp_paper_sale_parties WHERE sale_id = ? AND party_role = 'SECOND_PARTY'`).get(saleId) as unknown as StampPartySummary
    const payments = this.db.prepare(`SELECT id, receipt_number, amount_paisa, method, reference_number, remarks, paid_at FROM stamp_paper_payments WHERE sale_id = ? ORDER BY id`).all(saleId) as unknown as StampPaymentRow[]
    const refunds = this.db.prepare(`SELECT id, amount_paisa, method, remarks, created_at FROM stamp_paper_refunds WHERE sale_id = ? ORDER BY id`).all(saleId) as unknown as StampRefundRow[]
    return { ...sale, first_party: first, second_party: second, payments, refunds }
  }

  insertDocument(input: {
    saleId: number; partyId?: number; category: string; originalFilename: string;
    storedFilename: string; relativePath: string; mimeType: string; fileSize: number; createdBy: number
  }): number {
    const result = this.db.prepare(`
      INSERT INTO stamp_paper_documents (
        sale_id, party_id, category, original_filename, stored_filename, relative_storage_path, mime_type, file_size, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.saleId, input.partyId ?? null, input.category, input.originalFilename,
      input.storedFilename, input.relativePath, input.mimeType, input.fileSize, input.createdBy)
    return Number(result.lastInsertRowid)
  }
}
