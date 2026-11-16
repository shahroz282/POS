import { randomUUID } from 'node:crypto'
import type { FilerCustomerCreate, FilerCustomerPaymentCreate, FilerCustomerSearchSchema, FilerCustomerUpdate } from '@shared/schemas'
import type { z } from 'zod'
import type { DB } from '../db/db'
import { AuditLogRepository } from '../repositories/audit-log.repository'
import { FilerCustomersRepository } from '../repositories/filer-customers.repository'

type CustomerSearch = z.infer<typeof FilerCustomerSearchSchema>

export class FilerCustomersService {
  private readonly repository: FilerCustomersRepository
  private readonly audit: AuditLogRepository

  constructor(private readonly db: DB) {
    this.repository = new FilerCustomersRepository(db)
    this.audit = new AuditLogRepository(db)
  }

  list(search: CustomerSearch) {
    return this.repository.list(search)
  }

  create(input: FilerCustomerCreate, userId: number): number {
    return this.db.transaction(() => {
      this.ensureDayOpen(input.filingDate)
      const id = this.repository.create(input, userId)
      this.audit.insert(userId, 'FILER_CUSTOMER_CREATED', 'filer_customers', id, 'Created filing record')
      return id
    })()
  }

  update(input: FilerCustomerUpdate, userId: number): void {
    this.db.transaction(() => {
      const current = this.db.prepare('SELECT filing_date FROM filer_customers WHERE id = ?')
        .get(input.customerId) as { filing_date: string } | undefined
      if (!current) throw new Error('Filer customer not found')
      this.ensureDayOpen(current.filing_date)
      this.ensureDayOpen(input.filingDate)
      const existingBalance = this.repository.balance(input.customerId)
      if (existingBalance > input.totalFee) {
        throw new Error('Total fee cannot be lower than the amount already received')
      }
      const difference = input.advancePaid - existingBalance
      if (difference > 0) {
        this.repository.insertPayment({
          customerId: input.customerId,
          idempotencyKey: `LEGACY-FILER-UPDATE-${randomUUID()}`,
          entryType: 'RECEIVED',
          amount: difference,
          method: 'UNCLASSIFIED',
          paymentDate: input.filingDate,
          note: 'Balance adjustment made through the legacy customer edit form',
          createdBy: userId
        })
      } else if (difference < 0) {
        this.repository.insertPayment({
          customerId: input.customerId,
          idempotencyKey: `LEGACY-FILER-UPDATE-${randomUUID()}`,
          entryType: 'REVERSED',
          amount: -difference,
          method: 'UNCLASSIFIED',
          paymentDate: input.filingDate,
          note: 'Balance adjustment made through the legacy customer edit form',
          createdBy: userId
        })
      }
      this.repository.update(input)
      this.audit.insert(userId, 'FILER_CUSTOMER_UPDATED', 'filer_customers', input.customerId,
        `Updated filing record; advance paid ${input.advancePaid}`)
    })()
  }

  ensureExists(customerId: number): void {
    if (!this.repository.exists(customerId)) throw new Error('Filer customer not found')
  }

  payments(customerId: number) {
    this.ensureExists(customerId)
    return this.repository.payments(customerId)
  }

  recordPayment(input: FilerCustomerPaymentCreate, userId: number): number {
    return this.db.transaction(() => {
      const customer = this.db.prepare('SELECT total_fee FROM filer_customers WHERE id = ?')
        .get(input.customerId) as { total_fee: number } | undefined
      if (!customer) throw new Error('Filer customer not found')
      const existing = this.repository.findPaymentByKey(input.idempotencyKey)
      if (existing) {
        const isSameRequest = existing.customer_id === input.customerId &&
          existing.entry_type === input.entryType &&
          existing.amount === input.amount &&
          existing.method === input.method &&
          existing.payment_date === input.paymentDate &&
          (existing.note ?? '') === (input.note ?? '')
        if (!isSameRequest) throw new Error('Idempotency key has already been used for a different payment')
        return existing.id
      }
      this.ensureDayOpen(input.paymentDate)
      const balance = this.repository.balance(input.customerId)
      if (input.entryType === 'RECEIVED' && balance + input.amount > customer.total_fee) {
        throw new Error('Payment cannot exceed the remaining filer fee')
      }
      if (input.entryType === 'REVERSED' && input.amount > balance) {
        throw new Error('Reversal cannot exceed the amount previously received')
      }
      const id = this.repository.insertPayment({ ...input, createdBy: userId })
      this.audit.insert(userId, input.entryType === 'RECEIVED' ? 'FILER_PAYMENT_RECEIVED' : 'FILER_PAYMENT_REVERSED',
        'filer_customer_payments', id,
        `Customer ${input.customerId}; amount ${input.amount}; method ${input.method}; date ${input.paymentDate}; ${input.note || ''}`)
      return id
    })()
  }

  private ensureDayOpen(date: string): void {
    if (this.db.prepare('SELECT id FROM daily_closings WHERE closing_date = ? AND is_locked = 1').get(date)) {
      throw new Error('This date is closed. An Admin must unlock the day before recording this transaction.')
    }
  }
}
