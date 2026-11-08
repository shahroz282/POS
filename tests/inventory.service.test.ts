import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DB } from '../src/main/db/db'
import { runMigrations } from '../src/main/db/migrate'
import {
  InventoryAdjustmentCreateSchema, InventoryProductCreateSchema, InventoryProductUpdateSchema,
  InventoryPurchaseCreateSchema, SaleCreateSchema, SaleReturnCreateSchema, UdhaarRepaymentCreateSchema
} from '../src/shared/schemas'
import { InventoryService } from '../src/main/services/inventory.service'
import { UdhaarService } from '../src/main/services/udhaar.service'

function localDate(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function wrapDatabase(raw: BetterSqlite3.Database): DB {
  return {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => {
      const statement = raw.prepare(sql)
      return {
        get: (...params) => statement.get(...params) as Record<string, unknown> | undefined,
        all: (...params) => statement.all(...params) as Record<string, unknown>[],
        run: (...params) => {
          const result = statement.run(...params)
          return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        }
      }
    },
    pragma: (clause) => { raw.pragma(clause) },
    transaction: (operation) => raw.transaction(operation) as () => ReturnType<typeof operation>,
    close: () => raw.close()
  }
}

describe('InventoryService', () => {
  let raw: BetterSqlite3.Database
  let db: DB
  let service: InventoryService
  let userId: number
  let productId: number
  let customerId: number

  beforeEach(() => {
    process.env.MIGRATIONS_DIR = `${process.cwd()}\\migrations`
    raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    db = wrapDatabase(raw)
    runMigrations(db)
    userId = Number(raw.prepare(
      "INSERT INTO users (name, username, password_hash, role) VALUES ('Admin', 'admin', 'hash', 'ADMIN')"
    ).run().lastInsertRowid)
    service = new InventoryService(db)
    productId = service.createProduct(InventoryProductCreateSchema.parse({
      name: 'A4 Paper', purchasePrice: 70, salePrice: 100, lowStockLevel: 2
    }), userId)
    customerId = Number(raw.prepare(
      "INSERT INTO customers (name, phone) VALUES ('Ali Customer', '03001234567')"
    ).run().lastInsertRowid)
  })

  afterEach(() => db.close())

  it('records purchases and adjustments as atomic, traceable stock changes', () => {
    const purchase = InventoryPurchaseCreateSchema.parse({
      idempotencyKey: '8a480122-8f06-4a2d-b0dd-a585b4ccfbad',
      purchaseDate: localDate(), items: [{ productId, quantity: 10, unitCost: 75 }], note: 'Opening stock'
    })
    const created = service.createPurchase(purchase, userId)
    expect(created.purchaseNo).toMatch(/^PUR-/)
    expect(service.createPurchase(purchase, userId)).toEqual(created)
    expect(service.products('', true, true)[0]).toMatchObject({
      stock_qty: 10, purchase_price: 75, sale_price: 100
    })

    service.adjustStock(InventoryAdjustmentCreateSchema.parse({
      productId, quantity: -2, reason: 'Damaged sheets', adjustmentDate: localDate()
    }), userId)
    expect(service.products('', true, true)[0].stock_qty).toBe(8)
    expect(service.movements().map((movement) => movement.type)).toEqual(['ADJUSTMENT', 'PURCHASE'])
    expect(() => service.adjustStock(InventoryAdjustmentCreateSchema.parse({
      productId, quantity: -9, reason: 'Count correction', adjustmentDate: localDate()
    }), userId)).toThrow('insufficient stock')
    expect(service.products('', true, true)[0].stock_qty).toBe(8)
  })

  it('requires product names to be unique without case or surrounding-space differences', () => {
    expect(() => service.createProduct(InventoryProductCreateSchema.parse({
      name: '  a4 paper ', purchasePrice: 70, salePrice: 100, lowStockLevel: 0
    }), userId)).toThrow('A product with this name already exists')
    const secondProduct = service.createProduct(InventoryProductCreateSchema.parse({
      name: 'Photo Glossy', purchasePrice: 200, salePrice: 300, lowStockLevel: 0
    }), userId)
    expect(() => service.updateProduct(InventoryProductUpdateSchema.parse({
      id: secondProduct, name: 'A4 PAPER', purchasePrice: 200, salePrice: 300, lowStockLevel: 0
    }), userId)).toThrow('A product with this name already exists')
    expect(service.products('', true, true)).toHaveLength(2)
    expect(() => db.prepare(`
      INSERT INTO products (name) VALUES (' a4 paper ')
    `).run()).toThrow('A product with this name already exists')
  })

  it('saves a sale, payment, stock movement, and customer credit together and idempotently', () => {
    service.createPurchase(InventoryPurchaseCreateSchema.parse({
      idempotencyKey: 'f4f4aa0d-7781-4242-ae09-530e20b272ad',
      purchaseDate: localDate(), items: [{ productId, quantity: 5, unitCost: 70 }]
    }), userId)
    const input = SaleCreateSchema.parse({
      idempotencyKey: 'c1b67c7c-6174-4420-9456-c5e38eec25db',
      customerId, discount: 50, receivedAmount: 200, paymentMethod: 'CASH',
      items: [{ productId, quantity: 3 }]
    })
    const sale = service.createSale(input, userId, 'MANAGER')
    expect(sale).toMatchObject({ subtotal: 300, discount: 50, total: 250, received_amount: 200, balance: 50, status: 'PARTIAL' })
    expect(service.createSale(input, userId, 'CASHIER').id).toBe(sale.id)
    expect(service.products('', true, false)[0].stock_qty).toBe(2)
    expect(db.prepare('SELECT amount, sale_id FROM payments WHERE sale_id = ?').get(sale.id)).toEqual({
      amount: 200, sale_id: sale.id
    })
    expect(db.prepare("SELECT amount FROM udhaar_entries WHERE sale_id = ? AND type = 'CHARGE'").get(sale.id)).toEqual({
      amount: 50
    })
    expect(service.saleDetail(sale.id).items[0]).toMatchObject({ quantity: 3, unit_price: 100, line_total: 300 })
    const udhaar = new UdhaarService(db)
    udhaar.createRepayment(UdhaarRepaymentCreateSchema.parse({
      customerId, idempotencyKey: 'b6f801d4-011b-4bfc-a773-6f8db4d6799e',
      amount: 50, method: 'CASH', entryDate: localDate()
    }), userId)
    expect(service.saleDetail(sale.id).balance).toBe(0)
  })

  it('rejects overselling and closed-day changes without partial writes', () => {
    const input = SaleCreateSchema.parse({
      idempotencyKey: 'af02ef33-ae7e-41a1-8d8a-1593dbab491a',
      discount: 0, receivedAmount: 200, paymentMethod: 'CASH',
      items: [{ productId, quantity: 2 }]
    })
    expect(() => service.createSale(input, userId, 'ADMIN')).toThrow('Insufficient stock')
    expect(db.prepare('SELECT COUNT(*) AS count FROM sales').get()).toEqual({ count: 0 })

    db.prepare('INSERT INTO daily_closings (closing_date, opening_cash, is_locked) VALUES (?, 0, 1)')
      .run(localDate())
    const productCount = Number(db.prepare('SELECT COUNT(*) AS count FROM stock_movements').get()?.count)
    expect(() => service.adjustStock(InventoryAdjustmentCreateSchema.parse({
      productId, quantity: 1, reason: 'Count correction', adjustmentDate: localDate()
    }), userId)).toThrow('date is closed')
    expect(Number(db.prepare('SELECT COUNT(*) AS count FROM stock_movements').get()?.count)).toBe(productCount)
  })

  it('enforces cashier discount limits and requires a customer for credit', () => {
    service.createPurchase(InventoryPurchaseCreateSchema.parse({
      idempotencyKey: '7237affc-8290-4b84-9d8c-d0702ab209de',
      purchaseDate: localDate(), items: [{ productId, quantity: 3, unitCost: 70 }]
    }), userId)
    const overDiscount = SaleCreateSchema.parse({
      idempotencyKey: '14bd9f27-006d-47f4-99f5-b461d6d3c8e8',
      discount: 6, receivedAmount: 94, paymentMethod: 'CASH',
      items: [{ productId, quantity: 1 }]
    })
    expect(() => service.createSale(overDiscount, userId, 'CASHIER')).toThrow('cannot exceed 5%')
    const creditWithoutCustomer = SaleCreateSchema.parse({
      idempotencyKey: '76933239-89ca-473e-8a33-5781ec8c8555',
      discount: 0, receivedAmount: 50, paymentMethod: 'CASH',
      items: [{ productId, quantity: 1 }]
    })
    expect(() => service.createSale(creditWithoutCustomer, userId, 'ADMIN')).toThrow('Select a customer')
  })

  it('returns sold items to stock and applies outstanding sale credit before issuing refunds', () => {
    service.createPurchase(InventoryPurchaseCreateSchema.parse({
      idempotencyKey: '7237affc-8290-4b84-9d8c-d0702ab209de',
      purchaseDate: localDate(), items: [{ productId, quantity: 3, unitCost: 70 }]
    }), userId)
    const sale = service.createSale(SaleCreateSchema.parse({
      idempotencyKey: 'efb62c89-5972-4c69-8d15-f3573456269a',
      customerId, discount: 0, receivedAmount: 100, paymentMethod: 'CASH',
      items: [{ productId, quantity: 2 }]
    }), userId, 'ADMIN')
    const saleItemId = sale.items[0].id
    const firstReturn = SaleReturnCreateSchema.parse({
      saleId: sale.id, idempotencyKey: '61fd2bc5-a8ae-479c-90ab-8ed08b21e417',
      refundMethod: 'CASH', reason: 'One item damaged', items: [{ saleItemId, quantity: 1 }]
    })
    expect(service.createSaleReturn(firstReturn, userId, 'MANAGER')).toMatchObject({
      returnAmount: 100, creditAdjusted: 100, refundAmount: 0, fullyReturned: false
    })
    expect(service.createSaleReturn(firstReturn, userId, 'MANAGER').returnAmount).toBe(100)
    expect(service.products('', true, true)[0].stock_qty).toBe(2)
    expect(service.saleDetail(sale.id).balance).toBe(0)

    const finalReturn = SaleReturnCreateSchema.parse({
      saleId: sale.id, idempotencyKey: 'b98f22a9-6c8c-4366-a7cb-c0ffebc16650',
      refundMethod: 'CASH', reason: 'Return remaining item', items: [{ saleItemId, quantity: 1 }]
    })
    expect(service.createSaleReturn(finalReturn, userId, 'MANAGER')).toMatchObject({
      returnAmount: 100, creditAdjusted: 0, refundAmount: 100, fullyReturned: true
    })
    expect(service.saleDetail(sale.id).status).toBe('RETURNED')
    expect(service.products('', true, true)[0].stock_qty).toBe(3)
    expect(service.movements().filter((movement) => movement.type === 'RETURN')).toHaveLength(2)
  })

  it('can refund a credit sale after the customer repaid it through their ledger', () => {
    service.createPurchase(InventoryPurchaseCreateSchema.parse({
      idempotencyKey: '7237affc-8290-4b84-9d8c-d0702ab209de',
      purchaseDate: localDate(), items: [{ productId, quantity: 1, unitCost: 70 }]
    }), userId)
    const sale = service.createSale(SaleCreateSchema.parse({
      idempotencyKey: '420b7447-692d-492e-bc7a-fb6e14a36d86',
      customerId, discount: 0, receivedAmount: 0, paymentMethod: 'CASH',
      items: [{ productId, quantity: 1 }]
    }), userId, 'ADMIN')
    new UdhaarService(db).createRepayment(UdhaarRepaymentCreateSchema.parse({
      customerId, idempotencyKey: '217133c0-6253-4f37-8395-1c14616fe30c',
      amount: 100, method: 'CASH', entryDate: localDate()
    }), userId)

    const result = service.createSaleReturn(SaleReturnCreateSchema.parse({
      saleId: sale.id, idempotencyKey: '288b756b-2f65-4904-9f35-6a7928d42acf',
      refundMethod: 'CASH', reason: 'Item returned', items: [{ saleItemId: sale.items[0].id, quantity: 1 }]
    }), userId, 'ADMIN')
    expect(result).toMatchObject({ returnAmount: 100, creditAdjusted: 0, refundAmount: 100, fullyReturned: true })
  })
})
