import type { PhotocopyCreate, PhotocopyRefund, PhotocopySearch } from '@shared/schemas'
import type { DB } from '../db/db'
import { AuditLogRepository } from '../repositories/audit-log.repository'
import { PhotocopyRepository } from '../repositories/photocopy.repository'
import { getCurrentUser } from './session'

export class PhotocopyService {
  private readonly repository: PhotocopyRepository
  private readonly audit: AuditLogRepository

  constructor(private readonly db: DB) {
    this.repository = new PhotocopyRepository(db)
    this.audit = new AuditLogRepository(db)
  }

  list(search: PhotocopySearch) {
    return this.repository.list(search)
  }

  create(input: PhotocopyCreate) {
    const user = getCurrentUser()
    if (!user) throw new Error('Not logged in')
    const total = input.pageCount * input.copyCount * input.unitPrice
    if (!Number.isSafeInteger(total) || total < 0 || total > 100_000_000) {
      throw new Error('Photocopy total exceeds the allowed amount')
    }
    return this.db.transaction(() => {
      const existing = this.repository.findByKey(input.idempotencyKey)
      if (existing) return existing
      const date = new Date()
      const isoDate = input.entryDate || `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      this.ensureDayOpen(isoDate)
      const receiptNumber = this.repository.nextReceipt(isoDate.replace(/-/g, ''))
      const id = this.repository.create(input, receiptNumber, user.id, total)
      this.audit.insert(user.id, 'PHOTOCOPY_SALE_CREATED', 'photocopy_sales', id,
        `${receiptNumber}; ${input.serviceType}; ${input.pageCount} pages x ${input.copyCount} copies; total ${total}`)
      return this.repository.get(id)!
    })()
  }

  refund(input: PhotocopyRefund) {
    const user = getCurrentUser()
    if (!user) throw new Error('Not logged in')
    if (user.role === 'CASHIER') throw new Error('Admin or Manager permission is required to refund photocopy sales')
    const alreadyRefunded = this.repository.findRefundByKey(input.idempotencyKey)
    if (alreadyRefunded) return this.repository.get(alreadyRefunded)!
    return this.db.transaction(() => {
      const sale = this.repository.get(input.saleId)
      if (!sale || sale.status === 'CANCELLED') throw new Error('Active photocopy sale not found')
      const current = new Date()
      const today = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`
      this.ensureDayOpen(today)
      this.repository.refund(sale.id, input.idempotencyKey, input.method, input.reason, user.id, sale.amount_received)
      this.audit.insert(user.id, 'PHOTOCOPY_SALE_REFUNDED', 'photocopy_sales', sale.id,
        `${sale.receipt_number}; refund ${sale.amount_received}; method ${input.method}; ${input.reason}`)
      return this.repository.get(sale.id)!
    })()
  }

  private ensureDayOpen(date: string): void {
    if (this.db.prepare('SELECT id FROM daily_closings WHERE closing_date = ? AND is_locked = 1').get(date)) {
      throw new Error('This date is locked. An Admin must unlock the day before recording this transaction.')
    }
  }
}
