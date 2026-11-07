import type {
  UdhaarCustomerCreate, UdhaarCustomerRow, UdhaarEntryRow,
  UdhaarOutstandingSourceRow, UdhaarRepaymentResult, UdhaarSearchSchema
} from '@shared/schemas'
import type { z } from 'zod'
import type { DB } from '../db/db'

type UdhaarSearch = z.infer<typeof UdhaarSearchSchema>

export class UdhaarRepository {
  constructor(private readonly db: DB) {}

  listCustomers(search: UdhaarSearch): UdhaarCustomerRow[] {
    const query = `%${search.query}%`
    return this.db.prepare(`
      SELECT c.id, c.name, c.phone, c.address,
        COALESCE(SUM(CASE WHEN u.type = 'CHARGE' THEN u.amount ELSE 0 END), 0) AS total_charges,
        COALESCE(SUM(CASE WHEN u.type = 'REPAYMENT' THEN u.amount ELSE 0 END), 0) AS total_repayments,
        COALESCE(SUM(CASE WHEN u.type = 'CHARGE' THEN u.amount ELSE -u.amount END), 0) AS balance,
        CASE WHEN COALESCE(SUM(CASE WHEN u.type = 'CHARGE' THEN u.amount ELSE -u.amount END), 0) > 0
          THEN 'OUTSTANDING' ELSE 'SETTLED' END AS status,
        MAX(u.entry_date) AS last_activity
      FROM customers c
      LEFT JOIN udhaar_entries u ON u.customer_id = c.id
      WHERE (? = '%%' OR c.name LIKE ? OR COALESCE(c.phone, '') LIKE ?)
      GROUP BY c.id
      HAVING (? IS NULL OR
        CASE WHEN COALESCE(SUM(CASE WHEN u.type = 'CHARGE' THEN u.amount ELSE -u.amount END), 0) > 0
          THEN 'OUTSTANDING' ELSE 'SETTLED' END = ?)
      ORDER BY balance DESC, c.name COLLATE NOCASE
    `).all(query, query, query, search.status ?? null, search.status ?? null) as unknown as UdhaarCustomerRow[]
  }

  listOutstandingItems(): UdhaarOutstandingSourceRow[] {
    const items: UdhaarOutstandingSourceRow[] = []
    const addItems = (rows: Record<string, unknown>[]) => {
      items.push(...rows as unknown as UdhaarOutstandingSourceRow[])
    }

    addItems(this.db.prepare(`
      SELECT 'UDHAAR:' || c.id AS id, 'UDHAAR' AS source, 'Customer Udhaar' AS sourceLabel,
        c.name AS personName, c.phone, NULL AS identityCnic,
        printf('%d sale credit(s), %d manual charge(s)', 
          (SELECT COUNT(*) FROM udhaar_entries sale_entry WHERE sale_entry.customer_id = c.id
            AND sale_entry.type = 'CHARGE' AND sale_entry.sale_id IS NOT NULL),
          (SELECT COUNT(*) FROM udhaar_entries manual_entry WHERE manual_entry.customer_id = c.id
            AND manual_entry.type = 'CHARGE' AND manual_entry.sale_id IS NULL)) AS detail,
        NULL AS reference,
        COALESCE(SUM(CASE WHEN u.type = 'CHARGE' THEN u.amount ELSE 0 END), 0) AS totalAmount,
        COALESCE(SUM(CASE WHEN u.type = 'REPAYMENT' THEN u.amount ELSE 0 END), 0) AS paidAmount,
        SUM(CASE WHEN u.type = 'CHARGE' THEN u.amount ELSE -u.amount END) AS balance,
        MAX(u.entry_date) AS entryDate
      FROM customers c JOIN udhaar_entries u ON u.customer_id = c.id
      GROUP BY c.id HAVING balance > 0
    `).all())

    addItems(this.db.prepare(`
      SELECT 'ADMISSION:' || ch.id AS id, 'ADMISSION' AS source, 'Admissions' AS sourceLabel,
        st.full_name AS personName, COALESCE(st.phone, st.father_phone, st.whatsapp) AS phone,
        COALESCE(NULLIF(st.father_cnic, ''), NULLIF(st.b_form_number, '')) AS identityCnic,
        TRIM(cf.class_name || ' ' || cf.academic_year || ' · ' || ch.fee_type ||
          CASE WHEN ch.description IS NOT NULL AND ch.description <> '' THEN ' · ' || ch.description ELSE '' END ||
          CASE WHEN ch.fee_month IS NOT NULL THEN ' · ' || ch.fee_month ELSE '' END) AS detail,
        'Admission ' || COALESCE(st.student_no, printf('%06d', a.id)) AS reference,
        ch.amount - ch.discount_amount AS totalAmount,
        COALESCE((SELECT SUM(pa.amount) FROM admission_payment_allocations pa
          WHERE pa.charge_id = ch.id), 0) AS paidAmount,
        ch.amount - ch.discount_amount - COALESCE((SELECT SUM(pa.amount)
          FROM admission_payment_allocations pa WHERE pa.charge_id = ch.id), 0) AS balance,
        COALESCE(ch.due_date, a.admission_date) AS entryDate
      FROM admission_fee_charges ch
      JOIN admissions a ON a.id = ch.admission_id
      JOIN students st ON st.id = a.student_id
      JOIN class_folders cf ON cf.id = a.class_id
      WHERE a.status <> 'CANCELLED'
        AND ch.amount - ch.discount_amount - COALESCE((SELECT SUM(pa.amount)
          FROM admission_payment_allocations pa WHERE pa.charge_id = ch.id), 0) > 0
    `).all())

    addItems(this.db.prepare(`
      SELECT 'SCHEME:' || a.id AS id, 'SCHEME' AS source, 'Schemes' AS sourceLabel,
        a.applicant_name AS personName, a.mobile AS phone, a.cnic AS identityCnic,
        s.name || ' · ' || a.processing_status AS detail, a.application_no AS reference,
        a.application_fee - a.discount_amount AS totalAmount,
        COALESCE((SELECT SUM(p.amount) FROM payments p
          LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
          WHERE p.scheme_app_id = a.id AND r.id IS NULL), 0) AS paidAmount,
        MAX(0, a.application_fee - a.discount_amount - COALESCE((SELECT SUM(p.amount)
          FROM payments p LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
          WHERE p.scheme_app_id = a.id AND r.id IS NULL), 0)) AS balance,
        a.application_date AS entryDate
      FROM scheme_applications a JOIN schemes s ON s.id = a.scheme_id
      WHERE a.application_fee - a.discount_amount - COALESCE((SELECT SUM(p.amount)
        FROM payments p LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
        WHERE p.scheme_app_id = a.id AND r.id IS NULL), 0) > 0
    `).all())

    addItems(this.db.prepare(`
      SELECT 'STAMP_TXN:' || t.id AS id, 'STAMP' AS source, 'Stamp paper' AS sourceLabel,
        t.customer_name AS personName, NULL AS phone, NULL AS identityCnic,
        COALESCE(t.reference_name, 'Stamp transaction') AS detail, t.txn_no AS reference,
        ROUND(t.total_payable_paisa / 100.0, 2) AS totalAmount,
        ROUND(COALESCE((SELECT SUM(p.amount_paisa) FROM stamp_transaction_payments p WHERE p.stamp_id = t.id), 0) / 100.0, 2) AS paidAmount,
        ROUND((t.total_payable_paisa - COALESCE((SELECT SUM(p.amount_paisa)
          FROM stamp_transaction_payments p WHERE p.stamp_id = t.id), 0)) / 100.0, 2) AS balance,
        date(t.created_at) AS entryDate
      FROM stamp_paper_transactions t
      WHERE t.transaction_id IS NOT NULL AND t.status <> 'CANCELLED'
        AND t.total_payable_paisa > COALESCE((SELECT SUM(p.amount_paisa)
          FROM stamp_transaction_payments p WHERE p.stamp_id = t.id), 0)
    `).all())

    addItems(this.db.prepare(`
      SELECT 'STAMP_SALE:' || s.id AS id, 'STAMP' AS source, 'Stamp paper' AS sourceLabel,
        COALESCE(sp.full_name, fp.full_name) AS personName,
        COALESCE(sp.mobile_number, fp.mobile_number) AS phone,
        COALESCE(sp.cnic_number, fp.cnic_number) AS identityCnic,
        s.document_purpose AS detail, s.invoice_number AS reference,
        ROUND(s.total_payable_paisa / 100.0, 2) AS totalAmount,
        ROUND(MAX(0, COALESCE((SELECT SUM(p.amount_paisa) FROM stamp_paper_payments p
          WHERE p.sale_id = s.id), 0) - COALESCE((SELECT SUM(r.amount_paisa) FROM stamp_paper_refunds r
          WHERE r.sale_id = s.id), 0)) / 100.0, 2) AS paidAmount,
        ROUND(MAX(0, s.total_payable_paisa - COALESCE((SELECT SUM(p.amount_paisa)
          FROM stamp_paper_payments p WHERE p.sale_id = s.id), 0) + COALESCE((SELECT SUM(r.amount_paisa)
          FROM stamp_paper_refunds r WHERE r.sale_id = s.id), 0)) / 100.0, 2) AS balance,
        date(s.transaction_date) AS entryDate
      FROM stamp_paper_sales s
      JOIN stamp_paper_sale_parties fp ON fp.sale_id = s.id AND fp.party_role = 'FIRST_PARTY'
      JOIN stamp_paper_sale_parties sp ON sp.sale_id = s.id AND sp.party_role = 'SECOND_PARTY'
      WHERE s.status <> 'CANCELLED'
        AND s.total_payable_paisa - COALESCE((SELECT SUM(p.amount_paisa)
          FROM stamp_paper_payments p WHERE p.sale_id = s.id), 0) + COALESCE((SELECT SUM(r.amount_paisa)
          FROM stamp_paper_refunds r WHERE r.sale_id = s.id), 0) > 0
    `).all())

    addItems(this.db.prepare(`
      SELECT 'FILER:' || c.id AS id, 'FILER' AS source, 'Filer customers' AS sourceLabel,
        c.customer_name AS personName, c.mobile AS phone, c.cnic AS identityCnic,
        c.category AS detail, NULL AS reference, c.total_fee AS totalAmount,
        c.advance_paid AS paidAmount, c.total_fee - c.advance_paid AS balance,
        c.filing_date AS entryDate
      FROM filer_customers c WHERE c.total_fee > c.advance_paid
    `).all())

    return items
  }

  createCustomer(input: UdhaarCustomerCreate): number {
    const result = this.db.prepare(
      'INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)'
    ).run(input.name, input.phone || null, input.address || null)
    return Number(result.lastInsertRowid)
  }

  getCustomer(customerId: number): { id: number; name: string } | undefined {
    return this.db.prepare('SELECT id, name FROM customers WHERE id = ?').get(customerId) as
      { id: number; name: string } | undefined
  }

  balance(customerId: number): number {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(CASE type WHEN 'CHARGE' THEN amount ELSE -amount END), 0) AS balance
      FROM udhaar_entries WHERE customer_id = ?
    `).get(customerId) as { balance: number }
    return row.balance
  }

  entries(customerId: number): UdhaarEntryRow[] {
    return this.db.prepare(`
      SELECT u.id, u.type, u.amount, u.note, u.entry_date, u.created_at, u.sale_id,
        s.invoice_no, u.receipt_no, u.method, u.reference_no, users.name AS created_by_name
      FROM udhaar_entries u
      LEFT JOIN sales s ON s.id = u.sale_id
      JOIN users ON users.id = u.created_by
      WHERE u.customer_id = ?
      ORDER BY u.entry_date DESC, u.id DESC
    `).all(customerId) as unknown as UdhaarEntryRow[]
  }

  findEntryByKey(key: string): (UdhaarEntryRow & {
    customer_id: number; idempotency_key: string; created_by: number
  }) | undefined {
    return this.db.prepare(`
      SELECT u.id, u.customer_id, u.type, u.amount, u.note, u.entry_date, u.created_at, u.idempotency_key, u.created_by,
        u.sale_id, s.invoice_no, u.receipt_no, u.method, u.reference_no,
        users.name AS created_by_name
      FROM udhaar_entries u
      LEFT JOIN sales s ON s.id = u.sale_id
      JOIN users ON users.id = u.created_by
      WHERE u.idempotency_key = ?
    `).get(key) as unknown as (UdhaarEntryRow & {
      customer_id: number; idempotency_key: string; created_by: number
    }) | undefined
  }

  nextReceiptNumber(day: string): string {
    this.db.prepare(`
      INSERT INTO counters (name, day, last_value) VALUES ('UDH', ?, 1)
      ON CONFLICT(name, day) DO UPDATE SET last_value = last_value + 1
    `).run(day)
    const row = this.db.prepare(
      "SELECT last_value FROM counters WHERE name = 'UDH' AND day = ?"
    ).get(day) as { last_value: number }
    return `UDH-${day}-${String(row.last_value).padStart(4, '0')}`
  }

  insertEntry(input: {
    customerId: number
    type: 'CHARGE' | 'REPAYMENT'
    amount: number
    note?: string
    entryDate: string
    createdBy: number
    idempotencyKey: string
    receiptNumber?: string
    method?: string
    referenceNumber?: string
  }): number {
    const result = this.db.prepare(`
      INSERT INTO udhaar_entries (
        customer_id, type, amount, note, entry_date, created_by, idempotency_key,
        receipt_no, method, reference_no
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.customerId, input.type, input.amount, input.note || null, input.entryDate,
      input.createdBy, input.idempotencyKey, input.receiptNumber ?? null,
      input.method ?? null, input.referenceNumber || null)
    return Number(result.lastInsertRowid)
  }

  repaymentResult(entryId: number, balance: number): UdhaarRepaymentResult {
    const row = this.db.prepare(`
      SELECT u.id, u.receipt_no AS receiptNumber, u.amount, u.entry_date AS entryDate,
        u.method, u.reference_no AS referenceNumber, c.name AS customerName
      FROM udhaar_entries u JOIN customers c ON c.id = u.customer_id
      WHERE u.id = ?
    `).get(entryId) as unknown as Omit<UdhaarRepaymentResult, 'balance'> | undefined
    if (!row?.receiptNumber || !row.method) throw new Error('Repayment receipt could not be verified')
    return { ...row, balance, method: row.method as UdhaarRepaymentResult['method'] }
  }
}
