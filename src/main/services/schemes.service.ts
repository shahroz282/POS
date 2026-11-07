import type {
  SchemeApplicationCreate, SchemeApplicationDetail, SchemeApplicationSearchSchema,
  SchemeCreate, SchemePaymentCreate, SchemePaymentResult, SchemeUpdate,
  SchemeCustomFieldCreate, SchemeDocumentRequirementCreate, SchemeApplicationUpdate
} from '@shared/schemas'
import type { z } from 'zod'
import type { DB } from '../db/db'
import { AuditLogRepository } from '../repositories/audit-log.repository'
import { SchemesRepository } from '../repositories/schemes.repository'

type SchemeSearch = z.infer<typeof SchemeApplicationSearchSchema>

const transitions: Record<string, string[]> = {
  RECEIVED: ['UNDER_REVIEW', 'PENDING_DOCUMENTS', 'CANCELLED'],
  UNDER_REVIEW: ['SUBMITTED', 'APPROVED', 'REJECTED', 'PENDING_DOCUMENTS', 'CANCELLED'],
  SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PENDING_DOCUMENTS', 'CANCELLED'],
  PENDING_DOCUMENTS: ['UNDER_REVIEW', 'SUBMITTED', 'CANCELLED'],
  APPROVED: ['COMPLETED', 'CANCELLED'],
  REJECTED: [],
  COMPLETED: [],
  CANCELLED: []
}

export class SchemesService {
  private readonly repository: SchemesRepository
  private readonly audit: AuditLogRepository

  constructor(private readonly db: DB) {
    this.repository = new SchemesRepository(db)
    this.audit = new AuditLogRepository(db)
  }

  listSchemes() {
    return this.repository.listSchemes()
  }

  createScheme(input: SchemeCreate, userId: number): number {
    return this.db.transaction(() => {
      const id = this.repository.createScheme(input)
      this.audit.insert(userId, 'SCHEME_CREATED', 'schemes', id, `Created scheme ${input.schemeCode}`)
      return id
    })()
  }

  updateScheme(input: SchemeUpdate, userId: number): void {
    return this.db.transaction(() => {
      if (!this.repository.findScheme(input.schemeId)) throw new Error('Scheme not found')
      this.repository.updateScheme(input.schemeId, input)
      this.audit.insert(userId, 'SCHEME_UPDATED', 'schemes', input.schemeId, `Updated scheme ${input.schemeCode}`)
    })()
  }

  updateSchemeLifecycle(schemeId: number, lifecycleStatus: string, userId: number): void {
    return this.db.transaction(() => {
      if (!this.repository.findScheme(schemeId)) throw new Error('Scheme not found')
      this.repository.updateSchemeLifecycle(schemeId, lifecycleStatus)
      this.audit.insert(userId, 'SCHEME_LIFECYCLE_CHANGED', 'schemes', schemeId, `Status ${lifecycleStatus}`)
    })()
  }

  createCategory(schemeId: number, name: string, userId: number): number {
    if (!this.repository.findScheme(schemeId)) throw new Error('Scheme not found')
    return this.db.transaction(() => {
      const id = this.repository.createCategory(schemeId, name)
      this.audit.insert(userId, 'SCHEME_CATEGORY_CREATED', 'scheme_categories', id, `Added category ${name}`)
      return id
    })()
  }

  listCategories(schemeId: number) {
    if (!this.repository.findScheme(schemeId)) throw new Error('Scheme not found')
    return this.repository.listCategories(schemeId)
  }

  createCustomField(input: SchemeCustomFieldCreate, userId: number): number {
    if (!this.repository.findScheme(input.schemeId)) throw new Error('Scheme not found')
    return this.db.transaction(() => {
      const id = this.repository.createCustomField(input)
      this.audit.insert(userId, 'SCHEME_FIELD_CREATED', 'scheme_custom_fields', id, `Added field ${input.fieldKey}`)
      return id
    })()
  }

  listCustomFields(schemeId: number) {
    if (!this.repository.findScheme(schemeId)) throw new Error('Scheme not found')
    return this.repository.listCustomFields(schemeId)
  }

  createDocumentRequirement(input: SchemeDocumentRequirementCreate, userId: number): number {
    if (!this.repository.findScheme(input.schemeId)) throw new Error('Scheme not found')
    return this.db.transaction(() => {
      const id = this.repository.createDocumentRequirement(input.schemeId, input.name, input.isRequired)
      this.audit.insert(userId, 'SCHEME_DOCUMENT_REQUIREMENT_CREATED', 'scheme_document_requirements', id, input.name)
      return id
    })()
  }

  listDocumentRequirements(schemeId: number) {
    if (!this.repository.findScheme(schemeId)) throw new Error('Scheme not found')
    return this.repository.listDocumentRequirements(schemeId)
  }

  createApplication(input: SchemeApplicationCreate, userId: number, role: string): { applicationId: number; applicationNo: string } {
    const scheme = this.repository.findScheme(input.schemeId)
    if (!scheme) throw new Error('Select a valid scheme')
    if (scheme.lifecycle_status !== 'ACTIVE') throw new Error('Applications can only be added to an active scheme')
    if (scheme.start_date && input.applicationDate < scheme.start_date) throw new Error('Application date is before the scheme opening date')
    if (scheme.end_date && input.applicationDate > scheme.end_date) throw new Error('Application date is after the scheme closing date')
    const categories = this.repository.listCategories(input.schemeId)
    if (categories.length && input.category && !categories.some((category) => category.name === input.category)) {
      throw new Error('Select a category configured for this scheme')
    }
    const applicationFee = input.applicationFee ?? scheme.default_fee
    if (role === 'CASHIER' && (applicationFee !== scheme.default_fee || input.discountAmount > 0)) {
      throw new Error('Only Admin or Manager can change application fees or discounts')
    }
    if (input.discountAmount > applicationFee) throw new Error('Discount cannot exceed the application fee')
    const configuredFields = this.repository.listCustomFields(input.schemeId)
    const knownFields = new Set(configuredFields.map((field) => field.field_key))
    for (const key of Object.keys(input.customFields)) {
      if (!knownFields.has(key)) throw new Error(`Unknown scheme application field: ${key}`)
    }
    for (const field of configuredFields) {
      const value = input.customFields[field.field_key]?.trim() ?? ''
      if (field.is_required && !value) throw new Error(`${field.label} is required`)
      if (!value) continue
      if (field.field_type === 'NUMBER' && !/^-?\d+(\.\d+)?$/.test(value)) throw new Error(`${field.label} must be a number`)
      if (field.field_type === 'DATE') {
        const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null
        if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== value) {
          throw new Error(`${field.label} must be a valid date`)
        }
      }
      if (field.field_type === 'CHECKBOX' && !['true', 'false'].includes(value)) throw new Error(`${field.label} must be true or false`)
      if (field.field_type === 'SELECT') {
        const options = JSON.parse(field.options_json ?? '[]') as unknown
        if (!Array.isArray(options) || !options.includes(value)) throw new Error(`Select a valid value for ${field.label}`)
      }
    }
    return this.db.transaction(() => {
      const applicationNo = this.repository.nextApplicationNumber(
        scheme.id, scheme.scheme_code, input.applicationDate.slice(0, 4)
      )
      const applicationId = this.repository.insertApplication({
        ...input,
        applicationNo,
        applicationFee,
        customFieldsJson: JSON.stringify(input.customFields),
        createdBy: userId
      })
      this.audit.insert(userId, 'SCHEME_APPLICATION_CREATED', 'scheme_applications', applicationId,
        `Application ${applicationNo}; scheme ${scheme.scheme_code}`)
      return { applicationId, applicationNo }
    })()
  }

  listApplications(input: SchemeSearch) {
    return this.repository.listApplications(input)
  }

  getApplication(applicationId: number): SchemeApplicationDetail {
    const application = this.repository.getApplication(applicationId)
    if (!application) throw new Error('Scheme application not found')
    return application
  }

  updateApplication(input: SchemeApplicationUpdate, userId: number): void {
    return this.db.transaction(() => {
      const application = this.repository.getApplication(input.applicationId)
      if (!application) throw new Error('Scheme application not found')
      const categories = this.repository.listCategories(application.scheme_id)
      if (categories.length && input.category && !categories.some((category) => category.name === input.category)) {
        throw new Error('Select a category configured for this scheme')
      }
      this.repository.updateApplication(input.applicationId, input)
      this.audit.insert(userId, 'SCHEME_APPLICATION_UPDATED', 'scheme_applications', input.applicationId,
        'Updated applicant details')
    })()
  }

  updateStatus(applicationId: number, nextStatus: string, remarks: string | undefined, userId: number): void {
    return this.db.transaction(() => {
      const application = this.repository.getApplication(applicationId)
      if (!application) throw new Error('Scheme application not found')
      if (!transitions[application.status]?.includes(nextStatus)) {
        throw new Error(`Application status cannot change from ${application.status} to ${nextStatus}`)
      }
      if (nextStatus === 'SUBMITTED' || nextStatus === 'APPROVED') {
        const missing = this.repository.missingRequiredDocuments(applicationId)
        if (missing.length) throw new Error(`Required documents are missing: ${missing.join(', ')}`)
      }
      this.repository.updateStatus(applicationId, nextStatus, remarks, userId)
      this.audit.insert(userId, 'SCHEME_APPLICATION_STATUS_CHANGED', 'scheme_applications', applicationId,
        `${application.status} -> ${nextStatus}${remarks ? `: ${remarks}` : ''}`)
    })()
  }

  collectPayment(input: SchemePaymentCreate, userId: number): SchemePaymentResult {
    return this.db.transaction(() => {
      const existing = this.repository.paymentByKey(input.idempotencyKey)
      if (existing) {
        if (existing.scheme_app_id !== input.applicationId || existing.amount !== input.amount || existing.method !== input.method) {
          throw new Error('Payment key was already used for a different transaction')
        }
        if (existing.reversed) throw new Error('This payment was reversed. Use a new payment attempt if money has been received.')
        return {
          receiptNumber: existing.receipt_no,
          amount: existing.amount,
          balance: existing.balance_after ?? this.repository.applicationBalance(input.applicationId),
          paidAt: existing.paid_at,
          method: existing.method,
          referenceNumber: existing.reference_no
        }
      }

      const application = this.repository.getApplication(input.applicationId)
      if (!application || application.status === 'CANCELLED' || application.status === 'REJECTED') {
        throw new Error('Cannot collect payment for a cancelled or rejected application')
      }
      const lockedDay = this.db.prepare(
        "SELECT is_locked FROM daily_closings WHERE closing_date = date('now','localtime') AND is_locked = 1"
      ).get()
      if (lockedDay) throw new Error('Today is closed. An Admin must unlock the day before receiving payment.')

      const currentBalance = this.repository.applicationBalance(input.applicationId)
      if (currentBalance <= 0) throw new Error('There is no outstanding application fee balance')
      if (input.amount > currentBalance) throw new Error('Payment cannot exceed the outstanding application fee')
      const now = new Date()
      const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const receiptNumber = this.repository.nextReceiptNumber(day)
      const balanceAfter = currentBalance - input.amount
      const paymentId = this.repository.insertPayment({
        receiptNumber, applicationId: input.applicationId, idempotencyKey: input.idempotencyKey,
        amount: input.amount, method: input.method, referenceNumber: input.referenceNumber,
        notes: input.notes, balanceAfter, createdBy: userId
      })
      const saved = this.repository.paymentByKey(input.idempotencyKey)
      if (!saved) throw new Error('Payment could not be verified after saving')
      this.audit.insert(userId, 'SCHEME_PAYMENT_RECEIVED', 'payments', paymentId,
        `Receipt ${receiptNumber}; amount ${input.amount}; application ${application.application_no}`)
      return {
        receiptNumber, amount: input.amount, balance: balanceAfter, paidAt: saved.paid_at,
        method: saved.method, referenceNumber: saved.reference_no
      }
    })()
  }

  reversePayment(paymentId: number, reason: string, userId: number): void {
    return this.db.transaction(() => {
      this.repository.reversePayment(paymentId, reason, userId)
      this.audit.insert(userId, 'SCHEME_PAYMENT_REVERSED', 'payments', paymentId, reason)
    })()
  }

  summary() {
    return this.repository.summary()
  }

}
