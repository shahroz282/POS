import type { FilerCustomerCreate, FilerCustomerRow, FilerCustomerSearchSchema, FilerCustomerUpdate } from '@shared/schemas'
import type { z } from 'zod'
import type { DB } from '../db/db'

type CustomerSearch = z.infer<typeof FilerCustomerSearchSchema>

export class FilerCustomersRepository {
  constructor(private readonly db: DB) {}

  list(search: CustomerSearch): FilerCustomerRow[] {
    const query = `%${search.query}%`
    return this.db.prepare(`
      SELECT c.id, c.customer_name, c.cnic, c.mobile, c.filing_date, c.category,
        c.total_fee, c.advance_paid, MAX(0, c.total_fee - c.advance_paid) AS pending_balance,
        CASE WHEN c.advance_paid >= c.total_fee THEN 'DONE' ELSE 'PENDING' END AS payment_status,
        d.id AS proof_document_id, d.original_filename AS proof_filename,
        c.created_at, c.updated_at
      FROM filer_customers c
      LEFT JOIN filer_customer_documents d ON d.customer_id = c.id AND d.is_active = 1
      WHERE (? = '%%' OR c.customer_name LIKE ? OR c.cnic LIKE ?)
        AND (? IS NULL OR CASE WHEN c.advance_paid >= c.total_fee THEN 'DONE' ELSE 'PENDING' END = ?)
      ORDER BY c.filing_date DESC, c.id DESC
    `).all(query, query, query, search.paymentStatus ?? null, search.paymentStatus ?? null) as unknown as FilerCustomerRow[]
  }

  create(input: FilerCustomerCreate, userId: number): number {
    const result = this.db.prepare(`
      INSERT INTO filer_customers (
        customer_name, cnic, mobile, filing_date, category, total_fee, advance_paid, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.customerName, input.cnic, input.mobile || null, input.filingDate,
      input.category, input.totalFee, input.advancePaid, userId)
    return Number(result.lastInsertRowid)
  }

  update(input: FilerCustomerUpdate): void {
    const result = this.db.prepare(`
      UPDATE filer_customers SET customer_name = ?, cnic = ?, mobile = ?, filing_date = ?,
        category = ?, total_fee = ?, advance_paid = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(input.customerName, input.cnic, input.mobile || null, input.filingDate,
      input.category, input.totalFee, input.advancePaid, input.customerId)
    if (!result.changes) throw new Error('Filer customer not found')
  }

  exists(customerId: number): boolean {
    return Boolean(this.db.prepare('SELECT id FROM filer_customers WHERE id = ?').get(customerId))
  }
}
