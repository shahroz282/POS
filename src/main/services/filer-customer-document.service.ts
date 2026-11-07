import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DB } from '../db/db'
import type { FilerCustomerDocumentRow } from '@shared/schemas'
import { AuditLogRepository } from '../repositories/audit-log.repository'

const MAX_FILE_BYTES = 10 * 1024 * 1024
type MimeType = 'image/jpeg' | 'image/png' | 'application/pdf'

interface StagedDocument {
  originalFilename: string
  mimeType: MimeType
  bytes: Buffer
  uploadedBy: number
}

export class FilerCustomerDocumentService {
  private readonly staged = new Map<string, StagedDocument>()
  private readonly audit: AuditLogRepository

  constructor(
    private readonly db: DB,
    private readonly documentRoot: string,
    private readonly crypto: { encrypt: (bytes: Buffer) => Buffer; decrypt: (bytes: Buffer) => Buffer }
  ) {
    this.audit = new AuditLogRepository(db)
  }

  stage(input: { originalFilename: string; mimeType: MimeType; contentBase64: string }, userId: number) {
    const bytes = Buffer.from(input.contentBase64, 'base64')
    if (!bytes.length || bytes.length > MAX_FILE_BYTES || bytes.toString('base64') !== input.contentBase64) {
      throw new Error('Proof must be a valid PDF, JPG, or PNG no larger than 10 MB')
    }
    if (!this.matchesSignature(bytes, input.mimeType)) throw new Error('The selected file does not match its declared type')
    const originalFilename = path.basename(input.originalFilename).replace(/[\u0000-\u001f]/g, '').slice(0, 180)
    if (!originalFilename) throw new Error('Document filename is invalid')
    const token = randomUUID()
    this.staged.set(token, { originalFilename, mimeType: input.mimeType, bytes, uploadedBy: userId })
    return { token, originalFilename, mimeType: input.mimeType, fileSize: bytes.length }
  }

  discard(token: string, userId: number): void {
    const staged = this.staged.get(token)
    if (staged && staged.uploadedBy !== userId) throw new Error('Document upload does not belong to this session')
    this.staged.delete(token)
  }

  commit(customerId: number, token: string, userId: number): FilerCustomerDocumentRow {
    const document = this.staged.get(token)
    if (!document || document.uploadedBy !== userId) throw new Error('Document upload expired; select the file again')
    if (!this.db.prepare('SELECT id FROM filer_customers WHERE id = ?').get(customerId)) {
      throw new Error('Filer customer not found')
    }
    const extension = document.mimeType === 'image/jpeg' ? '.jpg' :
      document.mimeType === 'image/png' ? '.png' : '.pdf'
    const storedFilename = `${randomUUID()}${extension}`
    const relativePath = path.join('filer-customers', String(customerId), storedFilename)
    const fullPath = this.resolvePath(relativePath)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    let documentId: number
    try {
      fs.writeFileSync(fullPath, this.crypto.encrypt(document.bytes), { flag: 'wx' })
      documentId = this.db.transaction(() => {
        this.db.prepare(`
          UPDATE filer_customer_documents SET is_active = 0
          WHERE customer_id = ? AND is_active = 1
        `).run(customerId)
        const inserted = this.db.prepare(`
          INSERT INTO filer_customer_documents (
            customer_id, original_filename, stored_filename, relative_path, mime_type,
            file_size, uploaded_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(customerId, document.originalFilename, storedFilename, relativePath,
          document.mimeType, document.bytes.length, userId)
        const id = Number(inserted.lastInsertRowid)
        this.audit.insert(userId, 'FILER_CUSTOMER_PROOF_UPLOADED', 'filer_customer_documents', id,
          `Uploaded proof for filer customer ${customerId}`)
        return id
      })()
    } catch (error) {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
      throw error
    }
    this.staged.delete(token)
    const row = this.db.prepare(`
      SELECT id, original_filename, mime_type, file_size, uploaded_at
      FROM filer_customer_documents WHERE id = ?
    `).get(documentId)
    if (!row) throw new Error('Saved proof could not be verified')
    return row as unknown as FilerCustomerDocumentRow
  }

  list(customerId: number): FilerCustomerDocumentRow[] {
    if (!this.db.prepare('SELECT id FROM filer_customers WHERE id = ?').get(customerId)) {
      throw new Error('Filer customer not found')
    }
    return this.db.prepare(`
      SELECT id, original_filename, mime_type, file_size, uploaded_at
      FROM filer_customer_documents
      WHERE customer_id = ? AND is_active = 1 ORDER BY uploaded_at DESC, id DESC
    `).all(customerId) as unknown as FilerCustomerDocumentRow[]
  }

  read(customerId: number, documentId: number, userId: number) {
    const row = this.db.prepare(`
      SELECT relative_path, original_filename, mime_type
      FROM filer_customer_documents
      WHERE id = ? AND customer_id = ? AND is_active = 1
    `).get(documentId, customerId) as {
      relative_path: string; original_filename: string; mime_type: MimeType
    } | undefined
    if (!row) throw new Error('Filing proof not found')
    const fullPath = this.resolvePath(row.relative_path)
    if (!fs.existsSync(fullPath)) throw new Error('Filing proof file is unavailable')
    const bytes = this.crypto.decrypt(fs.readFileSync(fullPath))
    this.audit.insert(userId, 'FILER_CUSTOMER_PROOF_VIEWED', 'filer_customer_documents', documentId,
      `Viewed proof for filer customer ${customerId}`)
    return { originalFilename: row.original_filename, mimeType: row.mime_type, contentBase64: bytes.toString('base64') }
  }

  private resolvePath(relativePath: string): string {
    const root = path.resolve(this.documentRoot)
    const fullPath = path.resolve(root, relativePath)
    if (!fullPath.startsWith(`${root}${path.sep}`)) throw new Error('Invalid document storage path')
    return fullPath
  }

  private matchesSignature(bytes: Buffer, mimeType: MimeType): boolean {
    if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-'
    if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
}
