import type {
  DailyClosingExpenseCreate, DailyClosingExpenseRow, DailyClosingModule, DailyClosingReport
} from '@shared/schemas'
import type { DB } from '../db/db'

type TotalRow = { count: number; gross: number; cash: number; noncash: number; refunds: number; outstanding: number }
type ClosingRow = {
  opening_cash: number; expected_cash: number | null; actual_cash: number | null
  difference: number | null; is_locked: number; closed_at: string | null
}

export class DailyClosingRepository {
  constructor(private readonly db: DB) {}

  report(fromDate: string, toDate = fromDate): DailyClosingReport {
    const sales = this.db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS gross,
        COALESCE((SELECT SUM(amount) FROM payments WHERE sale_id IS NOT NULL AND date(paid_at) BETWEEN ? AND ? AND method = 'CASH'), 0) AS cash,
        COALESCE((SELECT SUM(amount) FROM payments WHERE sale_id IS NOT NULL AND date(paid_at) BETWEEN ? AND ? AND method != 'CASH'), 0) AS noncash,
        COALESCE((SELECT SUM(refund_amount) FROM sale_returns WHERE date(created_at) BETWEEN ? AND ?
          AND refund_method IN ('CASH','BANK','EASYPAISA','JAZZCASH')), 0) AS refunds,
        COALESCE(SUM(MAX(0, total - received_amount
          - COALESCE((SELECT SUM(a.amount) FROM udhaar_sale_allocations a WHERE a.sale_id = sales.id), 0)
          - COALESCE((SELECT SUM(u.amount) FROM udhaar_entries u
            WHERE u.sale_id = sales.id AND u.type = 'REPAYMENT'), 0))), 0) AS outstanding
      FROM sales WHERE date(created_at) BETWEEN ? AND ?
    `).get(fromDate, toDate, fromDate, toDate, fromDate, toDate, fromDate, toDate) as TotalRow

    const admissions = this.db.prepare(`
      SELECT COUNT(*) AS count,
        COALESCE((SELECT SUM(amount - discount_amount) FROM admission_fee_charges WHERE date(created_at) BETWEEN ? AND ?), 0) AS gross,
        COALESCE((SELECT SUM(amount) FROM payments WHERE admission_id IS NOT NULL AND date(paid_at) BETWEEN ? AND ? AND method = 'CASH'), 0) AS cash,
        COALESCE((SELECT SUM(amount) FROM payments WHERE admission_id IS NOT NULL AND date(paid_at) BETWEEN ? AND ? AND method != 'CASH'), 0) AS noncash,
        COALESCE((SELECT SUM(MAX(0, c.amount - c.discount_amount -
          COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.admission_id = c.admission_id), 0)))
          FROM admission_fee_charges c WHERE date(c.created_at) BETWEEN ? AND ?), 0) AS outstanding
      FROM admissions WHERE date(admission_date) BETWEEN ? AND ?
    `).get(fromDate, toDate, fromDate, toDate, fromDate, toDate, fromDate, toDate, fromDate, toDate) as TotalRow

    const schemes = this.db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(MAX(0, application_fee - discount_amount)), 0) AS gross,
        COALESCE((SELECT SUM(p.amount) FROM payments p LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
          WHERE p.scheme_app_id IS NOT NULL AND date(p.paid_at) BETWEEN ? AND ? AND p.method = 'CASH' AND r.id IS NULL), 0) AS cash,
        COALESCE((SELECT SUM(p.amount) FROM payments p LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
          WHERE p.scheme_app_id IS NOT NULL AND date(p.paid_at) BETWEEN ? AND ? AND p.method != 'CASH' AND r.id IS NULL), 0) AS noncash,
        COALESCE(SUM(MAX(0, application_fee - discount_amount -
          COALESCE((SELECT SUM(p.amount) FROM payments p LEFT JOIN scheme_payment_reversals r ON r.payment_id = p.id
            WHERE p.scheme_app_id = scheme_applications.id AND r.id IS NULL), 0))), 0) AS outstanding
      FROM scheme_applications WHERE date(application_date) BETWEEN ? AND ?
    `).get(fromDate, toDate, fromDate, toDate, fromDate, toDate) as TotalRow

    const filer = this.db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(total_fee), 0) AS gross, 0 AS cash, 0 AS noncash,
        COALESCE(SUM(advance_paid), 0) AS unclassified,
        COALESCE(SUM(MAX(0, total_fee - advance_paid)), 0) AS outstanding
      FROM filer_customers WHERE date(filing_date) BETWEEN ? AND ?
    `).get(fromDate, toDate) as TotalRow & { unclassified: number }

    const udhaar = this.db.prepare(`
      SELECT COUNT(*) AS count,
        COALESCE(SUM(CASE WHEN type = 'CHARGE' THEN amount ELSE 0 END), 0) AS gross,
        COALESCE(SUM(CASE WHEN type = 'REPAYMENT' AND method = 'CASH' THEN amount ELSE 0 END), 0) AS cash,
        COALESCE(SUM(CASE WHEN type = 'REPAYMENT' AND method IN ('BANK','EASYPAISA','JAZZCASH') THEN amount ELSE 0 END), 0) AS noncash,
        COALESCE(SUM(CASE WHEN type = 'REPAYMENT' AND method IS NULL THEN amount ELSE 0 END), 0) AS unclassified,
        COALESCE((SELECT SUM(CASE WHEN e.type = 'CHARGE' THEN e.amount ELSE -e.amount END)
          FROM udhaar_entries e WHERE e.customer_id IN
            (SELECT DISTINCT customer_id FROM udhaar_entries WHERE entry_date BETWEEN ? AND ?)), 0) AS outstanding
      FROM udhaar_entries WHERE entry_date BETWEEN ? AND ?
    `).get(fromDate, toDate, fromDate, toDate) as TotalRow & { unclassified: number }

    const stamp = this.stampTotals(fromDate, toDate)
    const modules: DailyClosingModule[] = [
      this.module('sales', 'Normal Sales', sales),
      this.module('stampPaper', 'Stamp Paper', stamp),
      this.module('admissions', 'Admissions', admissions),
      this.module('schemes', 'Schemes', schemes),
      this.module('filerCustomers', 'Filer Customers', filer, filer.unclassified),
      this.module('udhaar', 'Udhaar', udhaar, udhaar.unclassified)
    ]

    const openingRow = this.db.prepare(`
      SELECT opening_cash FROM daily_closings WHERE closing_date = ?
    `).get(fromDate) as { opening_cash: number } | undefined
    const closing = fromDate === toDate ? this.db.prepare(`
      SELECT opening_cash, expected_cash, actual_cash, difference, is_locked, closed_at
      FROM daily_closings WHERE closing_date = ?
    `).get(fromDate) as ClosingRow | undefined : undefined
    const cashIn = this.sum(`SELECT COALESCE(SUM(amount), 0) AS amount FROM cash_entries WHERE entry_date BETWEEN ? AND ? AND type = 'CASH_IN'`, fromDate, toDate)
    const cashOut = this.sum(`SELECT COALESCE(SUM(amount), 0) AS amount FROM cash_entries WHERE entry_date BETWEEN ? AND ? AND type = 'CASH_OUT'`, fromDate, toDate)
    const cashExpenses = this.sum(`SELECT COALESCE(SUM(amount), 0) AS amount FROM expenses WHERE expense_date BETWEEN ? AND ? AND method = 'CASH'`, fromDate, toDate)
    const cashRefunds = this.cashRefunds(fromDate, toDate)
    const openingCash = openingRow?.opening_cash ?? 0
    const cashReceipts = modules.filter((item) => item.key !== 'udhaar')
      .reduce((sum, item) => sum + item.cashReceived, 0)
    const expectedCash = openingCash + cashReceipts + cashIn - cashOut - cashExpenses - cashRefunds

    return {
      fromDate, toDate,
      closing: closing ? {
        openingCash: closing.opening_cash,
        expectedCash: closing.expected_cash,
        actualCash: closing.actual_cash,
        difference: closing.difference,
        isLocked: closing.is_locked === 1,
        closedAt: closing.closed_at
      } : null,
      modules,
      cash: {
        openingCash, cashReceipts, cashIn, cashOut, cashExpenses, cashRefunds, expectedCash,
        actualCash: closing?.actual_cash ?? null,
        difference: closing?.difference ?? null,
        unclassifiedFilerAdvance: filer.unclassified
      }
    }
  }

  expenses(): DailyClosingExpenseRow[] {
    return this.db.prepare(`
      SELECT e.id, e.category, e.amount, e.method, e.expense_date, e.note, u.name AS created_by_name
      FROM expenses e JOIN users u ON u.id = e.created_by
      ORDER BY e.expense_date DESC, e.id DESC
    `).all() as unknown as DailyClosingExpenseRow[]
  }

  save(date: string, openingCash: number): void {
    this.db.prepare(`
      INSERT INTO daily_closings (closing_date, opening_cash)
      VALUES (?, ?)
      ON CONFLICT(closing_date) DO UPDATE SET opening_cash = excluded.opening_cash
      WHERE daily_closings.is_locked = 0
    `).run(date, openingCash)
    this.assertUnlocked(date)
  }

  addExpense(input: DailyClosingExpenseCreate, userId: number): number {
    this.assertUnlocked(input.expenseDate)
    const result = this.db.prepare(`
      INSERT INTO expenses (category, amount, method, expense_date, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.category, input.amount, input.method, input.expenseDate, input.note || null, userId)
    return Number(result.lastInsertRowid)
  }

  close(date: string, openingCash: number, expectedCash: number, actualCash: number, userId: number): void {
    this.db.prepare(`
      INSERT INTO daily_closings (
        closing_date, opening_cash, expected_cash, actual_cash, difference, is_locked, closed_by, closed_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now','localtime'))
      ON CONFLICT(closing_date) DO UPDATE SET opening_cash = excluded.opening_cash,
        expected_cash = excluded.expected_cash, actual_cash = excluded.actual_cash,
        difference = excluded.difference, is_locked = 1, closed_by = excluded.closed_by,
        closed_at = excluded.closed_at
      WHERE daily_closings.is_locked = 0
    `).run(date, openingCash, expectedCash, actualCash, actualCash - expectedCash, userId)
    this.assertLocked(date)
  }

  unlock(date: string): void {
    const result = this.db.prepare(`
      UPDATE daily_closings SET is_locked = 0, closed_by = NULL, closed_at = NULL
      WHERE closing_date = ? AND is_locked = 1
    `).run(date)
    if (!result.changes) throw new Error('This date is not locked')
  }

  private stampTotals(fromDate: string, toDate: string): TotalRow {
    const legacy = this.db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(total_payable_paisa), 0) / 100.0 AS gross,
        COALESCE((SELECT SUM(amount_paisa) / 100.0 FROM stamp_paper_payments
          WHERE date(paid_at) BETWEEN ? AND ? AND method = 'CASH'), 0) AS cash,
        COALESCE((SELECT SUM(amount_paisa) / 100.0 FROM stamp_paper_payments
          WHERE date(paid_at) BETWEEN ? AND ? AND method != 'CASH'), 0) AS noncash,
        COALESCE(SUM(MAX(0, total_payable_paisa -
          COALESCE((SELECT SUM(p.amount_paisa) FROM stamp_paper_payments p WHERE p.sale_id = stamp_paper_sales.id), 0)
          + COALESCE((SELECT SUM(r.amount_paisa) FROM stamp_paper_refunds r WHERE r.sale_id = stamp_paper_sales.id), 0))), 0) / 100.0 AS outstanding
      FROM stamp_paper_sales WHERE date(transaction_date) BETWEEN ? AND ? AND status = 'COMPLETED'
    `).get(fromDate, toDate, fromDate, toDate, fromDate, toDate) as TotalRow
    const simpleSales = this.db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(total_payable_paisa), 0) / 100.0 AS gross,
        COALESCE((SELECT SUM(p.amount_paisa) / 100.0 FROM stamp_transaction_payments p
          WHERE date(p.paid_at) BETWEEN ? AND ? AND p.method = 'CASH'), 0) AS cash,
        COALESCE((SELECT SUM(p.amount_paisa) / 100.0 FROM stamp_transaction_payments p
          WHERE date(p.paid_at) BETWEEN ? AND ? AND p.method != 'CASH'), 0) AS noncash,
        COALESCE(SUM(MAX(0, total_payable_paisa -
          COALESCE((SELECT SUM(p.amount_paisa) FROM stamp_transaction_payments p WHERE p.stamp_id = stamp_paper_transactions.id), 0))), 0) / 100.0 AS outstanding
      FROM stamp_paper_transactions WHERE date(created_at) BETWEEN ? AND ? AND status != 'CANCELLED'
    `).get(fromDate, toDate, fromDate, toDate, fromDate, toDate) as TotalRow
    const legacyRefunds = this.sum(`
      SELECT COALESCE(SUM(amount_paisa), 0) / 100.0 AS amount FROM stamp_paper_refunds
      WHERE date(created_at) BETWEEN ? AND ? AND method IN ('CASH','BANK','EASYPAISA','JAZZCASH')
    `, fromDate, toDate)
    return {
      count: legacy.count + simpleSales.count,
      gross: legacy.gross + simpleSales.gross,
      cash: legacy.cash + simpleSales.cash,
      noncash: legacy.noncash + simpleSales.noncash,
      refunds: legacyRefunds,
      outstanding: legacy.outstanding + simpleSales.outstanding
    }
  }

  private cashRefunds(fromDate: string, toDate: string): number {
    const salesRefunds = this.sum(`
      SELECT COALESCE(SUM(refund_amount), 0) AS amount FROM sale_returns
      WHERE date(created_at) BETWEEN ? AND ? AND refund_method = 'CASH'
    `, fromDate, toDate)
    const stampRefunds = this.sum(`
      SELECT COALESCE(SUM(amount_paisa), 0) / 100.0 AS amount FROM stamp_paper_refunds
      WHERE date(created_at) BETWEEN ? AND ? AND method = 'CASH'
    `, fromDate, toDate)
    return salesRefunds + stampRefunds
  }

  private sum(sql: string, fromDate: string, toDate: string): number {
    const row = this.db.prepare(sql).get(fromDate, toDate) as { amount: number }
    return row.amount
  }

  private module(
    key: DailyClosingModule['key'], label: string, row: TotalRow, unclassifiedReceived = 0
  ): DailyClosingModule {
    return {
      key, label, transactionCount: row.count, grossAmount: row.gross,
      cashReceived: row.cash, nonCashReceived: row.noncash, unclassifiedReceived,
      refunds: row.refunds, outstanding: row.outstanding
    }
  }

  private assertUnlocked(date: string): void {
    const row = this.db.prepare('SELECT is_locked FROM daily_closings WHERE closing_date = ?').get(date) as { is_locked: number } | undefined
    if (row?.is_locked) throw new Error('This date is locked. An Admin must unlock it before changes can be saved.')
  }

  private assertLocked(date: string): void {
    const row = this.db.prepare('SELECT is_locked FROM daily_closings WHERE closing_date = ?').get(date) as { is_locked: number } | undefined
    if (!row?.is_locked) throw new Error('Daily closing could not be locked')
  }
}
