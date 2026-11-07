import type {
  PingInput, PingOutput,
  LoginInput, LoginOutput, SetupAdminInput, SessionUser,
  CreateUserInput, UpdateUserRoleInput, DeactivateUserInput, ResetPasswordInput, UserRow,
  UpdateSettingsInput, StampInventoryCreate, StampInventoryRow, StampPaperSaleCreate,
  StampPaymentCreate, StampSaleListRow, StampSaleDetail, StampDocumentRow, StampPartySummary,
  SimpleStampSaleCreate, SimpleStampSaleRow, SimpleStampSaleDetail, SimpleStampDocumentRow
} from '../schemas'
import type {
  AdmissionClassCreate, AdmissionDetail, AdmissionPaymentCreate, AdmissionPaymentResult,
  AdmissionStudentCreate, AdmissionStudentRow, AdmissionClassRow, AdmissionSlipUpdate,
  AdmissionDocumentCategoryType, AdmissionDocumentRow
} from '../schemas'
import type {
  SchemeApplicationCreate, SchemeApplicationDetail, SchemeApplicationRow, SchemeApplicationStatusUpdate,
  SchemeCategoryCreate, SchemeCreate, SchemePaymentCreate, SchemePaymentResult, SchemeRow, SchemesSummary,
  SchemeUpdate, SchemeDocumentRow, SchemeDocumentCategoryType, SchemeCustomFieldCreate,
  SchemeDocumentRequirementCreate, SchemeApplicationSearch, SchemeApplicationUpdate
} from '../schemas'
import type {
  FilerCustomerCreate, FilerCustomerDocumentRow, FilerCustomerRow, FilerCustomerUpdate
} from '../schemas'
import type {
  UdhaarCustomerCreate, UdhaarCustomerRow, UdhaarEntryCreate, UdhaarEntryRow, UdhaarOutstandingGroup,
  UdhaarRepaymentCreate, UdhaarRepaymentResult
} from '../schemas'

/** Generic IPC result envelope — ARCHITECTURE.md §IPC conventions */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

/**
 * The typed window.api surface exposed via contextBridge.
 * Add new channels here as features are implemented.
 */
export interface WindowApi {
  ping: (input: PingInput) => Promise<IpcResult<PingOutput>>

  // ── Auth ────────────────────────────────────────────────────────────────
  authHasUsers: () => Promise<IpcResult<{ hasUsers: boolean }>>
  authSetupAdmin: (input: SetupAdminInput) => Promise<IpcResult<LoginOutput>>
  authLogin: (input: LoginInput) => Promise<IpcResult<LoginOutput>>
  authLogout: () => Promise<IpcResult<null>>
  authGetSession: () => Promise<IpcResult<SessionUser | null>>

  // ── Users (admin only) ──────────────────────────────────────────────────
  usersList: () => Promise<IpcResult<Array<Omit<UserRow, 'password_hash'>>>>
  usersCreate: (input: CreateUserInput) => Promise<IpcResult<{ id: number }>>
  usersChangeRole: (input: UpdateUserRoleInput) => Promise<IpcResult<null>>
  usersDeactivate: (input: DeactivateUserInput) => Promise<IpcResult<null>>
  usersResetPassword: (input: ResetPasswordInput) => Promise<IpcResult<null>>

  // ── Settings ────────────────────────────────────────────────────────────
  settingsGet: () => Promise<IpcResult<{ shop_name: string; receipt_width_mm: string; max_cashier_discount_percent: string }>>
  settingsUpdate: (input: UpdateSettingsInput) => Promise<IpcResult<null>>

  // ── Stamp paper ─────────────────────────────────────────────────────────
  stampInventoryList: (query?: string) => Promise<IpcResult<StampInventoryRow[]>>
  stampInventoryAdd: (input: StampInventoryCreate) => Promise<IpcResult<{ id: number }>>
  stampPartySearch: (query: string) => Promise<IpcResult<StampPartySummary[]>>
  stampSaleCreate: (input: StampPaperSaleCreate) => Promise<IpcResult<StampSaleListRow>>
  stampSalesList: (query?: string, fromDate?: string, toDate?: string) => Promise<IpcResult<StampSaleListRow[]>>
  stampSaleDetail: (saleId: number) => Promise<IpcResult<StampSaleDetail>>
  stampPaymentCreate: (input: StampPaymentCreate) => Promise<IpcResult<{ receiptNumber: string }>>
  stampSaleCancel: (saleId: number, reason: string, refundMethod?: 'CASH' | 'BANK' | 'EASYPAISA' | 'JAZZCASH') => Promise<IpcResult<null>>
  stampDocumentStage: (input: { category: string; originalFilename: string; mimeType: string; contentBase64: string }) => Promise<IpcResult<{ token: string; originalFilename: string; mimeType: string; fileSize: number }>>
  stampDocumentDiscard: (token: string) => Promise<IpcResult<null>>
  stampDocumentsList: (saleId: number) => Promise<IpcResult<StampDocumentRow[]>>
  stampDocumentRead: (saleId: number, id: number) => Promise<IpcResult<{ originalFilename: string; mimeType: string; contentBase64: string }>>
  stampDocumentRemove: (saleId: number, id: number) => Promise<IpcResult<null>>

  // ── Simple stamp transactions ──────────────────────────────────────────
  simpleStampCreate: (input: SimpleStampSaleCreate) => Promise<IpcResult<SimpleStampSaleRow>>
  simpleStampList: (query?: string, fromDate?: string, toDate?: string) => Promise<IpcResult<SimpleStampSaleRow[]>>
  simpleStampDetail: (stampId: number) => Promise<IpcResult<SimpleStampSaleDetail>>
  simpleStampPayment: (input: StampPaymentCreate) => Promise<IpcResult<{ receiptNumber: string }>>
  simpleStampDocumentStage: (input: { category: 'SUPPORTING'; originalFilename: string; mimeType: string; contentBase64: string }) => Promise<IpcResult<{ token: string; originalFilename: string; mimeType: string; fileSize: number }>>
  simpleStampDocumentDiscard: (token: string) => Promise<IpcResult<null>>
  simpleStampDocumentRead: (stampId: number, id: number) => Promise<IpcResult<{ originalFilename: string; mimeType: string; contentBase64: string }>>
  simpleStampDocumentRemove: (stampId: number, id: number) => Promise<IpcResult<null>>

  // ── Admissions ──────────────────────────────────────────────────────────
  admissionsSummary: () => Promise<IpcResult<{ activeStudents: number; newThisMonth: number; collectedToday: number; collectedThisMonth: number; outstanding: number; pendingDues: number }>>
  admissionsClasses: () => Promise<IpcResult<AdmissionClassRow[]>>
  admissionsClassCreate: (input: AdmissionClassCreate) => Promise<IpcResult<{ id: number }>>
  admissionsStudentCreate: (input: AdmissionStudentCreate) => Promise<IpcResult<{ admissionId: number; studentId: number; studentNo: string }>>
  admissionsStudents: (
    query?: string, classId?: number, educationBoard?: string,
    paymentStatus?: AdmissionStudentRow['payment_status'],
    slipStatus?: AdmissionStudentRow['slip_status']
  ) => Promise<IpcResult<AdmissionStudentRow[]>>
  admissionsDetail: (admissionId: number) => Promise<IpcResult<AdmissionDetail>>
  admissionsSlipUpdate: (input: AdmissionSlipUpdate) => Promise<IpcResult<null>>
  admissionsDocumentStage: (input: {
    category: AdmissionDocumentCategoryType; originalFilename: string;
    mimeType: 'image/jpeg' | 'application/pdf'; contentBase64: string
  }) => Promise<IpcResult<{ token: string; originalFilename: string; mimeType: string; fileSize: number }>>
  admissionsDocumentCommit: (admissionId: number, token: string) => Promise<IpcResult<AdmissionDocumentRow>>
  admissionsDocumentDiscard: (token: string) => Promise<IpcResult<null>>
  admissionsDocuments: (admissionId: number) => Promise<IpcResult<AdmissionDocumentRow[]>>
  admissionsDocumentRead: (admissionId: number, documentId: number) => Promise<IpcResult<{
    originalFilename: string; mimeType: string; contentBase64: string
  }>>
  admissionsDocumentRemove: (admissionId: number, documentId: number) => Promise<IpcResult<null>>
  admissionsPaymentCreate: (input: AdmissionPaymentCreate) => Promise<IpcResult<AdmissionPaymentResult>>
  admissionsStudentsExportExcel: (content: Uint8Array) => Promise<IpcResult<{ saved: boolean }>>

  // ── Schemes ─────────────────────────────────────────────────────────────
  schemesSummary: () => Promise<IpcResult<SchemesSummary>>
  schemesList: () => Promise<IpcResult<SchemeRow[]>>
  schemesCreate: (input: SchemeCreate) => Promise<IpcResult<{ id: number }>>
  schemesUpdate: (input: SchemeUpdate) => Promise<IpcResult<null>>
  schemesLifecycleUpdate: (schemeId: number, status: SchemeRow['lifecycle_status']) => Promise<IpcResult<null>>
  schemesCategories: (schemeId: number) => Promise<IpcResult<Array<{ id: number; name: string }>>>
  schemesCategoryCreate: (input: SchemeCategoryCreate) => Promise<IpcResult<{ id: number }>>
  schemesCustomFields: (schemeId: number) => Promise<IpcResult<Array<{ id: number; field_key: string; label: string; field_type: string; options_json: string | null; is_required: number }>>>
  schemesCustomFieldCreate: (input: SchemeCustomFieldCreate) => Promise<IpcResult<{ id: number }>>
  schemesDocumentRequirements: (schemeId: number) => Promise<IpcResult<Array<{ id: number; name: string; is_required: number }>>>
  schemesDocumentRequirementCreate: (input: SchemeDocumentRequirementCreate) => Promise<IpcResult<{ id: number }>>
  schemesApplicationCreate: (input: SchemeApplicationCreate) => Promise<IpcResult<{ applicationId: number; applicationNo: string }>>
  schemesApplications: (
    query?: string, schemeId?: number, status?: SchemeApplicationRow['status'],
    fromDate?: string, toDate?: string, paymentStatus?: SchemeApplicationSearch['paymentStatus']
  ) => Promise<IpcResult<SchemeApplicationRow[]>>
  schemesApplicationDetail: (applicationId: number) => Promise<IpcResult<SchemeApplicationDetail>>
  schemesApplicationUpdate: (input: SchemeApplicationUpdate) => Promise<IpcResult<null>>
  schemesApplicationStatus: (input: SchemeApplicationStatusUpdate) => Promise<IpcResult<null>>
  schemesPaymentCreate: (input: SchemePaymentCreate) => Promise<IpcResult<SchemePaymentResult>>
  schemesPaymentReverse: (paymentId: number, reason: string) => Promise<IpcResult<null>>
  schemesExportExcel: (content: Uint8Array) => Promise<IpcResult<{ saved: boolean }>>
  schemesDocumentStage: (input: {
    category: SchemeDocumentCategoryType
    originalFilename: string; mimeType: string; contentBase64: string
  }) => Promise<IpcResult<{ token: string; originalFilename: string; mimeType: string; fileSize: number }>>
  schemesDocumentDiscard: (token: string) => Promise<IpcResult<null>>
  schemesDocumentCommit: (applicationId: number, token: string, replaceDocumentId?: number, requirementId?: number) => Promise<IpcResult<SchemeDocumentRow>>
  schemesDocuments: (applicationId: number) => Promise<IpcResult<SchemeDocumentRow[]>>
  schemesDocumentRead: (applicationId: number, documentId: number) => Promise<IpcResult<{ originalFilename: string; mimeType: string; contentBase64: string }>>
  schemesDocumentRemove: (applicationId: number, documentId: number) => Promise<IpcResult<null>>

  // ── Filer customers ─────────────────────────────────────────────────────
  filerCustomersList: (query?: string, paymentStatus?: FilerCustomerRow['payment_status']) => Promise<IpcResult<FilerCustomerRow[]>>
  filerCustomerCreate: (input: FilerCustomerCreate) => Promise<IpcResult<{ id: number }>>
  filerCustomerUpdate: (input: FilerCustomerUpdate) => Promise<IpcResult<null>>
  filerCustomerDocumentStage: (input: {
    originalFilename: string; mimeType: 'image/jpeg' | 'image/png' | 'application/pdf'; contentBase64: string
  }) => Promise<IpcResult<{ token: string; originalFilename: string; mimeType: string; fileSize: number }>>
  filerCustomerDocumentCommit: (customerId: number, token: string) => Promise<IpcResult<FilerCustomerDocumentRow>>
  filerCustomerDocumentDiscard: (token: string) => Promise<IpcResult<null>>
  filerCustomerDocuments: (customerId: number) => Promise<IpcResult<FilerCustomerDocumentRow[]>>
  filerCustomerDocumentRead: (customerId: number, documentId: number) => Promise<IpcResult<{
    originalFilename: string; mimeType: string; contentBase64: string
  }>>

  // ── Udhaar ──────────────────────────────────────────────────────────────
  udhaarAllOutstanding: () => Promise<IpcResult<UdhaarOutstandingGroup[]>>
  udhaarCustomers: (query?: string, status?: UdhaarCustomerRow['status']) => Promise<IpcResult<UdhaarCustomerRow[]>>
  udhaarCustomerCreate: (input: UdhaarCustomerCreate) => Promise<IpcResult<{ id: number }>>
  udhaarEntries: (customerId: number) => Promise<IpcResult<UdhaarEntryRow[]>>
  udhaarChargeCreate: (input: UdhaarEntryCreate) => Promise<IpcResult<{ id: number; balance: number }>>
  udhaarRepaymentCreate: (input: UdhaarRepaymentCreate) => Promise<IpcResult<UdhaarRepaymentResult>>
}
