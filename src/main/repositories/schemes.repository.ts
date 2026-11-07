import type { DB } from '../db/db'
import type {
  SchemeApplicationDetail, SchemeApplicationRow, SchemePaymentRow, SchemeRow, SchemesSummary,
  SchemeApplicationSearch
} from '@shared/schemas'

export class SchemesRepository {
  constructor(private readonly db: DB) {}

  listSchemes(): SchemeRow[] {
    return this.db.prepare(`
      SELECT s.id, s.name, s.scheme_code, s.category, s.description, s.start_date, s.end_date,
        s.default_fee, s.lifecycle_status,
        (SELECT COUNT(*) FROM scheme_applications a WHERE a.scheme_id = s.id) AS application_count,
        (SELECT COUNT(*) FROM scheme_applications a WHERE a.scheme_id = s.id AND a.application_date = date('now','localtime')) AS today_applications,
        COALESCE((SELECT SUM(p.amount) FROM payments p
          JOIN scheme_applications a ON a.id = p.scheme_app_id
          LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
          WHERE a.scheme_id = s.id AND r.id IS NULL), 0) AS fees_collected,
        COALESCE((SELECT SUM(MAX(0, a.application_fee - a.discount_amount -
          COALESCE((SELECT SUM(p.amount) FROM payments p
            LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
            WHERE p.scheme_app_id = a.id AND r.id IS NULL), 0)))
          FROM scheme_applications a WHERE a.scheme_id = s.id), 0) AS outstanding
      FROM schemes s
      ORDER BY CASE s.lifecycle_status WHEN 'ACTIVE' THEN 0 WHEN 'SUSPENDED' THEN 1 ELSE 2 END, s.name
    `).all() as unknown as SchemeRow[]
  }

  createScheme(input: {
    name: string; schemeCode: string; category?: string; description?: string;
    startDate?: string; endDate?: string; defaultFee: number; lifecycleStatus: string
  }): number {
    const result = this.db.prepare(`
      INSERT INTO schemes (name, scheme_code, category, description, start_date, end_date, default_fee, is_active, lifecycle_status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `).run(input.name, input.schemeCode, input.category || null, input.description || null,
      input.startDate || null, input.endDate || null, input.defaultFee,
      input.lifecycleStatus === 'ACTIVE' ? 1 : 0, input.lifecycleStatus)
    return Number(result.lastInsertRowid)
  }

  updateScheme(schemeId: number, input: {
    name: string; schemeCode: string; category?: string; description?: string;
    startDate?: string; endDate?: string; defaultFee: number; lifecycleStatus: string
  }): void {
    this.db.prepare(`
      UPDATE schemes SET name = ?, scheme_code = ?, category = ?, description = ?,
        start_date = ?, end_date = ?, default_fee = ?, lifecycle_status = ?, is_active = ?,
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(input.name, input.schemeCode, input.category || null, input.description || null,
      input.startDate || null, input.endDate || null, input.defaultFee, input.lifecycleStatus,
      input.lifecycleStatus === 'ACTIVE' ? 1 : 0, schemeId)
  }

  updateSchemeLifecycle(schemeId: number, lifecycleStatus: string): void {
    this.db.prepare(`
      UPDATE schemes SET lifecycle_status = ?, is_active = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(lifecycleStatus, lifecycleStatus === 'ACTIVE' ? 1 : 0, schemeId)
  }

  createCategory(schemeId: number, name: string): number {
    const result = this.db.prepare(
      'INSERT INTO scheme_categories (scheme_id, name) VALUES (?, ?)'
    ).run(schemeId, name)
    return Number(result.lastInsertRowid)
  }

  listCategories(schemeId: number): Array<{ id: number; name: string }> {
    return this.db.prepare(`
      SELECT id, name FROM scheme_categories WHERE scheme_id = ? AND is_active = 1 ORDER BY name
    `).all(schemeId) as unknown as Array<{ id: number; name: string }>
  }

  createCustomField(input: {
    schemeId: number; fieldKey: string; label: string; fieldType: string; options: string[];
    isRequired: boolean; sortOrder: number
  }): number {
    const result = this.db.prepare(`
      INSERT INTO scheme_custom_fields (scheme_id, field_key, label, field_type, options_json, is_required, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(input.schemeId, input.fieldKey, input.label, input.fieldType,
      input.options.length ? JSON.stringify(input.options) : null, input.isRequired ? 1 : 0, input.sortOrder)
    return Number(result.lastInsertRowid)
  }

  listCustomFields(schemeId: number) {
    return this.db.prepare(`
      SELECT id, field_key, label, field_type, options_json, is_required
      FROM scheme_custom_fields WHERE scheme_id = ? AND is_active = 1 ORDER BY sort_order, id
    `).all(schemeId) as Array<{
      id: number; field_key: string; label: string; field_type: string; options_json: string | null; is_required: number
    }>
  }

  createDocumentRequirement(schemeId: number, name: string, isRequired: boolean): number {
    const result = this.db.prepare(`
      INSERT INTO scheme_document_requirements (scheme_id, name, is_required)
      VALUES (?, ?, ?)
    `).run(schemeId, name, isRequired ? 1 : 0)
    return Number(result.lastInsertRowid)
  }

  listDocumentRequirements(schemeId: number) {
    return this.db.prepare(`
      SELECT id, name, is_required FROM scheme_document_requirements
      WHERE scheme_id = ? AND is_active = 1 ORDER BY sort_order, id
    `).all(schemeId) as Array<{ id: number; name: string; is_required: number }>
  }

  findScheme(schemeId: number): {
    id: number; scheme_code: string; default_fee: number; lifecycle_status: string;
    start_date: string | null; end_date: string | null
  } | undefined {
    return this.db.prepare(
      'SELECT id, scheme_code, default_fee, lifecycle_status, start_date, end_date FROM schemes WHERE id = ?'
    ).get(schemeId) as unknown as {
      id: number; scheme_code: string; default_fee: number; lifecycle_status: string;
      start_date: string | null; end_date: string | null
    } | undefined
  }

  nextApplicationNumber(schemeId: number, schemeCode: string, year: string): string {
    this.db.prepare(`
      INSERT INTO scheme_application_counters (scheme_id, application_year, last_value)
      VALUES (?, ?, 1)
      ON CONFLICT(scheme_id, application_year) DO UPDATE SET last_value = last_value + 1
    `).run(schemeId, year)
    const counter = this.db.prepare(`
      SELECT last_value FROM scheme_application_counters WHERE scheme_id = ? AND application_year = ?
    `).get(schemeId, year) as { last_value: number }
    return `SCH-${schemeCode}-${year}-${String(counter.last_value).padStart(4, '0')}`
  }

  insertApplication(input: {
    applicationNo: string; schemeId: number; applicantName: string; fatherName?: string; cnic: string;
    mobile?: string; address?: string; city?: string; district?: string; category?: string; purpose?: string;
    applicationDate: string; applicationFee: number; discountAmount: number; remarks?: string;
    customFieldsJson: string; createdBy: number
  }): number {
    const result = this.db.prepare(`
      INSERT INTO scheme_applications (
        scheme_id, applicant_name, cnic, mobile, category, application_date, application_fee,
        status, remarks, created_by, application_no, father_name, address, city, district,
        purpose, discount_amount, custom_fields_json, processing_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED')
    `).run(input.schemeId, input.applicantName, input.cnic, input.mobile || null, input.category || null,
      input.applicationDate, input.applicationFee, input.remarks || null, input.createdBy,
      input.applicationNo, input.fatherName || null, input.address || null, input.city || null,
      input.district || null, input.purpose || null, input.discountAmount, input.customFieldsJson)
    const applicationId = Number(result.lastInsertRowid)
    this.db.prepare(`
      INSERT INTO scheme_application_status_history (application_id, from_status, to_status, changed_by)
      VALUES (?, NULL, 'RECEIVED', ?)
    `).run(applicationId, input.createdBy)
    return applicationId
  }

  listApplications(input: SchemeApplicationSearch): SchemeApplicationRow[] {
    const like = `%${input.query}%`
    return this.db.prepare(`
      SELECT ${this.applicationSelect()}
      FROM scheme_applications a JOIN schemes s ON s.id = a.scheme_id
      WHERE (? = '' OR a.application_no LIKE ? OR a.applicant_name LIKE ? OR COALESCE(a.father_name, '') LIKE ?
        OR a.cnic LIKE ? OR COALESCE(a.mobile, '') LIKE ? OR s.name LIKE ?)
        AND (? IS NULL OR a.scheme_id = ?)
        AND (? IS NULL OR a.processing_status = ?)
        AND (? IS NULL OR a.application_date >= ?)
        AND (? IS NULL OR a.application_date <= ?)
        AND (? IS NULL OR CASE
          WHEN a.application_fee - a.discount_amount <= COALESCE((SELECT SUM(p.amount) FROM payments p
            LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
            WHERE p.scheme_app_id = a.id AND r.id IS NULL), 0) THEN 'PAID'
          WHEN COALESCE((SELECT SUM(p.amount) FROM payments p
            LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
            WHERE p.scheme_app_id = a.id AND r.id IS NULL), 0) > 0 THEN 'PARTIAL'
          ELSE 'UNPAID' END = ?)
      ORDER BY a.application_date DESC, a.id DESC LIMIT 1000
    `).all(input.query, like, like, like, like, like, like,
      input.schemeId ?? null, input.schemeId ?? null, input.status ?? null, input.status ?? null,
      input.fromDate ?? null, input.fromDate ?? null, input.toDate ?? null, input.toDate ?? null,
      input.paymentStatus ?? null, input.paymentStatus ?? null
    ) as unknown as SchemeApplicationRow[]
  }

  getApplication(applicationId: number): SchemeApplicationDetail | undefined {
    const application = this.db.prepare(`
      SELECT ${this.applicationSelect()}, a.custom_fields_json
      FROM scheme_applications a JOIN schemes s ON s.id = a.scheme_id
      WHERE a.id = ?
    `).get(applicationId) as unknown as (SchemeApplicationRow & { custom_fields_json: string }) | undefined
    if (!application) return undefined
    const payments = this.db.prepare(`
      SELECT p.id, p.receipt_no, p.amount, p.method, p.reference_no, p.notes, p.paid_at,
        p.balance_after, CASE WHEN r.id IS NULL THEN 0 ELSE 1 END AS reversed, r.reason AS reversal_reason
      FROM payments p LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
      WHERE p.scheme_app_id = ? ORDER BY p.id DESC
    `).all(applicationId) as unknown as SchemePaymentRow[]
    const statusHistory = this.db.prepare(`
      SELECT h.id, h.from_status, h.to_status, h.remarks, u.name AS changed_by_name, h.changed_at
      FROM scheme_application_status_history h JOIN users u ON u.id = h.changed_by
      WHERE h.application_id = ? ORDER BY h.id DESC
    `).all(applicationId) as unknown as SchemeApplicationDetail['status_history']
    return { ...application, payments, status_history: statusHistory }
  }

  updateApplication(applicationId: number, input: {
    applicantName: string; fatherName?: string; cnic: string; mobile?: string; address?: string;
    city?: string; district?: string; category?: string; purpose?: string; remarks?: string
  }): void {
    const result = this.db.prepare(`
      UPDATE scheme_applications SET applicant_name = ?, father_name = ?, cnic = ?, mobile = ?,
        address = ?, city = ?, district = ?, category = ?, purpose = ?, remarks = ?
      WHERE id = ?
    `).run(input.applicantName, input.fatherName || null, input.cnic, input.mobile || null,
      input.address || null, input.city || null, input.district || null, input.category || null,
      input.purpose || null, input.remarks || null, applicationId)
    if (!result.changes) throw new Error('Scheme application not found')
  }

  updateStatus(applicationId: number, status: string, remarks: string | undefined, userId: number): void {
    const current = this.db.prepare(
      'SELECT processing_status FROM scheme_applications WHERE id = ?'
    ).get(applicationId) as { processing_status: string } | undefined
    if (!current) throw new Error('Application not found')
    const legacyStatus = status === 'APPROVED' || status === 'COMPLETED' ? 'APPROVED'
      : status === 'REJECTED' ? 'REJECTED' : status === 'CANCELLED' ? 'CANCELLED' : 'PENDING'
    this.db.prepare(`
      UPDATE scheme_applications SET processing_status = ?, status = ? WHERE id = ?
    `).run(status, legacyStatus, applicationId)
    this.db.prepare(`
      INSERT INTO scheme_application_status_history (application_id, from_status, to_status, remarks, changed_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(applicationId, current.processing_status, status, remarks || null, userId)
  }

  missingRequiredDocuments(applicationId: number): string[] {
    return this.db.prepare(`
      SELECT r.name FROM scheme_document_requirements r
      JOIN scheme_applications a ON a.scheme_id = r.scheme_id
      LEFT JOIN scheme_application_documents d
        ON d.requirement_id = r.id AND d.application_id = a.id AND d.is_active = 1
      WHERE a.id = ? AND r.is_active = 1 AND r.is_required = 1
      GROUP BY r.id HAVING COUNT(d.id) = 0
    `).all(applicationId).map((row) => String(row.name))
  }

  applicationBalance(applicationId: number): number {
    const row = this.db.prepare(`
      SELECT MAX(0, a.application_fee - a.discount_amount -
        COALESCE((SELECT SUM(p.amount) FROM payments p
          LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
          WHERE p.scheme_app_id = a.id AND r.id IS NULL), 0)) AS balance
      FROM scheme_applications a WHERE a.id = ?
    `).get(applicationId) as { balance: number } | undefined
    if (!row) throw new Error('Application not found')
    return row.balance
  }

  paymentByKey(key: string): (SchemePaymentRow & { scheme_app_id: number }) | undefined {
    return this.db.prepare(`
      SELECT p.id, p.scheme_app_id, p.receipt_no, p.amount, p.method, p.reference_no, p.notes,
        p.paid_at, p.balance_after, CASE WHEN r.id IS NULL THEN 0 ELSE 1 END AS reversed,
        r.reason AS reversal_reason
      FROM payments p LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
      WHERE p.idempotency_key = ? AND p.scheme_app_id IS NOT NULL
    `).get(key) as unknown as (SchemePaymentRow & { scheme_app_id: number }) | undefined
  }

  nextReceiptNumber(day: string): string {
    this.db.prepare(`
      INSERT INTO counters (name, day, last_value) VALUES ('SCHR', ?, 1)
      ON CONFLICT(name, day) DO UPDATE SET last_value = last_value + 1
    `).run(day)
    const row = this.db.prepare(
      "SELECT last_value FROM counters WHERE name = 'SCHR' AND day = ?"
    ).get(day) as { last_value: number }
    return `SCHR-${day}-${String(row.last_value).padStart(4, '0')}`
  }

  insertPayment(input: {
    receiptNumber: string; applicationId: number; idempotencyKey: string; amount: number;
    method: string; referenceNumber?: string; notes?: string; balanceAfter: number; createdBy: number
  }): number {
    const result = this.db.prepare(`
      INSERT INTO payments (
        receipt_no, scheme_app_id, amount, method, reference_no, notes, created_by, idempotency_key, balance_after
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.receiptNumber, input.applicationId, input.amount, input.method,
      input.referenceNumber || null, input.notes || null, input.createdBy, input.idempotencyKey, input.balanceAfter)
    return Number(result.lastInsertRowid)
  }

  reversePayment(paymentId: number, reason: string, userId: number): void {
    const payment = this.db.prepare(`
      SELECT id, scheme_app_id FROM payments WHERE id = ? AND scheme_app_id IS NOT NULL
    `).get(paymentId)
    if (!payment) throw new Error('Scheme payment not found')
    this.db.prepare(`
      INSERT INTO scheme_payment_reversals (payment_id, reason, reversed_by) VALUES (?, ?, ?)
    `).run(paymentId, reason, userId)
  }

  summary(): SchemesSummary {
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM schemes) AS total_schemes,
        (SELECT COUNT(*) FROM schemes WHERE lifecycle_status = 'ACTIVE') AS active_schemes,
        (SELECT COUNT(*) FROM schemes WHERE lifecycle_status = 'CLOSED') AS closed_schemes,
        (SELECT COUNT(*) FROM scheme_applications) AS total_applications,
        (SELECT COUNT(*) FROM scheme_applications WHERE application_date = date('now','localtime')) AS today_applications,
        (SELECT COUNT(*) FROM scheme_applications WHERE application_date >= date('now','localtime','start of month')) AS month_applications,
        (SELECT COUNT(*) FROM scheme_applications WHERE processing_status IN ('RECEIVED','UNDER_REVIEW','SUBMITTED','PENDING_DOCUMENTS')) AS pending_applications,
        (SELECT COUNT(*) FROM scheme_applications WHERE processing_status IN ('APPROVED','COMPLETED')) AS approved_applications,
        (SELECT COUNT(*) FROM scheme_applications WHERE processing_status = 'REJECTED') AS rejected_applications,
        (SELECT COALESCE(SUM(p.amount),0) FROM payments p LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
          WHERE p.scheme_app_id IS NOT NULL AND r.id IS NULL AND date(p.paid_at) = date('now','localtime')) AS today_collection,
        (SELECT COALESCE(SUM(p.amount),0) FROM payments p LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
          WHERE p.scheme_app_id IS NOT NULL AND r.id IS NULL AND date(p.paid_at) >= date('now','localtime','start of month')) AS month_collection,
        (SELECT COALESCE(SUM(MAX(0, a.application_fee - a.discount_amount -
          COALESCE((SELECT SUM(p.amount) FROM payments p LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
            WHERE p.scheme_app_id = a.id AND r.id IS NULL), 0))), 0) FROM scheme_applications a) AS outstanding
    `).get() as Record<string, number>
    const recentPayments = this.db.prepare(`
      SELECT p.id, p.receipt_no, a.application_no, a.applicant_name, s.name AS scheme_name,
        p.amount, p.method, p.paid_at, CASE WHEN r.id IS NULL THEN 0 ELSE 1 END AS reversed
      FROM payments p
      JOIN scheme_applications a ON a.id = p.scheme_app_id
      JOIN schemes s ON s.id = a.scheme_id
      LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
      ORDER BY p.id DESC LIMIT 10
    `).all() as unknown as SchemesSummary['recentPayments']
    return {
      totalSchemes: row.total_schemes, activeSchemes: row.active_schemes, closedSchemes: row.closed_schemes,
      totalApplications: row.total_applications, todayApplications: row.today_applications,
      monthApplications: row.month_applications, pendingApplications: row.pending_applications,
      approvedApplications: row.approved_applications, rejectedApplications: row.rejected_applications,
      todayCollection: row.today_collection, monthCollection: row.month_collection, outstanding: row.outstanding,
      recentPayments
    }
  }

  private applicationSelect(): string {
    return `
      a.id, a.application_no, a.scheme_id, s.name AS scheme_name, s.scheme_code,
      a.applicant_name, a.father_name, a.cnic, a.mobile, a.address, a.city, a.district, a.category,
      a.purpose, a.application_date, a.application_fee, a.discount_amount,
      a.processing_status AS status, a.remarks,
      COALESCE((SELECT SUM(p.amount) FROM payments p LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
        WHERE p.scheme_app_id = a.id AND r.id IS NULL), 0) AS total_paid,
      MAX(0, a.application_fee - a.discount_amount -
        COALESCE((SELECT SUM(p.amount) FROM payments p LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
          WHERE p.scheme_app_id = a.id AND r.id IS NULL), 0)) AS balance
    `
  }
}
