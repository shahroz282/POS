import type { ReportsReport } from '@shared/schemas'
import { ReportsRepository } from '../repositories/reports.repository'
import type { DB } from '../db/db'

export class ReportsService {
  private readonly repository: ReportsRepository

  constructor(db: DB) {
    this.repository = new ReportsRepository(db)
  }

  report(fromDate: string, toDate: string, role: ReportsReport['role']): ReportsReport {
    return this.repository.report(fromDate, toDate, role)
  }
}
