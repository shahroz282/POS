import type { DB } from '../db/db'
import type {
  AdmissionChargeRow, AdmissionClassRow, AdmissionDetail, AdmissionPaymentRow, AdmissionStudentRow
} from '@shared/schemas'

export class AdmissionsRepository {
  constructor(private readonly db: DB) {}

  listClasses(): AdmissionClassRow[] {
    return this.db.prepare(`
      SELECT c.id, c.class_name, c.academic_year, c.admission_fee,
        (SELECT COUNT(*) FROM admissions a WHERE a.class_id = c.id AND a.status = 'ACTIVE') AS student_count
      FROM class_folders c
      ORDER BY c.academic_year DESC, c.class_name
    `).all() as unknown as AdmissionClassRow[]
  }

  insertClass(className: string, academicYear: string, admissionFee: number): number {
    const result = this.db.prepare(
      'INSERT INTO class_folders (class_name, academic_year, admission_fee) VALUES (?, ?, ?)'
    ).run(className, academicYear, admissionFee)
    return Number(result.lastInsertRowid)
  }

  findClass(classId: number): { id: number; academic_year: string; admission_fee: number } | undefined {
    return this.db.prepare(
      'SELECT id, academic_year, admission_fee FROM class_folders WHERE id = ?'
    ).get(classId) as { id: number; academic_year: string; admission_fee: number } | undefined
  }

  summary(): {
    activeStudents: number; newThisMonth: number; collectedToday: number;
    collectedThisMonth: number; outstanding: number; pendingDues: number
  } {
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM admissions WHERE status = 'ACTIVE') AS active_students,
        (SELECT COUNT(*) FROM admissions WHERE admission_date >= date('now','localtime','start of month')) AS new_this_month,
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE admission_id IS NOT NULL AND date(paid_at) = date('now','localtime')) AS collected_today,
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE admission_id IS NOT NULL AND date(paid_at) >= date('now','localtime','start of month')) AS collected_this_month,
        (SELECT COALESCE(SUM(fc.amount - fc.discount_amount), 0) FROM admission_fee_charges fc)
          - (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.admission_id IS NOT NULL) AS outstanding,
        (SELECT COUNT(*) FROM admissions a WHERE a.status = 'ACTIVE' AND
          COALESCE((SELECT SUM(fc.amount - fc.discount_amount) FROM admission_fee_charges fc WHERE fc.admission_id = a.id), 0)
          > COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.admission_id = a.id), 0)) AS pending_dues
    `).get() as {
      active_students: number; new_this_month: number; collected_today: number;
      collected_this_month: number; outstanding: number; pending_dues: number
    }
    return {
      activeStudents: row.active_students, newThisMonth: row.new_this_month,
      collectedToday: row.collected_today, collectedThisMonth: row.collected_this_month,
      outstanding: row.outstanding, pendingDues: row.pending_dues
    }
  }

  insertStudent(input: {
    fullName: string; fatherName: string; fatherCnic?: string; bFormNumber?: string; phone?: string;
    fatherPhone?: string; whatsapp?: string; dateOfBirth?: string; gender?: string; address?: string;
    classId: number
  }): number {
    const result = this.db.prepare(`
      INSERT INTO students (
        full_name, father_name, phone, date_of_birth, class_id, father_cnic, b_form_number,
        gender, whatsapp, address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.fullName, input.fatherName, input.phone || null, input.dateOfBirth || null,
      input.classId, input.fatherCnic || null, input.bFormNumber || null, input.gender || null,
      input.whatsapp || null, input.address || null)
    const id = Number(result.lastInsertRowid)
    this.db.prepare('UPDATE students SET student_no = ? WHERE id = ?')
      .run(`STD-${String(id).padStart(6, '0')}`, id)
    return id
  }

  insertAdmission(input: {
    studentId: number; classId: number; admissionDate: string; fee: number;
    program?: string; educationBoard?: string; academicSession: string; remarks?: string; createdBy: number
  }): number {
    const result = this.db.prepare(`
      INSERT INTO admissions (
        student_id, class_id, admission_date, fee, status, remarks, created_by,
        program, education_board, academic_session
      ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)
    `).run(input.studentId, input.classId, input.admissionDate, input.fee,
      input.remarks || null, input.createdBy, input.program || null,
      input.educationBoard || null, input.academicSession)
    return Number(result.lastInsertRowid)
  }

  insertAdmissionFee(input: {
    admissionId: number; amount: number; discountAmount: number; dueDate?: string; createdBy: number
  }): number {
    const result = this.db.prepare(`
      INSERT INTO admission_fee_charges (
        admission_id, fee_type, description, amount, discount_amount, fee_month, due_date, created_by
      ) VALUES (?, 'ADMISSION', 'Admission fee', ?, ?, NULL, ?, ?)
    `).run(input.admissionId, input.amount, input.discountAmount, input.dueDate || null, input.createdBy)
    return Number(result.lastInsertRowid)
  }

  admissionExists(admissionId: number): boolean {
    return Boolean(this.db.prepare('SELECT id FROM admissions WHERE id = ?').get(admissionId))
  }

  listStudents(query: string, classId?: number): AdmissionStudentRow[] {
    const like = `%${query}%`
    return this.db.prepare(`
      SELECT ${this.studentSelect()}
      FROM admissions a
      JOIN students s ON s.id = a.student_id
      JOIN class_folders c ON c.id = a.class_id
      WHERE (? = '' OR s.student_no LIKE ? OR s.full_name LIKE ? OR s.father_name LIKE ?
        OR COALESCE(s.phone, '') LIKE ? OR COALESCE(s.father_phone, '') LIKE ?)
        AND (? IS NULL OR a.class_id = ?)
      ORDER BY a.admission_date DESC, a.id DESC
    `).all(query, like, like, like, like, like, classId ?? null, classId ?? null) as unknown as AdmissionStudentRow[]
  }

  getAdmission(admissionId: number): AdmissionDetail | undefined {
    const student = this.db.prepare(`
      SELECT ${this.studentSelect()}
      FROM admissions a
      JOIN students s ON s.id = a.student_id
      JOIN class_folders c ON c.id = a.class_id
      WHERE a.id = ?
    `).get(admissionId) as unknown as AdmissionStudentRow | undefined
    if (!student) return undefined

    const charges = this.db.prepare(`
      SELECT c.id, c.fee_type, c.description, c.amount, c.discount_amount,
        c.fee_month, c.due_date,
        COALESCE(SUM(pa.amount), 0) AS paid_amount,
        c.amount - c.discount_amount - COALESCE(SUM(pa.amount), 0) AS balance
      FROM admission_fee_charges c
      LEFT JOIN admission_payment_allocations pa ON pa.charge_id = c.id
      WHERE c.admission_id = ?
      GROUP BY c.id
      ORDER BY c.due_date, c.id
    `).all(admissionId) as unknown as AdmissionChargeRow[]
    const payments = this.db.prepare(`
      SELECT id, receipt_no, amount, method, reference_no, notes, paid_at, balance_after
      FROM payments WHERE admission_id = ? ORDER BY id DESC
    `).all(admissionId) as unknown as AdmissionPaymentRow[]
    return { ...student, charges, payments }
  }

  admissionBalance(admissionId: number): number {
    const row = this.db.prepare(`
      SELECT COALESCE((SELECT SUM(amount - discount_amount) FROM admission_fee_charges WHERE admission_id = ?), 0)
        - COALESCE((SELECT SUM(amount) FROM payments WHERE admission_id = ?), 0) AS balance
    `).get(admissionId, admissionId) as { balance: number }
    return row.balance
  }

  paymentByKey(key: string): (AdmissionPaymentRow & { admission_id: number }) | undefined {
    return this.db.prepare(`
      SELECT id, admission_id, receipt_no, amount, method, reference_no, notes, paid_at, balance_after
      FROM payments WHERE idempotency_key = ? AND admission_id IS NOT NULL
    `).get(key) as unknown as (AdmissionPaymentRow & { admission_id: number }) | undefined
  }

  nextReceiptNumber(day: string): string {
    this.db.prepare(`
      INSERT INTO counters (name, day, last_value) VALUES ('ADM', ?, 1)
      ON CONFLICT(name, day) DO UPDATE SET last_value = last_value + 1
    `).run(day)
    const counter = this.db.prepare(
      "SELECT last_value FROM counters WHERE name = 'ADM' AND day = ?"
    ).get(day) as { last_value: number }
    return `ADM-${day}-${String(counter.last_value).padStart(4, '0')}`
  }

  insertPayment(input: {
    receiptNumber: string; admissionId: number; idempotencyKey: string; amount: number;
    method: string; referenceNumber?: string; notes?: string; balanceAfter: number; createdBy: number
  }): number {
    const result = this.db.prepare(`
      INSERT INTO payments (
        receipt_no, admission_id, amount, method, reference_no, notes, created_by, idempotency_key, balance_after
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.receiptNumber, input.admissionId, input.amount, input.method,
      input.referenceNumber || null, input.notes || null, input.createdBy, input.idempotencyKey, input.balanceAfter)
    return Number(result.lastInsertRowid)
  }

  allocatePayment(paymentId: number, amount: number, admissionId: number): void {
    const dueCharges = this.db.prepare(`
      SELECT c.id, c.amount - c.discount_amount - COALESCE(SUM(pa.amount), 0) AS balance
      FROM admission_fee_charges c
      LEFT JOIN admission_payment_allocations pa ON pa.charge_id = c.id
      WHERE c.admission_id = ?
      GROUP BY c.id
      HAVING balance > 0
      ORDER BY COALESCE(c.due_date, '9999-12-31'), c.id
    `).all(admissionId) as Array<{ id: number; balance: number }>
    let remaining = amount
    for (const charge of dueCharges) {
      if (remaining <= 0) break
      const allocated = Math.min(remaining, charge.balance)
      this.db.prepare(
        'INSERT INTO admission_payment_allocations (payment_id, charge_id, amount) VALUES (?, ?, ?)'
      ).run(paymentId, charge.id, allocated)
      remaining -= allocated
    }
  }

  private studentSelect(): string {
    return `
      a.id AS admission_id, s.id AS student_id, COALESCE(s.student_no, printf('STD-%06d', s.id)) AS student_no,
      s.full_name, COALESCE(s.father_name, '') AS father_name, s.father_cnic, s.b_form_number, s.phone,
      s.father_phone, s.whatsapp, s.date_of_birth, s.gender, s.address,
      a.class_id, c.class_name, c.academic_year,
      a.admission_date, a.program, a.education_board, a.status,
      COALESCE((SELECT SUM(fc.amount) FROM admission_fee_charges fc WHERE fc.admission_id = a.id), 0) AS total_charges,
      COALESCE((SELECT SUM(fc.discount_amount) FROM admission_fee_charges fc WHERE fc.admission_id = a.id), 0) AS total_discounts,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.admission_id = a.id), 0) AS total_paid,
      COALESCE((SELECT SUM(fc.amount - fc.discount_amount) FROM admission_fee_charges fc WHERE fc.admission_id = a.id), 0)
        - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.admission_id = a.id), 0) AS balance
    `
  }
}
