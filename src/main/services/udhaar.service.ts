import { createHash } from 'node:crypto'
import type {
  UdhaarCustomerCreate, UdhaarEntryCreate, UdhaarOutstandingGroup, UdhaarRepaymentCreate, UdhaarSearchSchema
} from '@shared/schemas'
import type { z } from 'zod'
import type { DB } from '../db/db'
import { AuditLogRepository } from '../repositories/audit-log.repository'
import { UdhaarRepository } from '../repositories/udhaar.repository'

type UdhaarSearch = z.infer<typeof UdhaarSearchSchema>

export class UdhaarService {
  private readonly repository: UdhaarRepository
  private readonly audit: AuditLogRepository

  constructor(private readonly db: DB) {
    this.repository = new UdhaarRepository(db)
    this.audit = new AuditLogRepository(db)
  }

  listCustomers(search: UdhaarSearch) {
    return this.repository.listCustomers(search)
  }

  allOutstanding(): UdhaarOutstandingGroup[] {
    const groups = new Map<string, UdhaarOutstandingGroup>()
    const records = this.repository.listOutstandingItems()
    const cnicsByPhone = new Map<string, Set<string>>()
    for (const item of records) {
      const phone = item.phone?.replace(/\D/g, '')
      const cnic = item.identityCnic?.replace(/\D/g, '')
      if (!phone || !cnic) continue
      const identities = cnicsByPhone.get(phone) ?? new Set<string>()
      identities.add(cnic)
      cnicsByPhone.set(phone, identities)
    }

    for (const item of records) {
      if (item.balance <= 0) continue
      const cnic = item.identityCnic?.replace(/\D/g, '')
      const phone = item.phone?.replace(/\D/g, '')
      const phoneCnics = phone ? cnicsByPhone.get(phone) : undefined
      const linkedCnic = phoneCnics?.size === 1 ? [...phoneCnics][0] : undefined
      const identity = cnic ? `cnic:${cnic}` : linkedCnic ? `cnic:${linkedCnic}` :
        phone ? `phone:${phone}` : `record:${item.id}`
      let group = groups.get(identity)
      if (!group) {
        group = {
          id: `outstanding-${createHash('sha256').update(identity).digest('hex').slice(0, 20)}`,
          name: item.personName || item.sourceLabel,
          phone: item.phone,
          totalOutstanding: 0,
          items: []
        }
        groups.set(identity, group)
      }
      if (!group.phone && item.phone) group.phone = item.phone
      group.totalOutstanding += item.balance
      const { identityCnic: _identityCnic, ...publicItem } = item
      group.items.push(publicItem)
    }
    return [...groups.values()].sort((left, right) => right.totalOutstanding - left.totalOutstanding)
  }

  createCustomer(input: UdhaarCustomerCreate, userId: number): number {
    return this.db.transaction(() => {
      const id = this.repository.createCustomer(input)
      this.audit.insert(userId, 'UDHAAR_CUSTOMER_CREATED', 'customers', id, 'Created customer ledger')
      return id
    })()
  }

  entries(customerId: number) {
    if (!this.repository.getCustomer(customerId)) throw new Error('Customer not found')
    return this.repository.entries(customerId)
  }

  createCharge(input: UdhaarEntryCreate, userId: number): { id: number; balance: number } {
    return this.db.transaction(() => {
      const customer = this.repository.getCustomer(input.customerId)
      if (!customer) throw new Error('Customer not found')
      const existing = this.repository.findEntryByKey(input.idempotencyKey)
      if (existing) {
        this.ensureMatchingRetry(existing, input, 'CHARGE')
        return { id: existing.id, balance: this.repository.balance(input.customerId) }
      }
      this.ensureDayOpen(input.entryDate)
      const id = this.repository.insertEntry({
        ...input, type: 'CHARGE', createdBy: userId
      })
      this.audit.insert(userId, 'UDHAAR_CHARGE_ADDED', 'udhaar_entries', id,
        `Manual charge ${input.amount} for customer ${input.customerId}`)
      return { id, balance: this.repository.balance(input.customerId) }
    })()
  }

  createRepayment(input: UdhaarRepaymentCreate, userId: number) {
    return this.db.transaction(() => {
      const customer = this.repository.getCustomer(input.customerId)
      if (!customer) throw new Error('Customer not found')
      const existing = this.repository.findEntryByKey(input.idempotencyKey)
      if (existing) {
        this.ensureMatchingRetry(existing, input, 'REPAYMENT', input.method, input.referenceNumber)
        return this.repository.repaymentResult(existing.id, this.repository.balance(input.customerId))
      }
      this.ensureDayOpen(input.entryDate)
      const balance = this.repository.balance(input.customerId)
      if (balance <= 0) throw new Error('This customer has no outstanding balance')
      if (input.amount > balance) throw new Error('Repayment cannot exceed the outstanding balance')
      const now = new Date()
      const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const receiptNumber = this.repository.nextReceiptNumber(day)
      const id = this.repository.insertEntry({
        ...input,
        type: 'REPAYMENT',
        createdBy: userId,
        receiptNumber,
        method: input.method,
        referenceNumber: input.referenceNumber
      })
      const newBalance = this.repository.balance(input.customerId)
      if (input.method === 'CASH') {
        this.db.prepare(`
          INSERT INTO cash_entries (type, amount, reason, entry_date, created_by)
          VALUES ('CASH_IN', ?, ?, ?, ?)
        `).run(input.amount, `Udhaar repayment ${receiptNumber}`, input.entryDate, userId)
      }
      this.audit.insert(userId, 'UDHAAR_REPAYMENT_RECEIVED', 'udhaar_entries', id,
        `Receipt ${receiptNumber}; amount ${input.amount}; customer ${input.customerId}`)
      if (input.method === 'CASH') {
        this.audit.insert(userId, 'UDHAAR_CASH_RECEIVED', 'cash_entries', null,
          `Udhaar repayment ${receiptNumber}; amount ${input.amount}`)
      }
      return this.repository.repaymentResult(id, newBalance)
    })()
  }

  private ensureDayOpen(entryDate: string): void {
    const lockedDay = this.db.prepare(
      'SELECT is_locked FROM daily_closings WHERE closing_date = ? AND is_locked = 1'
    ).get(entryDate)
    if (lockedDay) throw new Error('This date is closed. An Admin must unlock the day before changing the ledger.')
  }

  private ensureMatchingRetry(
    existing: {
      customer_id: number; type: string; amount: number; entry_date: string;
      note: string | null; method: string | null; reference_no: string | null
    },
    input: { customerId: number; amount: number; entryDate: string; note?: string },
    type: 'CHARGE' | 'REPAYMENT',
    method?: string,
    referenceNumber?: string
  ): void {
    if (existing.customer_id !== input.customerId || existing.type !== type ||
      existing.amount !== input.amount || existing.entry_date !== input.entryDate ||
      existing.note !== (input.note || null)) {
      throw new Error('This request key was already used for a different ledger entry')
    }
    if (type === 'REPAYMENT' && (existing.method !== method || existing.reference_no !== (referenceNumber || null))) {
      throw new Error('This request key was already used for a different ledger entry')
    }
  }
}
