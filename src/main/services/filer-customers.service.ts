import type { FilerCustomerCreate, FilerCustomerSearchSchema, FilerCustomerUpdate } from '@shared/schemas'
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
      this.repository.update(input)
      this.audit.insert(userId, 'FILER_CUSTOMER_UPDATED', 'filer_customers', input.customerId,
        `Updated filing record; advance paid ${input.advancePaid}`)
    })()
  }

  ensureExists(customerId: number): void {
    if (!this.repository.exists(customerId)) throw new Error('Filer customer not found')
  }

  private ensureDayOpen(date: string): void {
    if (this.db.prepare('SELECT id FROM daily_closings WHERE closing_date = ? AND is_locked = 1').get(date)) {
      throw new Error('This date is closed. An Admin must unlock the day before recording this transaction.')
    }
  }
}
