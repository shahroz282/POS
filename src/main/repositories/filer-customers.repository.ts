import type { FilerCustomerCreate, FilerCustomerPaymentCreate, FilerCustomerPaymentRow, FilerCustomerRow, FilerCustomerSearchSchema, FilerCustomerUpdate } from '@shared/schemas'
import type { z } from 'zod'
import type { DB } from '../db/db'

type CustomerSearch = z.infer<typeof FilerCustomerSearchSchema>
type FilerPaymentIdentity = Pick<FilerCustomerPaymentRow,
  'id' | 'entry_type' | 'amount' | 'method' | 'payment_date' | 'note'> & { customer_id: number }

export class FilerCustomersRepository {
  constructor(private readonly db: DB) {}

  list(search: CustomerSearch): FilerCustomerRow[] {
    const query = `%${search.query}%`
    return this.db.prepare(`
      SELECT c.id, c.customer_name, c.cnic, c.mobile, c.filing_date, c.category,
        c.total_fee, COALESCE((SELECT SUM(CASE WHEN p.entry_type = 'RECEIVED' THEN p.amount ELSE -p.amount END)
          FROM filer_customer_payments p WHERE p.customer_id = c.id), 0) AS advance_paid,
        MAX(0, c.total_fee - COALESCE((SELECT SUM(CASE WHEN p.entry_type = 'RECEIVED' THEN p.amount ELSE -p.amount END)
          FROM filer_customer_payments p WHERE p.customer_id = c.id), 0)) AS pending_balance,
        CASE WHEN COALESCE((SELECT SUM(CASE WHEN p.entry_type = 'RECEIVED' THEN p.amount ELSE -p.amount END)
          FROM filer_customer_payments p WHERE p.customer_id = c.id), 0) >= c.total_fee THEN 'DONE' ELSE 'PENDING' END AS payment_status,
        d.id AS proof_document_id, d.original_filename AS proof_filename,
        c.created_at, c.updated_at
      FROM filer_customers c
      LEFT JOIN filer_customer_documents d ON d.customer_id = c.id AND d.is_active = 1
      WHERE (? = '%%' OR c.customer_name LIKE ? OR c.cnic LIKE ?)
        AND (? IS NULL OR CASE WHEN COALESCE((SELECT SUM(CASE WHEN p.entry_type = 'RECEIVED' THEN p.amount ELSE -p.amount END)
          FROM filer_customer_payments p WHERE p.customer_id = c.id), 0) >= c.total_fee THEN 'DONE' ELSE 'PENDING' END = ?)
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
    const id = Number(result.lastInsertRowid)
    if (input.advancePaid > 0) {
      this.insertPayment({
        customerId: id,
        idempotencyKey: `LEGACY-FILER-CREATE-${id}`,
        entryType: 'RECEIVED',
        amount: input.advancePaid,
        method: 'UNCLASSIFIED',
        paymentDate: input.filingDate,
        note: 'Opening advance entered during customer setup',
        createdBy: userId
      })
    }
    return id
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

  balance(customerId: number): number {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN entry_type = 'RECEIVED' THEN amount ELSE -amount END), 0) AS balance
      FROM filer_customer_payments WHERE customer_id = ?
    `).get(customerId) as { balance: number }
    return row.balance
  }

  findPaymentByKey(key: string): FilerPaymentIdentity | undefined {
    return this.db.prepare(`
      SELECT id, customer_id, entry_type, amount, method, payment_date, note
      FROM filer_customer_payments WHERE idempotency_key = ?
    `).get(key) as FilerPaymentIdentity | undefined
  }

  insertPayment(input: FilerCustomerPaymentCreate & { createdBy: number }): number {
    const result = this.db.prepare(`
      INSERT INTO filer_customer_payments
        (customer_id, idempotency_key, entry_type, amount, method, payment_date, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.customerId, input.idempotencyKey, input.entryType, input.amount, input.method,
      input.paymentDate, input.note || null, input.createdBy)
    return Number(result.lastInsertRowid)
  }

  payments(customerId: number): FilerCustomerPaymentRow[] {
    return this.db.prepare(`
      SELECT p.id, p.idempotency_key, p.entry_type, p.amount, p.method, p.payment_date, p.note,
        p.created_at, u.name AS created_by_name
      FROM filer_customer_payments p JOIN users u ON u.id = p.created_by
      WHERE p.customer_id = ? ORDER BY p.payment_date DESC, p.id DESC
    `).all(customerId) as unknown as FilerCustomerPaymentRow[]
  }
}
