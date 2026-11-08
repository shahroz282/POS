import { DailyClosingRepository } from '../repositories/daily-closing.repository'
import type { DB } from '../db/db'

export class DailyClosingService {
  private readonly repository: DailyClosingRepository

  constructor(private readonly db: DB) {
    this.repository = new DailyClosingRepository(db)
  }

  report(fromDate: string, toDate = fromDate) {
    return this.repository.report(fromDate, toDate)
  }

  save(date: string, openingCash: number, userId: number): void {
    this.db.transaction(() => {
      this.repository.save(date, openingCash)
      this.db.prepare(`
        INSERT INTO audit_logs (user_id, action, entity, details)
        VALUES (?, 'DAILY_CLOSING_SAVED', 'daily_closings', ?)
      `).run(userId, `Date ${date}; opening cash ${openingCash}`)
    })()
  }

  close(date: string, openingCash: number, actualCash: number, userId: number): void {
    this.db.transaction(() => {
      this.repository.save(date, openingCash)
      const expectedCash = this.repository.report(date).cash.expectedCash
      this.repository.close(date, openingCash, expectedCash, actualCash, userId)
      this.db.prepare(`
        INSERT INTO audit_logs (user_id, action, entity, details)
        VALUES (?, 'DAILY_CLOSING_LOCKED', 'daily_closings', ?)
      `).run(userId, `Date ${date}; expected ${expectedCash}; actual ${actualCash}`)
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
}
