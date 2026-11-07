import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DB } from '../db/db'
import type { SchemeDocumentCategoryType, SchemeDocumentRow } from '@shared/schemas'
import { AuditLogRepository } from '../repositories/audit-log.repository'

const MAX_FILE_BYTES = 10 * 1024 * 1024
type DocumentCategory = SchemeDocumentCategoryType

interface StagedDocument {
  token: string
  category: DocumentCategory
  originalFilename: string
  mimeType: string
  bytes: Buffer
  uploadedBy: number
}

export class SchemeDocumentService {
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
    category: DocumentCategory; originalFilename: string; mimeType: string; contentBase64: string
  }, userId: number) {
    const bytes = Buffer.from(input.contentBase64, 'base64')
    if (!bytes.length || bytes.length > MAX_FILE_BYTES || bytes.toString('base64') !== input.contentBase64) {
      throw new Error('Document must be a valid file no larger than 10 MB')
    }
    if (!this.matchesSignature(bytes, input.mimeType)) throw new Error('The selected file does not match its declared type')
    const originalFilename = path.basename(input.originalFilename).replace(/[\u0000-\u001f]/g, '').slice(0, 180)
    if (!originalFilename) throw new Error('Document filename is invalid')
    const token = randomUUID()
    this.staged.set(token, { token, category: input.category, originalFilename, mimeType: input.mimeType, bytes, uploadedBy: userId })
    return { token, originalFilename, mimeType: input.mimeType, fileSize: bytes.length }
  }

  discard(token: string, userId: number): void {
    const staged = this.staged.get(token)
    if (staged && staged.uploadedBy !== userId) throw new Error('Document upload does not belong to this session')
    this.staged.delete(token)
  }

  commit(
    applicationId: number, token: string, userId: number, replaceDocumentId?: number, requirementId?: number
  ): SchemeDocumentRow {
    const document = this.staged.get(token)
    if (!document || document.uploadedBy !== userId) throw new Error('Document upload expired; select the file again')
    const application = this.db.prepare(`
      SELECT id, scheme_id, application_no FROM scheme_applications WHERE id = ?
    `).get(applicationId) as { id: number; scheme_id: number; application_no: string } | undefined
    if (!application) throw new Error('Scheme application not found')
    const extension = this.extension(document.mimeType)
    const storedFilename = `${randomUUID()}${extension}`
    const relativePath = path.join('schemes', String(application.scheme_id), application.application_no, storedFilename)
    const fullPath = this.resolvePath(relativePath)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    if (fs.existsSync(fullPath)) throw new Error('A document with this storage identifier already exists')
    const encrypted = this.crypto.encrypt(document.bytes)
    let documentId = 0
    try {
      fs.writeFileSync(fullPath, encrypted, { flag: 'wx' })
      documentId = this.db.transaction(() => {
        if (requirementId !== undefined) {
          const requirement = this.db.prepare(`
            SELECT id FROM scheme_document_requirements WHERE id = ? AND scheme_id = ? AND is_active = 1
          `).get(requirementId, application.scheme_id)
          if (!requirement) throw new Error('Select a valid document requirement for this scheme')
        }
        if (replaceDocumentId !== undefined) {
          const previous = this.db.prepare(`
            SELECT id FROM scheme_application_documents WHERE id = ? AND application_id = ? AND is_active = 1
          `).get(replaceDocumentId, applicationId)
          if (!previous) throw new Error('The document to replace was not found')
        }
        const inserted = this.db.prepare(`
          INSERT INTO scheme_application_documents (
            application_id, requirement_id, category, original_filename, stored_filename, relative_path,
            mime_type, file_size, uploaded_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(applicationId, requirementId ?? null, document.category, document.originalFilename, storedFilename,
          relativePath, document.mimeType, document.bytes.length, userId)
        const id = Number(inserted.lastInsertRowid)
        if (replaceDocumentId !== undefined) {
          this.db.prepare(`
            UPDATE scheme_application_documents SET is_active = 0, replaced_by = ? WHERE id = ?
          `).run(id, replaceDocumentId)
        }
        this.audit.insert(userId, 'SCHEME_DOCUMENT_UPLOADED', 'scheme_application_documents', id,
          `Uploaded ${document.category} for ${application.application_no}`)
        return id
      })()
    } catch (error) {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
      throw error
    }
    this.staged.delete(token)
    return this.getDocumentRow(documentId)
  }

  list(applicationId: number): SchemeDocumentRow[] {
    return this.db.prepare(`
      SELECT d.id, d.category, d.requirement_id, r.name AS requirement_name,
        d.original_filename, d.mime_type, d.file_size, d.uploaded_at
      FROM scheme_application_documents d
      LEFT JOIN scheme_document_requirements r ON r.id = d.requirement_id
      WHERE d.application_id = ? AND d.is_active = 1 ORDER BY d.uploaded_at DESC, d.id DESC
    `).all(applicationId) as unknown as SchemeDocumentRow[]
  }

  read(applicationId: number, documentId: number, userId: number) {
    const row = this.db.prepare(`
      SELECT relative_path, original_filename, mime_type
      FROM scheme_application_documents
      WHERE id = ? AND application_id = ? AND is_active = 1
    `).get(documentId, applicationId) as {
      relative_path: string; original_filename: string; mime_type: string
    } | undefined
    if (!row) throw new Error('Document not found')
    const fullPath = this.resolvePath(row.relative_path)
    if (!fs.existsSync(fullPath)) throw new Error('Document file is unavailable')
    const bytes = this.crypto.decrypt(fs.readFileSync(fullPath))
    this.audit.insert(userId, 'SCHEME_DOCUMENT_VIEWED', 'scheme_application_documents', documentId, 'Viewed applicant document')
    return { originalFilename: row.original_filename, mimeType: row.mime_type, contentBase64: bytes.toString('base64') }
  }

  remove(applicationId: number, documentId: number, userId: number): void {
    return this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE scheme_application_documents SET is_active = 0
        WHERE id = ? AND application_id = ? AND is_active = 1
      `).run(documentId, applicationId)
      if (!result.changes) throw new Error('Document not found')
      this.audit.insert(userId, 'SCHEME_DOCUMENT_REMOVED', 'scheme_application_documents', documentId,
        'Document removed from active application view; original file retained')
    })()
  }

  private getDocumentRow(id: number): SchemeDocumentRow {
    const row = this.db.prepare(`
      SELECT d.id, d.category, d.requirement_id, r.name AS requirement_name,
        d.original_filename, d.mime_type, d.file_size, d.uploaded_at
      FROM scheme_application_documents d
      LEFT JOIN scheme_document_requirements r ON r.id = d.requirement_id
      WHERE d.id = ?
    `).get(id)
    if (!row) throw new Error('Saved document could not be verified')
    return row as unknown as SchemeDocumentRow
  }

  private resolvePath(relativePath: string): string {
    const root = path.resolve(this.documentRoot)
    const fullPath = path.resolve(root, relativePath)
    if (!fullPath.startsWith(`${root}${path.sep}`)) throw new Error('Invalid document storage path')
    return fullPath
  }

  private extension(mimeType: string): string {
    const extensions: Record<string, string> = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf'
    }
    const extension = extensions[mimeType]
    if (!extension) throw new Error('Unsupported document type')
    return extension
  }

  private matchesSignature(bytes: Buffer, mimeType: string): boolean {
    if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-'
    if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    if (mimeType === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    return false
  }
}
