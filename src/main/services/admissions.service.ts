import type {
  AdmissionClassCreate, AdmissionDetail, AdmissionPaymentCreate, AdmissionPaymentResult,
  AdmissionStudentCreate
} from '@shared/schemas'
import type { DB } from '../db/db'
import { AuditLogRepository } from '../repositories/audit-log.repository'
import { AdmissionsRepository } from '../repositories/admissions.repository'

export class AdmissionsService {
  private readonly repository: AdmissionsRepository
  private readonly audit: AuditLogRepository

  constructor(private readonly db: DB) {
    this.repository = new AdmissionsRepository(db)
    this.audit = new AuditLogRepository(db)
  }

  listClasses() {
    return this.repository.listClasses()
  }

  createClass(input: AdmissionClassCreate, userId: number): number {
    return this.db.transaction(() => {
      const classId = this.repository.insertClass(input.className, input.academicYear, input.admissionFee)
      this.audit.insert(userId, 'ADMISSION_CLASS_CREATED', 'class_folders', classId,
        `Created ${input.className} for ${input.academicYear}`)
      return classId
    })()
  }

  createStudent(input: AdmissionStudentCreate, userId: number, role: string): { admissionId: number; studentId: number; studentNo: string } {
    const classRow = this.repository.findClass(input.classId)
    if (!classRow) throw new Error('Select a valid class and academic year')
    if (role === 'CASHIER' && (input.admissionFee !== classRow.admission_fee || input.admissionDiscount > 0)) {
      throw new Error('Only Admin or Manager can change admission fees or discounts')
    }
    return this.db.transaction(() => {
      const studentId = this.repository.insertStudent({ ...input, classId: input.classId })
      const admissionId = this.repository.insertAdmission({
        studentId,
        classId: input.classId,
        admissionDate: input.admissionDate,
        fee: input.admissionFee,
        program: input.program,
        educationBoard: input.educationBoard,
        academicSession: classRow.academic_year,
        createdBy: userId
      })
      if (input.admissionFee > 0) {
        this.repository.insertAdmissionFee({
          admissionId,
          amount: input.admissionFee,
          discountAmount: input.admissionDiscount,
          dueDate: input.admissionFeeDueDate,
          createdBy: userId
        })
      }
      this.audit.insert(userId, 'STUDENT_ADMITTED', 'admissions', admissionId,
        `Admitted student STD-${String(studentId).padStart(6, '0')} to ${classRow.academic_year}`)
      return { admissionId, studentId, studentNo: `STD-${String(studentId).padStart(6, '0')}` }
    })()
  }

  listStudents(query: string, classId?: number) {
    return this.repository.listStudents(query, classId)
  }

  getAdmission(admissionId: number): AdmissionDetail {
    const detail = this.repository.getAdmission(admissionId)
    if (!detail) throw new Error('Admission not found')
    return detail
  }

  collectPayment(input: AdmissionPaymentCreate, userId: number): AdmissionPaymentResult {
    return this.db.transaction(() => {
      const admission = this.repository.getAdmission(input.admissionId)
      if (!admission) throw new Error('Admission not found')
      if (admission.status !== 'ACTIVE') throw new Error('Cannot collect payment for an inactive student')

      const existing = this.repository.paymentByKey(input.idempotencyKey)
      if (existing) {
        if (existing.admission_id !== input.admissionId || existing.amount !== input.amount || existing.method !== input.method) {
          throw new Error('Payment key was already used for a different transaction')
        }
        return {
          receiptNumber: existing.receipt_no,
          amount: existing.amount,
          balance: existing.balance_after ?? this.repository.admissionBalance(input.admissionId),
          paidAt: existing.paid_at,
          method: existing.method,
          referenceNumber: existing.reference_no
        }
      }

      const currentBalance = this.repository.admissionBalance(input.admissionId)
      if (currentBalance <= 0) throw new Error('There is no outstanding admission fee balance')
      if (input.amount > currentBalance) throw new Error('Payment cannot exceed the outstanding admission fee')

      const now = new Date()
      const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const receiptNumber = this.repository.nextReceiptNumber(day)
      const balanceAfter = currentBalance - input.amount
      const paymentId = this.repository.insertPayment({
        receiptNumber, admissionId: input.admissionId, idempotencyKey: input.idempotencyKey,
        amount: input.amount, method: input.method, referenceNumber: input.referenceNumber,
        notes: input.notes, balanceAfter, createdBy: userId
      })
      this.repository.allocatePayment(paymentId, input.amount, input.admissionId)
      const savedPayment = this.repository.paymentByKey(input.idempotencyKey)
      if (!savedPayment) throw new Error('Payment could not be verified after saving')
      this.audit.insert(userId, 'ADMISSION_PAYMENT_RECEIVED', 'payments', paymentId,
        `Receipt ${receiptNumber}; amount ${input.amount}; admission ${input.admissionId}`)
      return {
        receiptNumber,
        amount: input.amount,
        balance: balanceAfter,
        paidAt: savedPayment.paid_at,
        method: savedPayment.method,
        referenceNumber: savedPayment.reference_no
      }
    })()
  }

  summary() {
    return this.repository.summary()
  }
}
