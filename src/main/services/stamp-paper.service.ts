import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { DB } from '../db/db'
import type { SimpleStampSaleCreate, SimpleStampSaleRow, StampDocumentRow, StampInventoryCreate, StampPaperSaleCreate } from '@shared/schemas'
import { AuditLogRepository } from '../repositories/audit-log.repository'
import { StampPaperRepository, type StampPartyRow } from '../repositories/stamp-paper.repository'
import { getCurrentUser } from './session'

export class StampPaperService {
  private readonly repository: StampPaperRepository
  private readonly audit: AuditLogRepository
  private readonly stagedDocuments = new Map<string, {
    token: string; category: string; originalFilename: string; mimeType: string; fileSize: number; filePath: string
  }>()

  constructor(
    private readonly db: DB,
    private readonly documentRoot: string,
    private readonly documentCrypto: { encrypt: (bytes: Buffer) => Buffer; decrypt: (bytes: Buffer) => Buffer } = {
      encrypt: (bytes) => bytes,
      decrypt: (bytes) => bytes
    }
  ) {
    this.repository = new StampPaperRepository(db)
    this.audit = new AuditLogRepository(db)
    this.cleanupOrphanedFiles()
  }

  createSimpleSale(input: SimpleStampSaleCreate): SimpleStampSaleRow {
    const user = getCurrentUser()
    if (!user) throw new Error('Not logged in')
    if (!input.ticketNumber?.trim()) throw new Error('Enter the ticket number.')
    if (!input.registration?.trim()) throw new Error('Enter the registration.')
    const totalPayablePaisa = input.salePricePaisa + input.serviceChargesPaisa + input.otherFeesPaisa
    if (input.amountReceivedPaisa > totalPayablePaisa) throw new Error('Amount received cannot exceed the total payable')
    if (input.status === 'CANCELLED' && input.amountReceivedPaisa > 0) throw new Error('A cancelled transaction cannot accept payment')
    const existing = this.repository.findSimpleSaleByKey(input.idempotencyKey)
    if (existing) {
      for (const token of input.stagedDocumentTokens) this.discardStagedDocument(token)
      return existing
    }

    const staged = input.stagedDocumentTokens.map((token) => {
      const document = this.stagedDocuments.get(token)
      if (!document || document.category !== 'SUPPORTING') throw new Error('One or more uploaded documents expired; upload them again')
      return document
    })
    if (new Set(input.stagedDocumentTokens).size !== input.stagedDocumentTokens.length) throw new Error('Duplicate document upload token')

    const movedFiles: Array<{ document: typeof staged[number]; destination: string }> = []
    try {
      const sale = this.db.transaction(() => {
        const duplicate = this.repository.findSimpleSaleByKey(input.idempotencyKey)
        if (duplicate) return duplicate

        const now = new Date()
        const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
        const invoiceNumber = `STP-${day}-${String(this.repository.nextNumber('STP', day)).padStart(4, '0')}`
        const stampId = this.repository.insertSimpleSale({
          transactionId: input.transactionId,
          idempotencyKey: input.idempotencyKey,
          invoiceNumber,
          referenceName: input.referenceName,
          ticketNumber: input.ticketNumber.trim(),
          customerName: input.customerName,
          registration: input.registration.trim(),
          status: input.status,
          salePricePaisa: input.salePricePaisa,
          serviceChargesPaisa: input.serviceChargesPaisa,
          otherFeesPaisa: input.otherFeesPaisa,
          totalPayablePaisa,
          amountReceivedPaisa: input.amountReceivedPaisa,
          paymentMethod: input.paymentMethod,
          paymentReferenceNumber: input.paymentReferenceNumber,
          paymentRemarks: input.paymentRemarks,
          remarks: input.remarks,
          createdBy: user.id
        })

        for (const document of staged) {
          const relativePath = path.join('simple_stamp_paper', input.transactionId, `${document.token}${path.extname(document.filePath)}`)
          const destination = path.join(this.documentRoot, relativePath)
          fs.mkdirSync(path.dirname(destination), { recursive: true })
          fs.renameSync(document.filePath, destination)
          movedFiles.push({ document, destination })
          this.repository.insertSimpleDocument({
            stampId,
            originalFilename: document.originalFilename,
            storedFilename: path.basename(destination),
            relativePath,
            mimeType: document.mimeType,
            fileSize: document.fileSize,
            createdBy: user.id
          })
        }

        this.audit.insert(user.id, 'STAMP_TRANSACTION_CREATED', 'stamp_paper_transactions', stampId,
          `Invoice ${invoiceNumber}; status ${input.status}`)
        return this.repository.getSimpleSale(stampId)!
      })()
      for (const document of staged) this.stagedDocuments.delete(document.token)
      return sale
    } catch (error) {
      for (const moved of movedFiles) {
        if (fs.existsSync(moved.destination)) {
          fs.mkdirSync(path.dirname(moved.document.filePath), { recursive: true })
          fs.renameSync(moved.destination, moved.document.filePath)
        }
      }
      throw error
    }
  }

  listSimpleSales(query = '', fromDate?: string, toDate?: string) {
    return this.repository.listSimpleSales(query, fromDate, toDate)
  }

  getSimpleSale(stampId: number) {
    const sale = this.repository.getSimpleSale(stampId)
    if (!sale) throw new Error('Stamp paper transaction not found')
    return sale
  }

  recordSimplePayment(input: { saleId: number; amountPaisa: number; method: string; referenceNumber?: string; remarks?: string }) {
    const user = getCurrentUser()
    if (!user) throw new Error('Not logged in')
    return this.db.transaction(() => {
      const sale = this.repository.getSimpleSale(input.saleId)
      if (!sale || sale.status === 'CANCELLED') throw new Error('Active stamp paper transaction not found')
      if (input.amountPaisa > sale.outstanding_balance_paisa) throw new Error('Payment cannot exceed the outstanding balance')
      const now = new Date()
      const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const receiptNumber = `STPR-${day}-${String(this.repository.nextNumber('STPR', day)).padStart(4, '0')}`
      this.repository.insertSimplePayment({
        stampId: input.saleId,
        receiptNumber,
        amountPaisa: input.amountPaisa,
        method: input.method,
        referenceNumber: input.referenceNumber,
        remarks: input.remarks,
        createdBy: user.id
      })
      this.audit.insert(user.id, 'STAMP_PAYMENT_RECEIVED', 'stamp_paper_transactions', input.saleId, `Receipt ${receiptNumber}`)
      return { receiptNumber }
    })()
  }

  readSimpleDocument(stampId: number, documentId: number, userId: number) {
    const row = this.db.prepare(`
      SELECT relative_storage_path, mime_type, original_filename
      FROM stamp_transaction_documents WHERE id = ? AND stamp_id = ?
    `).get(documentId, stampId) as { relative_storage_path: string; mime_type: string; original_filename: string } | undefined
    if (!row) throw new Error('Document not found')
    const fullPath = path.resolve(this.documentRoot, row.relative_storage_path)
    const safeRoot = path.resolve(this.documentRoot) + path.sep
    if (!fullPath.startsWith(safeRoot) || !fs.existsSync(fullPath)) throw new Error('Document file is unavailable')
    const bytes = this.documentCrypto.decrypt(fs.readFileSync(fullPath))
    this.audit.insert(userId, 'STAMP_DOCUMENT_VIEWED', 'stamp_transaction_documents', documentId, `Viewed ${row.mime_type}`)
    return { originalFilename: row.original_filename, mimeType: row.mime_type, contentBase64: bytes.toString('base64') }
  }

  removeSimpleDocument(stampId: number, documentId: number, userId: number): void {
    const row = this.db.prepare(`
      SELECT relative_storage_path FROM stamp_transaction_documents WHERE id = ? AND stamp_id = ?
    `).get(documentId, stampId) as { relative_storage_path: string } | undefined
    if (!row) throw new Error('Document not found')
    const fullPath = path.resolve(this.documentRoot, row.relative_storage_path)
    const safeRoot = path.resolve(this.documentRoot) + path.sep
    if (!fullPath.startsWith(safeRoot)) throw new Error('Invalid document storage path')
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM stamp_transaction_documents WHERE id = ? AND stamp_id = ?').run(documentId, stampId)
      this.audit.insert(userId, 'STAMP_DOCUMENT_REMOVED', 'stamp_transaction_documents', documentId, 'Document removed by authorized user')
    })()
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
  }

  listInventory(query = '', role = 'CASHIER') {
    const inventory = this.repository.listInventory(query)
    return role === 'ADMIN' || role === 'MANAGER'
      ? inventory
      : inventory.map((item) => ({ ...item, purchase_cost_paisa: null }))
  }

  addInventory(input: StampInventoryCreate, userId: number): number {
    const id = this.repository.insertInventory({ ...input, createdBy: userId })
    this.audit.insert(userId, 'STAMP_INVENTORY_ADDED', 'stamp_paper_inventory', id, `Added serial ${input.serialNumber}`)
    return id
  }

  searchParties(query: string) {
    return this.repository.searchParties(query)
  }

  listSales(query = '', fromDate?: string, toDate?: string, role = 'CASHIER') {
    return this.repository.listSales(query, fromDate, toDate, role === 'ADMIN' || role === 'MANAGER')
  }

  getSaleDetail(saleId: number, role: string) {
    const detail = this.repository.getSaleDetail(saleId)
    if (!detail) throw new Error('Stamp paper transaction not found')
    if (role !== 'ADMIN' && role !== 'MANAGER') {
      const mask = (value: string | null) => value ? `*****-*******-${value.slice(-1)}` : null
      detail.first_party.cnic_number = mask(detail.first_party.cnic_number)
      detail.second_party.cnic_number = mask(detail.second_party.cnic_number)
      detail.purchase_cost_paisa = null
    }
    return detail
  }

  stageDocument(input: { category: string; originalFilename: string; mimeType: string; contentBase64: string }, userId: number) {
    const bytes = Buffer.from(input.contentBase64, 'base64')
    if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) throw new Error('Document must be smaller than 10 MB')
    const detectedMime = this.detectMime(bytes)
    if (detectedMime !== input.mimeType) throw new Error('The selected file type does not match its contents')
    const extension = detectedMime === 'image/jpeg' ? '.jpg' : detectedMime === 'image/png' ? '.png' : '.pdf'
    const token = randomUUID()
    const stagingDirectory = path.join(this.documentRoot, 'staging')
    fs.mkdirSync(stagingDirectory, { recursive: true })
    const filePath = path.join(stagingDirectory, `${token}${extension}`)
    fs.writeFileSync(filePath, this.documentCrypto.encrypt(bytes), { flag: 'wx' })
    const safeOriginalFilename = path.basename(input.originalFilename).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 255) || 'document'
    this.stagedDocuments.set(token, {
      token,
      category: input.category,
      originalFilename: safeOriginalFilename,
      mimeType: detectedMime,
      fileSize: bytes.length,
      filePath
    })
    this.audit.insert(userId, 'STAMP_DOCUMENT_STAGED', 'stamp_paper_documents', null, `Staged ${input.category} (${bytes.length} bytes)`)
    return { token, originalFilename: safeOriginalFilename, mimeType: detectedMime, fileSize: bytes.length }
  }

  discardStagedDocument(token: string): void {
    const staged = this.stagedDocuments.get(token)
    if (!staged) return
    if (fs.existsSync(staged.filePath)) fs.unlinkSync(staged.filePath)
    this.stagedDocuments.delete(token)
  }

  listDocuments(saleId: number): StampDocumentRow[] {
    return this.db.prepare(`
      SELECT id, sale_id, party_id, category, original_filename, mime_type, file_size, created_at
      FROM stamp_paper_documents WHERE sale_id = ? ORDER BY id
    `).all(saleId) as unknown as StampDocumentRow[]
  }

  readDocument(saleId: number, documentId: number, userId: number) {
    const row = this.db.prepare(`
      SELECT relative_storage_path, mime_type, original_filename
      FROM stamp_paper_documents WHERE id = ? AND sale_id = ?
    `).get(documentId, saleId) as { relative_storage_path: string; mime_type: string; original_filename: string } | undefined
    if (!row) throw new Error('Document not found')
    const fullPath = path.resolve(this.documentRoot, row.relative_storage_path)
    const safeRoot = path.resolve(this.documentRoot) + path.sep
    if (!fullPath.startsWith(safeRoot) || !fs.existsSync(fullPath)) throw new Error('Document file is unavailable')
    const bytes = this.documentCrypto.decrypt(fs.readFileSync(fullPath))
    this.audit.insert(userId, 'STAMP_DOCUMENT_VIEWED', 'stamp_paper_documents', documentId, `Viewed ${row.mime_type}`)
    return { originalFilename: row.original_filename, mimeType: row.mime_type, contentBase64: bytes.toString('base64') }
  }

  removeDocument(saleId: number, documentId: number, userId: number): void {
    const row = this.db.prepare(`
      SELECT relative_storage_path FROM stamp_paper_documents WHERE id = ? AND sale_id = ?
    `).get(documentId, saleId) as { relative_storage_path: string } | undefined
    if (!row) throw new Error('Document not found')
    const fullPath = path.resolve(this.documentRoot, row.relative_storage_path)
    const safeRoot = path.resolve(this.documentRoot) + path.sep
    if (!fullPath.startsWith(safeRoot)) throw new Error('Invalid document storage path')
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM stamp_paper_documents WHERE id = ? AND sale_id = ?').run(documentId, saleId)
      this.audit.insert(userId, 'STAMP_DOCUMENT_REMOVED', 'stamp_paper_documents', documentId, 'Document removed by authorized user')
    })()
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
  }

  createSale(input: StampPaperSaleCreate) {
    const user = getCurrentUser()
    if (!user) throw new Error('Not logged in')
    const alreadyCreated = this.repository.findSaleByIdempotencyKey(input.idempotencyKey)
    if (alreadyCreated) {
      for (const token of input.stagedDocumentTokens) this.discardStagedDocument(token)
      return alreadyCreated
    }

    const staged = input.stagedDocumentTokens.map((token) => {
      const document = this.stagedDocuments.get(token)
      if (!document) throw new Error('One or more uploaded documents expired; upload them again')
      return document
    })
    if (new Set(input.stagedDocumentTokens).size !== input.stagedDocumentTokens.length) {
      throw new Error('Duplicate document upload token')
    }
    const movedFiles: Array<{ document: typeof staged[number]; destination: string; relativePath: string }> = []

    try {
      const result = this.db.transaction(() => {
      const existing = this.repository.findSaleByIdempotencyKey(input.idempotencyKey)
      if (existing) {
        for (const document of staged) {
          if (fs.existsSync(document.filePath)) fs.unlinkSync(document.filePath)
          this.stagedDocuments.delete(document.token)
        }
        return existing
      }

      const inventory = this.repository.findInventory(input.inventoryId)
      if (!inventory || inventory.status !== 'AVAILABLE') {
        throw new Error('This stamp paper serial is not available')
      }

      const totalPayablePaisa = inventory.sale_price_paisa + input.serviceChargesPaisa + input.otherFeesPaisa
      if (input.amountReceivedPaisa > totalPayablePaisa) {
        throw new Error('Amount received cannot exceed the total payable')
      }

      const firstParty = this.saveParty(input.firstParty)
      const secondParty = this.saveParty(input.secondParty)
      if (firstParty.id === secondParty.id) {
        throw new Error('First and second party must be different records')
      }

      const now = new Date()
      const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const invoiceNumber = `STP-${day}-${String(this.repository.nextNumber('STP', day)).padStart(4, '0')}`
      const saleId = this.repository.insertSale({
        transactionId: input.transactionId,
        idempotencyKey: input.idempotencyKey,
        invoiceNumber,
        inventoryId: input.inventoryId,
        purpose: input.documentPurpose,
        reference: input.documentReferenceNumber,
        serviceChargesPaisa: input.serviceChargesPaisa,
        otherFeesPaisa: input.otherFeesPaisa,
        totalPayablePaisa,
        remarks: input.remarks,
        createdBy: user.id
      })

      this.repository.linkParty(saleId, firstParty.id, 'FIRST_PARTY', firstParty.snapshot)
      this.repository.linkParty(saleId, secondParty.id, 'SECOND_PARTY', secondParty.snapshot)

      for (const document of staged) {
        const side = document.category.startsWith('FIRST_') ? 'first_party'
          : document.category.startsWith('SECOND_') ? 'second_party' : 'supporting'
        const relativePath = path.join('stamp_paper', input.transactionId, side, `${document.token}${path.extname(document.filePath)}`)
        const destination = path.join(this.documentRoot, relativePath)
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.renameSync(document.filePath, destination)
        movedFiles.push({ document, destination, relativePath })
        const partyId = side === 'first_party' ? firstParty.id : side === 'second_party' ? secondParty.id : undefined
        this.repository.insertDocument({
          saleId,
          partyId,
          category: document.category,
          originalFilename: document.originalFilename,
          storedFilename: path.basename(destination),
          relativePath,
          mimeType: document.mimeType,
          fileSize: document.fileSize,
          createdBy: user.id
        })
      }

      if (input.amountReceivedPaisa > 0) {
        const receiptNumber = `STPR-${day}-${String(this.repository.nextNumber('STPR', day)).padStart(4, '0')}`
        this.repository.insertPayment({
          saleId,
          receiptNumber,
          amountPaisa: input.amountReceivedPaisa,
          method: input.paymentMethod,
          reference: input.paymentReferenceNumber,
          remarks: input.paymentRemarks,
          createdBy: user.id
        })
      }

      this.repository.markInventorySold(input.inventoryId)
      this.repository.insertMovement(input.inventoryId, saleId, 'SOLD', user.id)
      this.audit.insert(user.id, 'STAMP_SALE_CREATED', 'stamp_paper_sales', saleId, `Invoice ${invoiceNumber}; serial ${inventory.serial_number}`)

      return {
        id: saleId,
        transaction_id: input.transactionId,
        invoice_number: invoiceNumber,
        transaction_date: new Date().toISOString(),
        status: 'COMPLETED' as const,
        first_party_name: firstParty.snapshot.full_name,
        second_party_name: secondParty.snapshot.full_name,
        serial_number: inventory.serial_number,
        denomination_paisa: inventory.denomination_paisa,
        total_payable_paisa: totalPayablePaisa,
        amount_received_paisa: input.amountReceivedPaisa,
        outstanding_balance_paisa: totalPayablePaisa - input.amountReceivedPaisa
      }
      })()
      for (const document of staged) this.stagedDocuments.delete(document.token)
      return result
    } catch (error) {
      for (const moved of movedFiles) {
        if (fs.existsSync(moved.destination)) {
          fs.mkdirSync(path.dirname(moved.document.filePath), { recursive: true })
          fs.renameSync(moved.destination, moved.document.filePath)
        }
      }
      throw error
    }
  }

  recordPayment(input: { saleId: number; amountPaisa: number; method: string; referenceNumber?: string; remarks?: string }) {
    const user = getCurrentUser()
    if (!user) throw new Error('Not logged in')
    return this.db.transaction(() => {
      const sale = this.db.prepare('SELECT total_payable_paisa, status FROM stamp_paper_sales WHERE id = ?').get(input.saleId) as { total_payable_paisa: number; status: string } | undefined
      if (!sale || sale.status !== 'COMPLETED') throw new Error('Completed stamp paper sale not found')
      const row = this.db.prepare('SELECT COALESCE(SUM(amount_paisa), 0) AS received FROM stamp_paper_payments WHERE sale_id = ?').get(input.saleId) as { received: number }
      if (input.amountPaisa > sale.total_payable_paisa - row.received) {
        throw new Error('Payment cannot exceed the outstanding balance')
      }
      const now = new Date()
      const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const receiptNumber = `STPR-${day}-${String(this.repository.nextNumber('STPR', day)).padStart(4, '0')}`
      this.repository.insertPayment({
        saleId: input.saleId,
        receiptNumber,
        amountPaisa: input.amountPaisa,
        method: input.method,
        reference: input.referenceNumber,
        remarks: input.remarks,
        createdBy: user.id
      })
      this.audit.insert(user.id, 'STAMP_PAYMENT_RECEIVED', 'stamp_paper_sales', input.saleId, `Receipt ${receiptNumber}; amount ${input.amountPaisa} paisa`)
      return { receiptNumber }
    })()
  }

  cancelSale(saleId: number, reason: string, refundMethod?: string): void {
    const user = getCurrentUser()
    if (!user) throw new Error('Not logged in')
    if (user.role === 'CASHIER') throw new Error('Only Admin or Manager can cancel stamp paper sales')
    this.db.transaction(() => {
      const sale = this.db.prepare(`
        SELECT s.inventory_id, s.status,
          COALESCE((SELECT SUM(p.amount_paisa) FROM stamp_paper_payments p WHERE p.sale_id = s.id), 0)
            - COALESCE((SELECT SUM(r.amount_paisa) FROM stamp_paper_refunds r WHERE r.sale_id = s.id), 0) AS received
        FROM stamp_paper_sales s WHERE s.id = ?
      `).get(saleId) as { inventory_id: number; status: string; received: number } | undefined
      if (!sale || sale.status !== 'COMPLETED') throw new Error('Completed stamp paper sale not found')
      if (sale.received > 0) {
        if (!refundMethod) throw new Error('Select a refund method before cancelling a paid sale')
        this.repository.insertRefund({ saleId, amountPaisa: sale.received, method: refundMethod, reason, createdBy: user.id })
      }
      this.db.prepare(`
        UPDATE stamp_paper_sales SET status = 'CANCELLED', cancelled_by = ?, cancelled_at = datetime('now','localtime'), cancellation_reason = ?
        WHERE id = ? AND status = 'COMPLETED'
      `).run(user.id, reason, saleId)
      this.db.prepare("UPDATE stamp_paper_inventory SET status = 'AVAILABLE' WHERE id = ? AND status = 'SOLD'").run(sale.inventory_id)
      this.repository.insertMovement(sale.inventory_id, saleId, 'SALE_REVERSED', user.id, reason)
      this.audit.insert(user.id, 'STAMP_SALE_CANCELLED', 'stamp_paper_sales', saleId, reason)
    })()
  }

  private saveParty(input: StampPaperSaleCreate['firstParty']): { id: number; snapshot: Omit<StampPartyRow, 'id'> } {
    const user = getCurrentUser()
    const existing = input.partyId ? this.repository.findParty(input.partyId) : undefined
    if (input.partyId && !existing) throw new Error('Selected party record was not found')
    const preserveExisting = user?.role === 'CASHIER' && existing
    const suppliedCnic = input.cnicNumber || ''
    const cnic = (preserveExisting && (!suppliedCnic || suppliedCnic.includes('*'))
      ? existing.cnic_number || ''
      : suppliedCnic).replace(/\D/g, '')
    const normalizedCnic = cnic.length === 13 ? `${cnic.slice(0, 5)}-${cnic.slice(5, 12)}-${cnic.slice(12)}` : null
    const snapshot: Omit<StampPartyRow, 'id'> = {
      full_name: preserveExisting ? existing.full_name : input.fullName,
      father_or_husband_name: preserveExisting ? existing.father_or_husband_name : input.fatherOrHusbandName || null,
      cnic_number: normalizedCnic,
      mobile_number: preserveExisting ? existing.mobile_number : input.mobileNumber || null,
      address: preserveExisting ? existing.address : input.address || null,
      city: preserveExisting ? existing.city : input.city || null,
      district: preserveExisting ? existing.district : input.district || null
    }
    if (input.partyId) {
      if (input.updateExisting) {
        if (user?.role !== 'ADMIN' && user?.role !== 'MANAGER') throw new Error('Only Admin or Manager can update saved party details')
        this.repository.updateParty(input.partyId, snapshot)
        this.audit.insert(user.id, 'STAMP_PARTY_UPDATED', 'parties', input.partyId, 'Updated saved party details from stamp sale form')
      }
      return { id: input.partyId, snapshot }
    }
    return { id: this.repository.insertParty(snapshot), snapshot }
  }

  private detectMime(bytes: Buffer): 'image/jpeg' | 'image/png' | 'application/pdf' {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
    if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
    throw new Error('Only JPEG, PNG, and PDF documents are supported')
  }

  private cleanupOrphanedFiles(): void {
    const referenced = new Set([
      ...this.db.prepare('SELECT relative_storage_path FROM stamp_paper_documents').all(),
      ...this.db.prepare('SELECT relative_storage_path FROM stamp_transaction_documents').all()
    ]
      .map((row) => String(row.relative_storage_path)))
    const walk = (directory: string, relativeDirectory = '') => {
      if (!fs.existsSync(directory)) return
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name)
        const relativePath = path.join(relativeDirectory, entry.name)
        if (entry.isDirectory()) {
          walk(absolutePath, relativePath)
          if (fs.readdirSync(absolutePath).length === 0) fs.rmdirSync(absolutePath)
        } else if (relativeDirectory === 'staging' || !referenced.has(relativePath)) {
          fs.unlinkSync(absolutePath)
        }
      }
    }
    walk(path.join(this.documentRoot, 'staging'), 'staging')
    walk(path.join(this.documentRoot, 'stamp_paper'), 'stamp_paper')
    walk(path.join(this.documentRoot, 'simple_stamp_paper'), 'simple_stamp_paper')
  }
}
