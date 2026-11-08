import type { ReportsReport } from '@shared/schemas'
import { DailyClosingRepository } from './daily-closing.repository'
import type { DB } from '../db/db'

export class ReportsRepository {
  private readonly dailyClosing: DailyClosingRepository

  constructor(private readonly db: DB) {
    this.dailyClosing = new DailyClosingRepository(db)
  }

  report(fromDate: string, toDate: string, role: ReportsReport['role']): ReportsReport {
    const sales = this.db.prepare(`
      SELECT COUNT(*) AS count,
        COALESCE(SUM(total), 0) AS gross,
        COALESCE(SUM(discount), 0) AS discount,
        COALESCE((SELECT SUM(p.amount) FROM payments p
          WHERE p.sale_id IS NOT NULL AND date(p.paid_at) BETWEEN ? AND ? AND p.method = 'CASH'), 0) AS cash,
        COALESCE((SELECT SUM(p.amount) FROM payments p
          WHERE p.sale_id IS NOT NULL AND date(p.paid_at) BETWEEN ? AND ? AND p.method != 'CASH'), 0) AS noncash,
        COALESCE((SELECT SUM(r.refund_amount) FROM sale_returns r
          WHERE date(r.created_at) BETWEEN ? AND ?), 0) AS refunds,
        COALESCE(SUM(MAX(0, total - received_amount
          - COALESCE((SELECT SUM(a.amount) FROM udhaar_sale_allocations a WHERE a.sale_id = sales.id), 0)
          - COALESCE((SELECT SUM(u.amount) FROM udhaar_entries u
            WHERE u.sale_id = sales.id AND u.type = 'REPAYMENT'), 0))), 0) AS outstanding,
        COALESCE(SUM((SELECT SUM((si.quantity -
          COALESCE((SELECT SUM(ri.quantity) FROM sale_return_items ri WHERE ri.sale_item_id = si.id), 0))
          * si.unit_cost) FROM sale_items si WHERE si.sale_id = sales.id)), 0) AS cost
      FROM sales WHERE date(created_at) BETWEEN ? AND ?
    `).get(fromDate, toDate, fromDate, toDate, fromDate, toDate, fromDate, toDate) as {
      count: number; gross: number; discount: number; cash: number; noncash: number
      refunds: number; outstanding: number; cost: number
    }

    const salesModule = {
      key: 'sales' as const, label: 'Normal Sales', transactionCount: sales.count,
      grossAmount: sales.gross, cashReceived: sales.cash, nonCashReceived: sales.noncash,
      refunds: sales.refunds, outstanding: sales.outstanding
    }

    if (role === 'CASHIER') {
      return {
        fromDate, toDate, role, modules: [salesModule], salesProfit: null, inventory: null, cash: null
      }
    }

    const base = this.dailyClosing.report(fromDate, toDate)
    const modules: ReportsReport['modules'] = base.modules.map((module) => ({
      ...module,
      key: module.key as ReportsReport['modules'][number]['key']
    }))
    modules[0] = salesModule
    modules.push({
      key: 'inventory',
      label: 'Inventory',
      transactionCount: 0,
      grossAmount: 0,
      cashReceived: 0,
      nonCashReceived: 0,
      refunds: 0,
      outstanding: 0,
      note: 'Current stock and date-range purchasing / movement activity.'
    })
    modules.push({
      key: 'cash',
      label: 'Cash & Expenses',
      transactionCount: 0,
      grossAmount: 0,
      cashReceived: 0,
      nonCashReceived: 0,
      refunds: 0,
      outstanding: 0,
      note: 'Cash in/out and cash-paid expenses for this period.'
    })

    const stock = this.db.prepare(`
      SELECT COUNT(*) AS product_count,
        COALESCE(SUM(CASE WHEN stock_qty <= low_stock_level THEN 1 ELSE 0 END), 0) AS low_stock_count,
        COALESCE(SUM(stock_qty), 0) AS stock_quantity,
        COALESCE(SUM(stock_qty * purchase_price), 0) AS stock_value
      FROM products WHERE is_active = 1
    `).get() as { product_count: number; low_stock_count: number; stock_quantity: number; stock_value: number }
    const purchases = this.db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
      FROM purchases WHERE purchase_date BETWEEN ? AND ?
    `).get(fromDate, toDate) as { count: number; total: number }
    const movements = this.db.prepare(`
      SELECT type, COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity
      FROM stock_movements WHERE date(created_at) BETWEEN ? AND ?
      GROUP BY type ORDER BY type
    `).all(fromDate, toDate) as Array<{ type: string; count: number; quantity: number }>
    const unclassifiedFiler = base.cash.unclassifiedFilerAdvance
    const cashIn = this.sum('SELECT COALESCE(SUM(amount), 0) AS amount FROM cash_entries WHERE entry_date BETWEEN ? AND ? AND type = ?', fromDate, toDate, 'CASH_IN')
    const cashOut = this.sum('SELECT COALESCE(SUM(amount), 0) AS amount FROM cash_entries WHERE entry_date BETWEEN ? AND ? AND type = ?', fromDate, toDate, 'CASH_OUT')
    const cashExpenses = this.sum('SELECT COALESCE(SUM(amount), 0) AS amount FROM expenses WHERE expense_date BETWEEN ? AND ? AND method = ?', fromDate, toDate, 'CASH')
    const cashTransactions = this.db.prepare(`
      SELECT (SELECT COUNT(*) FROM cash_entries WHERE entry_date BETWEEN ? AND ?) +
        (SELECT COUNT(*) FROM expenses WHERE expense_date BETWEEN ? AND ? AND method = 'CASH') AS count
    `).get(fromDate, toDate, fromDate, toDate) as { count: number }

    const inventoryModule = modules.find((module) => module.key === 'inventory')!
    inventoryModule.transactionCount = purchases.count
    inventoryModule.grossAmount = purchases.total
    inventoryModule.note = `${stock.product_count} active products; ${stock.low_stock_count} low stock. Purchase payment method is not tracked, so purchases are not added to cash collections.`
    const cashModule = modules.find((module) => module.key === 'cash')!
    cashModule.transactionCount = cashTransactions.count
    cashModule.cashReceived = cashIn
    cashModule.grossAmount = cashOut + cashExpenses
    cashModule.refunds = base.cash.cashRefunds

    return {
      fromDate, toDate, role, modules,
      salesProfit: sales.gross - sales.refunds - sales.cost,
      inventory: {
        productCount: stock.product_count,
        lowStockCount: stock.low_stock_count,
        stockQuantity: stock.stock_quantity,
        stockValue: stock.stock_value,
        purchaseCount: purchases.count,
        purchaseTotal: purchases.total,
        movements
      },
      cash: { cashIn, cashOut, cashExpenses }
    }
  }

  private sum(sql: string, fromDate: string, toDate: string, type: string): number {
    return (this.db.prepare(sql).get(fromDate, toDate, type) as { amount: number }).amount
  }
}
