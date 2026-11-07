import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DB } from '../db/db'
import type { AdmissionDocumentCategoryType, AdmissionDocumentRow } from '@shared/schemas'
import { AuditLogRepository } from '../repositories/audit-log.repository'

const MAX_FILE_BYTES = 10 * 1024 * 1024

interface StagedDocument {
  category: AdmissionDocumentCategoryType
  originalFilename: string
  mimeType: 'image/jpeg' | 'application/pdf'
  bytes: Buffer
  uploadedBy: number
}

export class AdmissionDocumentService {
  private readonly staged = new Map<string, StagedDocument>()
  private readonly audit: AuditLogRepository

  constructor(
    private readonly db: DB,
    private readonly documentRoot: string,
    private readonly crypto: { encrypt: (bytes: Buffer) => Buffer; decrypt: (bytes: Buffer) => Buffer }
  ) {
    this.audit = new AuditLogRepository(db)
  }

  stage(input: {
    category: AdmissionDocumentCategoryType; originalFilename: string; mimeType: 'image/jpeg' | 'application/pdf';
    contentBase64: string
  }, userId: number) {
    const bytes = Buffer.from(input.contentBase64, 'base64')
    if (!bytes.length || bytes.length > MAX_FILE_BYTES || bytes.toString('base64') !== input.contentBase64) {
      throw new Error('Document must be a valid PDF or JPG no larger than 10 MB')
    }
    if (!this.matchesSignature(bytes, input.mimeType)) {
      throw new Error('The selected file does not match its declared type')
    }
    const originalFilename = path.basename(input.originalFilename).replace(/[\u0000-\u001f]/g, '').slice(0, 180)
    if (!originalFilename) throw new Error('Document filename is invalid')
    const token = randomUUID()
    this.staged.set(token, {
      category: input.category, originalFilename, mimeType: input.mimeType, bytes, uploadedBy: userId
    })
    return { token, originalFilename, mimeType: input.mimeType, fileSize: bytes.length }
  }

  discard(token: string, userId: number): void {
    const document = this.staged.get(token)
    if (document && document.uploadedBy !== userId) throw new Error('Document upload does not belong to this session')
    this.staged.delete(token)
  }

  commit(admissionId: number, token: string, userId: number): AdmissionDocumentRow {
    const document = this.staged.get(token)
    if (!document || document.uploadedBy !== userId) throw new Error('Document upload expired; select the file again')
    if (!this.db.prepare('SELECT id FROM admissions WHERE id = ?').get(admissionId)) {
      throw new Error('Admission not found')
    }
    const extension = document.mimeType === 'image/jpeg' ? '.jpg' : '.pdf'
    const storedFilename = `${randomUUID()}${extension}`
    const relativePath = path.join('admissions', String(admissionId), storedFilename)
    const fullPath = this.resolvePath(relativePath)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    let documentId: number
    try {
      fs.writeFileSync(fullPath, this.crypto.encrypt(document.bytes), { flag: 'wx' })
      documentId = this.db.transaction(() => {
        const inserted = this.db.prepare(`
          INSERT INTO admission_documents (
            admission_id, category, original_filename, stored_filename, relative_path,
            mime_type, file_size, uploaded_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(admissionId, document.category, document.originalFilename, storedFilename,
          relativePath, document.mimeType, document.bytes.length, userId)
        const id = Number(inserted.lastInsertRowid)
        this.audit.insert(userId, 'ADMISSION_DOCUMENT_UPLOADED', 'admission_documents', id,
          `Uploaded ${document.category} for admission ${admissionId}`)
        return id
      })()
    } catch (error) {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
      throw error
    }
    this.staged.delete(token)
    return this.getDocumentRow(documentId)
  }

  list(admissionId: number): AdmissionDocumentRow[] {
    if (!this.db.prepare('SELECT id FROM admissions WHERE id = ?').get(admissionId)) {
      throw new Error('Admission not found')
    }
    return this.db.prepare(`
      SELECT id, category, original_filename, mime_type, file_size, uploaded_at
      FROM admission_documents WHERE admission_id = ? AND is_active = 1
      ORDER BY uploaded_at DESC, id DESC
    `).all(admissionId) as unknown as AdmissionDocumentRow[]
  }

  read(admissionId: number, documentId: number, userId: number) {
    const row = this.db.prepare(`
      SELECT relative_path, original_filename, mime_type FROM admission_documents
      WHERE id = ? AND admission_id = ? AND is_active = 1
    `).get(documentId, admissionId) as {
      relative_path: string; original_filename: string; mime_type: 'image/jpeg' | 'application/pdf'
    } | undefined
    if (!row) throw new Error('Document not found')
    const fullPath = this.resolvePath(row.relative_path)
    if (!fs.existsSync(fullPath)) throw new Error('Document file is unavailable')
    const bytes = this.crypto.decrypt(fs.readFileSync(fullPath))
    this.audit.insert(userId, 'ADMISSION_DOCUMENT_VIEWED', 'admission_documents', documentId,
      `Viewed document for admission ${admissionId}`)
    return { originalFilename: row.original_filename, mimeType: row.mime_type, contentBase64: bytes.toString('base64') }
  }

  remove(admissionId: number, documentId: number, userId: number): void {
    this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE admission_documents SET is_active = 0
        WHERE id = ? AND admission_id = ? AND is_active = 1
      `).run(documentId, admissionId)
      if (!result.changes) throw new Error('Document not found')
      this.audit.insert(userId, 'ADMISSION_DOCUMENT_REMOVED', 'admission_documents', documentId,
        'Document removed from active admission view; encrypted file retained')
    })()
  }

  private getDocumentRow(id: number): AdmissionDocumentRow {
    const row = this.db.prepare(`
      SELECT id, category, original_filename, mime_type, file_size, uploaded_at
      FROM admission_documents WHERE id = ?
    `).get(id)
    if (!row) throw new Error('Saved document could not be verified')
    return row as unknown as AdmissionDocumentRow
  }

  private resolvePath(relativePath: string): string {
    const root = path.resolve(this.documentRoot)
    const fullPath = path.resolve(root, relativePath)
    if (!fullPath.startsWith(`${root}${path.sep}`)) throw new Error('Invalid document storage path')
    return fullPath
  }

  private matchesSignature(bytes: Buffer, mimeType: string): boolean {
    if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-'
    return mimeType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
}
