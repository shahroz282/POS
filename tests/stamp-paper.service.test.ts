import BetterSqlite3 from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DB } from '../src/main/db/db'
import { runMigrations } from '../src/main/db/migrate'
import { StampPaperService } from '../src/main/services/stamp-paper.service'
import { setCurrentUser } from '../src/main/services/session'
import { SimpleStampSaleCreateSchema } from '../src/shared/schemas'

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

describe('StampPaperService', () => {
  let raw: BetterSqlite3.Database
  let db: DB
  let root: string
  let service: StampPaperService
  let userId: number

  beforeEach(() => {
    process.env.MIGRATIONS_DIR = path.join(process.cwd(), 'migrations')
    raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    db = wrapDatabase(raw)
    runMigrations(db)
    userId = Number(raw.prepare("INSERT INTO users (name, username, password_hash, role) VALUES ('Admin', 'admin', 'hash', 'ADMIN')").run().lastInsertRowid)
    setCurrentUser({ id: userId, name: 'Admin', username: 'admin', role: 'ADMIN' })
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'saqib-stamp-test-'))
    service = new StampPaperService(db, root)
  })

  afterEach(() => {
    setCurrentUser(null)
    db.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('creates a two-party sale, records partial payment and prevents serial reuse', () => {
    const inventoryId = service.addInventory({
      itemType: 'Non-judicial',
      denominationPaisa: 500_000,
      serialNumber: 'TEST-001',
      purchaseCostPaisa: 450_000,
      salePricePaisa: 500_000
    }, userId)
    const input = {
      transactionId: 'aa55f269-e1ae-4d38-a250-a20db52a0e44',
      idempotencyKey: 'bb55f269-e1ae-4d38-a250-a20db52a0e44',
      inventoryId,
      firstParty: { fullName: 'First Party', cnicNumber: '1234512345671' },
      secondParty: { fullName: 'Second Party' },
      documentPurpose: 'Agreement',
      serviceChargesPaisa: 10_000,
      otherFeesPaisa: 0,
      amountReceivedPaisa: 200_000,
      paymentMethod: 'CASH' as const,
      stagedDocumentTokens: []
    }

    const sale = service.createSale(input)
    expect(sale.invoice_number).toMatch(/^STP-\d{8}-0001$/)
    expect(sale.total_payable_paisa).toBe(510_000)
    expect(sale.outstanding_balance_paisa).toBe(310_000)
    expect(service.listSales('', undefined, undefined, 'ADMIN')).toHaveLength(1)
    expect(service.getSaleDetail(sale.id, 'ADMIN').payments).toHaveLength(1)
    expect(db.prepare('SELECT status FROM stamp_paper_inventory WHERE id = ?').get(inventoryId)).toMatchObject({ status: 'SOLD' })
    expect(db.prepare('SELECT COUNT(*) AS count FROM stamp_paper_sale_parties WHERE sale_id = ?').get(sale.id)).toMatchObject({ count: 2 })

    const retry = service.createSale(input)
    expect(retry.id).toBe(sale.id)
    expect(() => service.addInventory({
      itemType: 'Non-judicial', denominationPaisa: 500_000, serialNumber: 'TEST-001',
      purchaseCostPaisa: 450_000, salePricePaisa: 500_000
    }, userId)).toThrow()

    expect(() => service.cancelSale(sale.id, 'Customer requested cancellation')).toThrow('Select a refund method')
    service.cancelSale(sale.id, 'Customer requested cancellation', 'CASH')
    expect(db.prepare('SELECT status FROM stamp_paper_sales WHERE id = ?').get(sale.id)).toMatchObject({ status: 'CANCELLED' })
    expect(db.prepare('SELECT amount_paisa, method FROM stamp_paper_refunds WHERE sale_id = ?').get(sale.id)).toMatchObject({ amount_paisa: 200_000, method: 'CASH' })
    expect(db.prepare('SELECT status FROM stamp_paper_inventory WHERE id = ?').get(inventoryId)).toMatchObject({ status: 'AVAILABLE' })
    const detailAfterRefund = service.getSaleDetail(sale.id, 'ADMIN')
    expect(detailAfterRefund.amount_received_paisa).toBe(0)
    expect(detailAfterRefund.refunds).toHaveLength(1)
    expect(service.listSales('', new Date().toISOString().slice(0, 10), undefined, 'ADMIN')).toHaveLength(1)
  })

  it('rejects overpayment and rolls back sale and inventory changes', () => {
    const inventoryId = service.addInventory({
      itemType: 'Judicial', denominationPaisa: 100_000, serialNumber: 'TEST-002',
      purchaseCostPaisa: 90_000, salePricePaisa: 100_000
    }, userId)
    expect(() => service.createSale({
      transactionId: 'cc55f269-e1ae-4d38-a250-a20db52a0e44',
      idempotencyKey: 'dd55f269-e1ae-4d38-a250-a20db52a0e44',
      inventoryId,
      firstParty: { fullName: 'First Party' },
      secondParty: { fullName: 'Second Party' },
      documentPurpose: 'Agreement',
      serviceChargesPaisa: 0,
      otherFeesPaisa: 0,
      amountReceivedPaisa: 100_001,
      paymentMethod: 'CASH',
      stagedDocumentTokens: []
    })).toThrow('Amount received cannot exceed the total payable')

    expect(db.prepare('SELECT COUNT(*) AS count FROM stamp_paper_sales').get()).toMatchObject({ count: 0 })
    expect(db.prepare('SELECT status FROM stamp_paper_inventory WHERE id = ?').get(inventoryId)).toMatchObject({ status: 'AVAILABLE' })
  })

  it('stores staged documents encrypted and binds their retrieval to the sale', () => {
    const encryptedService = new StampPaperService(db, root, {
      encrypt: (bytes) => Buffer.from(bytes.map((byte) => byte ^ 0xff)),
      decrypt: (bytes) => Buffer.from(bytes.map((byte) => byte ^ 0xff))
    })
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    const staged = encryptedService.stageDocument({
      category: 'FIRST_PHOTO',
      originalFilename: '..\\private.png',
      mimeType: 'image/png',
      contentBase64: png.toString('base64')
    }, userId)
    const inventoryId = encryptedService.addInventory({
      itemType: 'Non-judicial', denominationPaisa: 250_000, serialNumber: 'DOC-001',
      purchaseCostPaisa: 200_000, salePricePaisa: 250_000
    }, userId)
    const sale = encryptedService.createSale({
      transactionId: 'ee55f269-e1ae-4d38-a250-a20db52a0e44',
      idempotencyKey: 'ff55f269-e1ae-4d38-a250-a20db52a0e44',
      inventoryId,
      firstParty: { fullName: 'First Party' },
      secondParty: { fullName: 'Second Party' },
      documentPurpose: 'Agreement',
      serviceChargesPaisa: 0,
      otherFeesPaisa: 0,
      amountReceivedPaisa: 0,
      paymentMethod: 'CASH',
      stagedDocumentTokens: [staged.token]
    })
    const document = encryptedService.listDocuments(sale.id)[0]
    const record = db.prepare('SELECT relative_storage_path FROM stamp_paper_documents WHERE id = ?').get(document.id) as { relative_storage_path: string }
    const actualPath = path.join(root, record.relative_storage_path)
    expect(fs.readFileSync(actualPath)).not.toEqual(png)
    expect(encryptedService.readDocument(sale.id, document.id, userId).contentBase64).toBe(png.toString('base64'))
    expect(() => encryptedService.readDocument(sale.id + 1, document.id, userId)).toThrow('Document not found')
    expect(path.basename(record.relative_storage_path)).not.toContain('private')
  })

  it('creates simplified stamp transactions with multiple attachments and later payments', () => {
    const simpleService = new StampPaperService(db, root, {
      encrypt: (bytes) => Buffer.from(bytes.map((byte) => byte ^ 0xff)),
      decrypt: (bytes) => Buffer.from(bytes.map((byte) => byte ^ 0xff))
    })
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    const first = simpleService.stageDocument({ category: 'SUPPORTING', originalFilename: 'form.png', mimeType: 'image/png', contentBase64: png.toString('base64') }, userId)
    const second = simpleService.stageDocument({ category: 'SUPPORTING', originalFilename: 'receipt.png', mimeType: 'image/png', contentBase64: png.toString('base64') }, userId)
    const input = {
      transactionId: 'aa65f269-e1ae-4d38-a250-a20db52a0e44',
      idempotencyKey: 'bb65f269-e1ae-4d38-a250-a20db52a0e44',
      referenceName: 'Walk-in referral',
      hasTicketNumber: true,
      customerName: 'Test Customer',
      registration: 'REG-22',
      status: 'PENDING' as const,
      salePricePaisa: 250_025,
      serviceChargesPaisa: 10_000,
      otherFeesPaisa: 0,
      amountReceivedPaisa: 100_000,
      paymentMethod: 'CASH' as const,
      paymentReferenceNumber: '',
      paymentRemarks: '',
      remarks: 'Optional note',
      stagedDocumentTokens: [first.token, second.token]
    }

    const sale = simpleService.createSimpleSale(input)
    expect(sale.status).toBe('PENDING')
    expect(sale.reference_name).toBe('Walk-in referral')
    expect(sale.ticket_number).toBeNull()
    expect(sale.has_ticket_number).toBe(1)
    expect(sale.customer_name).toBe('Test Customer')
    expect(sale.registration).toBe('REG-22')
    expect(sale.total_payable_paisa).toBe(260_025)
    expect(sale.outstanding_balance_paisa).toBe(160_025)
    expect(simpleService.getSimpleSale(sale.id).documents).toHaveLength(2)

    const retry = simpleService.createSimpleSale(input)
    expect(retry.id).toBe(sale.id)
    const payment = simpleService.recordSimplePayment({ saleId: sale.id, amountPaisa: 160_025, method: 'BANK' })
    expect(payment.receiptNumber).toMatch(/^STPR-\d{8}-\d{4}$/)
    const settled = simpleService.getSimpleSale(sale.id)
    expect(settled.amount_received_paisa).toBe(260_025)
    expect(settled.outstanding_balance_paisa).toBe(0)
    expect(settled.payments).toHaveLength(2)
  })

  it('allows transactions without a ticket number but requires registration', () => {
    const invalidModel = SimpleStampSaleCreateSchema.safeParse({
      transactionId: 'aa65f269-e1ae-4d38-a250-a20db52a0e44',
      idempotencyKey: 'bb65f269-e1ae-4d38-a250-a20db52a0e44',
      referenceName: 'Referral',
      customerName: 'Customer',
      registration: '',
      status: 'PENDING',
      salePricePaisa: 0,
      serviceChargesPaisa: 0,
      otherFeesPaisa: 0,
      amountReceivedPaisa: 0,
      paymentMethod: 'CASH'
    })
    expect(invalidModel.success).toBe(false)
    if (!invalidModel.success) {
      expect(invalidModel.error.issues.map((issue) => issue.message)).toContain('Enter the registration.')
    }

    expect(() => db.prepare(`
      INSERT INTO stamp_paper_transactions (
        txn_no, transaction_id, idempotency_key, reference_name, ticket_number,
        bank_employee_name, customer_name, register_no, price, sale_price_paisa,
        service_charges_paisa, other_fees_paisa, total_payable_paisa, status, created_by
      ) VALUES ('TEST-T1', 'cc65f269-e1ae-4d38-a250-a20db52a0e44', 'dd65f269-e1ae-4d38-a250-a20db52a0e44', 'Ref', NULL, '', 'Customer', 'REG-1', 0, 0, 0, 0, 0, 'PENDING', ?)
    `).run(userId)).not.toThrow()

    expect(() => db.prepare(`
      INSERT INTO stamp_paper_transactions (
        txn_no, transaction_id, idempotency_key, reference_name, ticket_number,
        bank_employee_name, customer_name, register_no, price, sale_price_paisa,
        service_charges_paisa, other_fees_paisa, total_payable_paisa, status, created_by
      ) VALUES ('TEST-T2', 'ee65f269-e1ae-4d38-a250-a20db52a0e44', 'ff65f269-e1ae-4d38-a250-a20db52a0e44', 'Ref', 'T-2', '', 'Customer', '  ', 0, 0, 0, 0, 0, 'PENDING', ?)
    `).run(userId)).toThrow('Registration is required. Enter the registration.')
  })
})
