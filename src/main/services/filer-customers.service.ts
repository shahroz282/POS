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
      const id = this.repository.create(input, userId)
      this.audit.insert(userId, 'FILER_CUSTOMER_CREATED', 'filer_customers', id, 'Created filing record')
      return id
    })()
  }

  update(input: FilerCustomerUpdate, userId: number): void {
    this.db.transaction(() => {
      this.repository.update(input)
      this.audit.insert(userId, 'FILER_CUSTOMER_UPDATED', 'filer_customers', input.customerId,
        `Updated filing record; advance paid ${input.advancePaid}`)
    })()
  }

  ensureExists(customerId: number): void {
    if (!this.repository.exists(customerId)) throw new Error('Filer customer not found')
  }
}
