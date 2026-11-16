import type { PhotocopyCreate, PhotocopySearch, PhotocopySaleRow } from '@shared/schemas'
import type { DB } from '../db/db'

export class PhotocopyRepository {
  constructor(private readonly db: DB) {}

  create(input: PhotocopyCreate, receiptNumber: string, userId: number, total: number): number {
    const result = this.db.prepare(`
      INSERT INTO photocopy_sales (
        receipt_number, idempotency_key, service_type, page_count, copy_count, duplex,
        unit_price, total_amount, customer_name, reference, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(receiptNumber, input.idempotencyKey, input.serviceType, input.pageCount, input.copyCount,
      input.duplex ? 1 : 0, input.unitPrice, total, input.customerName || null, input.reference || null, userId)
    const id = Number(result.lastInsertRowid)
    this.db.prepare(`
      INSERT INTO photocopy_payments (sale_id, receipt_number, amount, method, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, `${receiptNumber}-P1`, total, input.paymentMethod, userId)
    return id
  }

  findByKey(key: string): PhotocopySaleRow | undefined {
    return this.db.prepare(`${this.select()} WHERE s.idempotency_key = ?`).get(key) as unknown as PhotocopySaleRow | undefined
  }

  list(search: PhotocopySearch): PhotocopySaleRow[] {
    const like = `%${search.query}%`
    return this.db.prepare(`
      ${this.select()}
      WHERE (? = '' OR s.receipt_number LIKE ? OR COALESCE(s.customer_name, '') LIKE ? OR COALESCE(s.reference, '') LIKE ?)
        AND (? IS NULL OR date(s.created_at) >= date(?))
        AND (? IS NULL OR date(s.created_at) <= date(?))
      ORDER BY s.id DESC LIMIT 500
    `).all(search.query, like, like, like, search.fromDate ?? null, search.fromDate ?? null,
      search.toDate ?? null, search.toDate ?? null) as unknown as PhotocopySaleRow[]
  }

  get(id: number): PhotocopySaleRow | undefined {
    return this.db.prepare(`${this.select()} WHERE s.id = ?`).get(id) as unknown as PhotocopySaleRow | undefined
  }

  findRefundByKey(key: string): number | undefined {
    const row = this.db.prepare('SELECT sale_id FROM photocopy_refunds WHERE idempotency_key = ?')
      .get(key) as { sale_id: number } | undefined
    return row?.sale_id
  }

  refund(saleId: number, idempotencyKey: string, method: string, reason: string, userId: number, amount: number): void {
    this.db.prepare(`
      INSERT INTO photocopy_refunds (sale_id, idempotency_key, amount, method, reason, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(saleId, idempotencyKey, amount, method, reason, userId)
    this.db.prepare("UPDATE photocopy_sales SET status = 'CANCELLED' WHERE id = ?").run(saleId)
  }

  nextReceipt(day: string): string {
    this.db.prepare(`
      INSERT INTO counters (name, day, last_value) VALUES ('CPY', ?, 1)
      ON CONFLICT(name, day) DO UPDATE SET last_value = last_value + 1
    `).run(day)
    const counter = this.db.prepare("SELECT last_value FROM counters WHERE name = 'CPY' AND day = ?")
      .get(day) as { last_value: number }
    return `CPY-${day}-${String(counter.last_value).padStart(4, '0')}`
  }

  private select(): string {
    return `
      SELECT s.id, s.receipt_number, s.service_type, s.page_count, s.copy_count, s.duplex,
        s.unit_price, s.total_amount,
        COALESCE((SELECT SUM(p.amount) FROM photocopy_payments p WHERE p.sale_id = s.id), 0) AS amount_received,
        CASE WHEN s.status = 'CANCELLED' THEN 0
          ELSE MAX(0, s.total_amount - COALESCE((SELECT SUM(p.amount) FROM photocopy_payments p WHERE p.sale_id = s.id), 0)) END AS outstanding,
        s.customer_name, s.reference, s.status,
        COALESCE(r.amount, 0) AS refund_amount, r.method AS refund_method, r.reason AS refund_reason, s.created_at
      FROM photocopy_sales s LEFT JOIN photocopy_refunds r ON r.sale_id = s.id
    `
  }
}
