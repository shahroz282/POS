import { contextBridge, ipcRenderer } from 'electron'
import type { WindowApi } from '@shared/types'
import type {
  PingInput, LoginInput, SetupAdminInput, CreateUserInput, UpdateUserRoleInput, DeactivateUserInput,
  ResetPasswordInput, UpdateSettingsInput, StampInventoryCreate, StampPaperSaleCreate, StampPaymentCreate,
  SimpleStampSaleCreate, AdmissionClassCreate, AdmissionPaymentCreate, AdmissionStudentCreate,
  AdmissionSlipUpdate, AdmissionDocumentCategoryType,
  SchemeApplicationCreate, SchemeApplicationStatusUpdate, SchemeCategoryCreate, SchemeCreate,
  SchemePaymentCreate, SchemeApplicationRow, SchemeUpdate, SchemeRow, SchemeDocumentCategoryType,
  SchemeApplicationSearch, SchemeApplicationUpdate,
  SchemeCustomFieldCreate, SchemeDocumentRequirementCreate,
  FilerCustomerCreate, FilerCustomerUpdate, FilerCustomerRow,
  UdhaarCustomerCreate, UdhaarCustomerRow, UdhaarEntryCreate, UdhaarRepaymentCreate,
  InventoryAdjustmentCreate, InventoryProductCreate, InventoryProductUpdate,
  InventoryPurchaseCreate, InventorySupplierCreate, SaleCreate, SaleReturnCreate,
  DailyClosingSave, DailyClosingClose, DailyClosingRange
} from '@shared/schemas'

/**
 * Exposes a typed `window.api` to the renderer via contextBridge.
 * contextIsolation = true, nodeIntegration = false — ARCHITECTURE.md §Security.
 * The renderer NEVER touches ipcRenderer directly.
 */
const api: WindowApi = {
  ping: (input: PingInput) => ipcRenderer.invoke('ping:ping', input),

  // ── Auth ────────────────────────────────────────────────────────────────
  authHasUsers: () => ipcRenderer.invoke('auth:hasUsers'),
  authSetupAdmin: (input: SetupAdminInput) => ipcRenderer.invoke('auth:setupAdmin', input),
  authLogin: (input: LoginInput) => ipcRenderer.invoke('auth:login', input),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authGetSession: () => ipcRenderer.invoke('auth:getSession'),

  // ── Users (admin only) ──────────────────────────────────────────────────
  usersList: () => ipcRenderer.invoke('users:list'),
  usersCreate: (input: CreateUserInput) => ipcRenderer.invoke('users:create', input),
  usersChangeRole: (input: UpdateUserRoleInput) => ipcRenderer.invoke('users:changeRole', input),
  usersDeactivate: (input: DeactivateUserInput) => ipcRenderer.invoke('users:deactivate', input),
  usersResetPassword: (input: ResetPasswordInput) => ipcRenderer.invoke('users:resetPassword', input),

  // ── Settings ────────────────────────────────────────────────────────────
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsUpdate: (input: UpdateSettingsInput) => ipcRenderer.invoke('settings:update', input),

  // ── Stamp paper ─────────────────────────────────────────────────────────
  stampInventoryList: (query?: string) => ipcRenderer.invoke('stamp:inventory:list', query),
  stampInventoryAdd: (input: StampInventoryCreate) => ipcRenderer.invoke('stamp:inventory:add', input),
  stampPartySearch: (query: string) => ipcRenderer.invoke('stamp:parties:search', query),
  stampSaleCreate: (input: StampPaperSaleCreate) => ipcRenderer.invoke('stamp:sales:create', input),
  stampSalesList: (query?: string, fromDate?: string, toDate?: string) => ipcRenderer.invoke('stamp:sales:list', { query, fromDate, toDate }),
  stampSaleDetail: (saleId: number) => ipcRenderer.invoke('stamp:sales:detail', { saleId }),
  stampPaymentCreate: (input: StampPaymentCreate) => ipcRenderer.invoke('stamp:payments:create', input),
  stampSaleCancel: (saleId: number, reason: string, refundMethod?: 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH') => ipcRenderer.invoke('stamp:sales:cancel', { saleId, reason, refundMethod }),
  stampDocumentStage: (input: { category: string; originalFilename: string; mimeType: string; contentBase64: string }) => ipcRenderer.invoke('stamp:documents:stage', input),
  stampDocumentDiscard: (token: string) => ipcRenderer.invoke('stamp:documents:discard', { token }),
  stampDocumentsList: (saleId: number) => ipcRenderer.invoke('stamp:documents:list', { saleId }),
  stampDocumentRead: (saleId: number, id: number) => ipcRenderer.invoke('stamp:documents:read', { saleId, id }),
  stampDocumentRemove: (saleId: number, id: number) => ipcRenderer.invoke('stamp:documents:remove', { saleId, id }),

  // ── Simple stamp transactions ──────────────────────────────────────────
  simpleStampCreate: (input: SimpleStampSaleCreate) => ipcRenderer.invoke('simple-stamp:create', input),
  simpleStampList: (query?: string, fromDate?: string, toDate?: string) => ipcRenderer.invoke('simple-stamp:list', { query, fromDate, toDate }),
  simpleStampDetail: (stampId: number) => ipcRenderer.invoke('simple-stamp:detail', { stampId }),
  simpleStampPayment: (input: StampPaymentCreate) => ipcRenderer.invoke('simple-stamp:payment', input),
  simpleStampDocumentStage: (input: { category: 'SUPPORTING'; originalFilename: string; mimeType: string; contentBase64: string }) => ipcRenderer.invoke('simple-stamp:document-stage', input),
  simpleStampDocumentDiscard: (token: string) => ipcRenderer.invoke('simple-stamp:document-discard', { token }),
  simpleStampDocumentRead: (stampId: number, id: number) => ipcRenderer.invoke('simple-stamp:document-read', { saleId: stampId, id }),
  simpleStampDocumentRemove: (stampId: number, id: number) => ipcRenderer.invoke('simple-stamp:document-remove', { saleId: stampId, id }),
  // ── Admissions ──────────────────────────────────────────────────────────
  admissionsSummary: () => ipcRenderer.invoke('admissions:summary'),
  admissionsClasses: () => ipcRenderer.invoke('admissions:classes:list'),
  admissionsClassCreate: (input: AdmissionClassCreate) => ipcRenderer.invoke('admissions:classes:create', input),
  admissionsStudentCreate: (input: AdmissionStudentCreate) => ipcRenderer.invoke('admissions:students:create', input),
  admissionsStudents: (
    query?: string, classId?: number, educationBoard?: string, paymentStatus?: string, slipStatus?: string
  ) => ipcRenderer.invoke('admissions:students:list', { query, classId, educationBoard, paymentStatus, slipStatus }),
  admissionsDetail: (admissionId: number) => ipcRenderer.invoke('admissions:students:detail', admissionId),
  admissionsSlipUpdate: (input: AdmissionSlipUpdate) => ipcRenderer.invoke('admissions:slips:update', input),
  admissionsDocumentStage: (input: {
    category: AdmissionDocumentCategoryType; originalFilename: string;
    mimeType: 'image/jpeg' | 'application/pdf'; contentBase64: string
  }) => ipcRenderer.invoke('admissions:documents:stage', input),
  admissionsDocumentCommit: (admissionId: number, token: string) =>
    ipcRenderer.invoke('admissions:documents:commit', { admissionId, token }),
  admissionsDocumentDiscard: (token: string) => ipcRenderer.invoke('admissions:documents:discard', { token }),
  admissionsDocuments: (admissionId: number) => ipcRenderer.invoke('admissions:documents:list', { admissionId }),
  admissionsDocumentRead: (admissionId: number, documentId: number) =>
    ipcRenderer.invoke('admissions:documents:read', { admissionId, documentId }),
  admissionsDocumentRemove: (admissionId: number, documentId: number) =>
    ipcRenderer.invoke('admissions:documents:remove', { admissionId, documentId }),
  admissionsPaymentCreate: (input: AdmissionPaymentCreate) => ipcRenderer.invoke('admissions:payments:create', input),
  admissionsStudentsExportExcel: (content: Uint8Array) => ipcRenderer.invoke('admissions:students:export-excel', content),

  // ── Schemes ────────────────────────────────────────────────────────────
  schemesSummary: () => ipcRenderer.invoke('schemes:summary'),
  schemesList: () => ipcRenderer.invoke('schemes:list'),
  schemesCreate: (input: SchemeCreate) => ipcRenderer.invoke('schemes:create', input),
  schemesUpdate: (input: SchemeUpdate) => ipcRenderer.invoke('schemes:update', input),
  schemesLifecycleUpdate: (schemeId: number, status: SchemeRow['lifecycle_status']) =>
    ipcRenderer.invoke('schemes:lifecycle:update', { schemeId, lifecycleStatus: status }),
  schemesCategories: (schemeId: number) => ipcRenderer.invoke('schemes:categories:list', schemeId),
  schemesCategoryCreate: (input: SchemeCategoryCreate) => ipcRenderer.invoke('schemes:categories:create', input),
  schemesCustomFields: (schemeId: number) => ipcRenderer.invoke('schemes:fields:list', schemeId),
  schemesCustomFieldCreate: (input: SchemeCustomFieldCreate) => ipcRenderer.invoke('schemes:fields:create', input),
  schemesDocumentRequirements: (schemeId: number) => ipcRenderer.invoke('schemes:document-requirements:list', schemeId),
  schemesDocumentRequirementCreate: (input: SchemeDocumentRequirementCreate) =>
    ipcRenderer.invoke('schemes:document-requirements:create', input),
  schemesApplicationCreate: (input: SchemeApplicationCreate) => ipcRenderer.invoke('schemes:applications:create', input),
  schemesApplications: (
    query?: string, schemeId?: number, status?: SchemeApplicationRow['status'],
    fromDate?: string, toDate?: string, paymentStatus?: SchemeApplicationSearch['paymentStatus']
  ) => ipcRenderer.invoke('schemes:applications:list', { query, schemeId, status, fromDate, toDate, paymentStatus }),
  schemesApplicationDetail: (applicationId: number) => ipcRenderer.invoke('schemes:applications:detail', applicationId),
  schemesApplicationUpdate: (input: SchemeApplicationUpdate) => ipcRenderer.invoke('schemes:applications:update', input),
  schemesApplicationStatus: (input: SchemeApplicationStatusUpdate) => ipcRenderer.invoke('schemes:applications:status', input),
  schemesPaymentCreate: (input: SchemePaymentCreate) => ipcRenderer.invoke('schemes:payments:create', input),
  schemesPaymentReverse: (paymentId: number, reason: string) => ipcRenderer.invoke('schemes:payments:reverse', { paymentId, reason }),
  schemesExportExcel: (content: Uint8Array) => ipcRenderer.invoke('schemes:export-excel', content),
  schemesDocumentStage: (input: { category: SchemeDocumentCategoryType; originalFilename: string; mimeType: string; contentBase64: string }) =>
    ipcRenderer.invoke('schemes:documents:stage', input),
  schemesDocumentDiscard: (token: string) => ipcRenderer.invoke('schemes:documents:discard', { token }),
  schemesDocumentCommit: (applicationId: number, token: string, replaceDocumentId?: number, requirementId?: number) =>
    ipcRenderer.invoke('schemes:documents:commit', { applicationId, token, replaceDocumentId, requirementId }),
  schemesDocuments: (applicationId: number) => ipcRenderer.invoke('schemes:documents:list', { applicationId }),
  schemesDocumentRead: (applicationId: number, documentId: number) =>
    ipcRenderer.invoke('schemes:documents:read', { applicationId, documentId }),
  schemesDocumentRemove: (applicationId: number, documentId: number) =>
    ipcRenderer.invoke('schemes:documents:remove', { applicationId, documentId }),

  // ── Filer customers ─────────────────────────────────────────────────────
  filerCustomersList: (query?: string, paymentStatus?: FilerCustomerRow['payment_status']) =>
    ipcRenderer.invoke('filer-customers:list', { query, paymentStatus }),
  filerCustomerCreate: (input: FilerCustomerCreate) => ipcRenderer.invoke('filer-customers:create', input),
  filerCustomerUpdate: (input: FilerCustomerUpdate) => ipcRenderer.invoke('filer-customers:update', input),
  filerCustomerDocumentStage: (input: {
    originalFilename: string; mimeType: 'image/jpeg' | 'image/png' | 'application/pdf'; contentBase64: string
  }) => ipcRenderer.invoke('filer-customers:documents:stage', input),
  filerCustomerDocumentCommit: (customerId: number, token: string) =>
    ipcRenderer.invoke('filer-customers:documents:commit', { customerId, token }),
  filerCustomerDocumentDiscard: (token: string) => ipcRenderer.invoke('filer-customers:documents:discard', { token }),
  filerCustomerDocuments: (customerId: number) => ipcRenderer.invoke('filer-customers:documents:list', customerId),
  filerCustomerDocumentRead: (customerId: number, documentId: number) =>
    ipcRenderer.invoke('filer-customers:documents:read', { customerId, documentId }),

  // ── Udhaar ──────────────────────────────────────────────────────────────
  udhaarAllOutstanding: () => ipcRenderer.invoke('udhaar:outstanding:list'),
  udhaarCustomers: (query?: string, status?: UdhaarCustomerRow['status']) =>
    ipcRenderer.invoke('udhaar:customers:list', { query, status }),
  udhaarCustomerCreate: (input: UdhaarCustomerCreate) => ipcRenderer.invoke('udhaar:customers:create', input),
  udhaarEntries: (customerId: number) => ipcRenderer.invoke('udhaar:entries:list', { customerId }),
  udhaarChargeCreate: (input: UdhaarEntryCreate) => ipcRenderer.invoke('udhaar:charges:create', input),
  udhaarRepaymentCreate: (input: UdhaarRepaymentCreate) => ipcRenderer.invoke('udhaar:repayments:create', input),

  // ── Inventory and normal sales ──────────────────────────────────────────
  inventorySummary: () => ipcRenderer.invoke('inventory:summary'),
  inventoryProducts: (query?: string, includeArchived?: boolean) =>
    ipcRenderer.invoke('inventory:products:list', { query, includeArchived }),
  inventoryProductCreate: (input: InventoryProductCreate) => ipcRenderer.invoke('inventory:products:create', input),
  inventoryProductUpdate: (input: InventoryProductUpdate) => ipcRenderer.invoke('inventory:products:update', input),
  inventoryProductActive: (id: number, active: boolean) => ipcRenderer.invoke('inventory:products:active', { id, active }),
  inventorySuppliers: () => ipcRenderer.invoke('inventory:suppliers:list'),
  inventorySupplierCreate: (input: InventorySupplierCreate) => ipcRenderer.invoke('inventory:suppliers:create', input),
  inventoryPurchases: () => ipcRenderer.invoke('inventory:purchases:list'),
  inventoryPurchaseCreate: (input: InventoryPurchaseCreate) => ipcRenderer.invoke('inventory:purchases:create', input),
  inventoryAdjustmentCreate: (input: InventoryAdjustmentCreate) => ipcRenderer.invoke('inventory:adjustments:create', input),
  inventoryMovements: () => ipcRenderer.invoke('inventory:movements:list'),
  salesCreate: (input: SaleCreate) => ipcRenderer.invoke('sales:create', input),
  salesList: (query?: string, fromDate?: string, toDate?: string) =>
    ipcRenderer.invoke('sales:list', { query, fromDate, toDate }),
  salesDetail: (id: number) => ipcRenderer.invoke('sales:detail', { id }),
  salesReturn: (input: SaleReturnCreate) => ipcRenderer.invoke('sales:return', input),
  dailyClosingReport: (range: DailyClosingRange) => ipcRenderer.invoke('daily-closing:report', range),
  dailyClosingSave: (input: DailyClosingSave) => ipcRenderer.invoke('daily-closing:save', input),
  dailyClosingClose: (input: DailyClosingClose) => ipcRenderer.invoke('daily-closing:close', input),
  dailyClosingUnlock: (date: string) => ipcRenderer.invoke('daily-closing:unlock', date)
}

contextBridge.exposeInMainWorld('api', api)
