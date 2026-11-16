import type { CashEntryCreate, DailyClosingExpenseCreate } from '@shared/schemas'
import { DailyClosingRepository } from '../repositories/daily-closing.repository'
import { AuditLogRepository } from '../repositories/audit-log.repository'
import type { DB } from '../db/db'

export class DailyClosingService {
  private readonly repository: DailyClosingRepository
  private readonly audit: AuditLogRepository

  constructor(private readonly db: DB) {
    this.repository = new DailyClosingRepository(db)
    this.audit = new AuditLogRepository(db)
  }

  report(fromDate: string, toDate = fromDate) {
    return this.repository.report(fromDate, toDate)
  }

  expenses() {
    return this.repository.expenses()
  }

  save(date: string, openingCash: number, userId: number, openingReason = ''): void {
    this.db.transaction(() => {
      this.repository.save(date, openingCash)
      this.db.prepare(`
        INSERT INTO audit_logs (user_id, action, entity, details)
        VALUES (?, 'DAILY_CLOSING_SAVED', 'daily_closings', ?)
      `).run(userId, `Date ${date}; opening cash ${openingCash}${openingReason ? `; reason: ${openingReason}` : ''}`)
    })()
  }

  addCashEntry(input: CashEntryCreate, userId: number): number {
    return this.db.transaction(() => {
      this.ensureDayOpen(input.entryDate)
      const id = this.repository.addCashEntry(input, userId)
      this.audit.insert(userId, input.type, 'cash_entries', id,
        `${input.department}; amount ${input.amount}; date ${input.entryDate}; ${input.reason}${input.reference ? `; reference ${input.reference}` : ''}`)
      return id
    })()
  }

  addExpense(input: DailyClosingExpenseCreate, userId: number): number {
    return this.db.transaction(() => {
      const id = this.repository.addExpense(input, userId)
      this.audit.insert(userId, 'EXPENSE_CREATED', 'expenses', id,
        `${input.category}; amount ${input.amount}; method ${input.method}; date ${input.expenseDate}`)
      return id
    })()
  }

  close(date: string, openingCash: number, actualCash: number, userId: number, openingReason = ''): void {
    this.db.transaction(() => {
      this.repository.save(date, openingCash)
      const expectedCash = this.repository.report(date).cash.expectedCash
      this.repository.close(date, openingCash, expectedCash, actualCash, userId)
      this.db.prepare(`
        INSERT INTO audit_logs (user_id, action, entity, details)
        VALUES (?, 'DAILY_CLOSING_LOCKED', 'daily_closings', ?)
      `).run(userId, `Date ${date}; opening ${openingCash}; expected ${expectedCash}; actual ${actualCash}${openingReason ? `; opening reason: ${openingReason}` : ''}`)
    })()
  }

  unlock(date: string, userId: number): void {
    this.db.transaction(() => {
      this.repository.unlock(date)
      this.db.prepare(`
        INSERT INTO audit_logs (user_id, action, entity, details)
        VALUES (?, 'DAILY_CLOSING_UNLOCKED', 'daily_closings', ?)
      `).run(userId, `Date ${date}`)
    })()
  }

  private ensureDayOpen(date: string): void {
    if (this.db.prepare('SELECT id FROM daily_closings WHERE closing_date = ? AND is_locked = 1').get(date)) {
      throw new Error('This date is locked. An Admin must unlock it before recording this transaction.')
    }
  }
}
