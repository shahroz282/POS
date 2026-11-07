# Admissions & Fee Management: Implementation Plan

## Purpose and project fit

Implement admissions as a module inside the existing offline Saqib POS desktop app. Keep the existing Electron main-process, preload, IPC, SQLite, Zod, React 18, and Tailwind 3 architecture. Extend the existing student, class-folder, admission, and shared payment records with additive migrations; do not replace the database or create a separate application.

**Scope decision:** this plan covers student admissions and the one-time admission fee only. It does not include recurring monthly tuition, monthly dues, or tuition-fee generation. Those workflows have been removed from the UI and backend. The old `monthly_fee` database column is left unused for compatibility with existing databases; existing fee rows and unrelated POS payment functionality are preserved.

The implementation is delivered in increments. The current code is described below; items marked **Remaining** are not yet implemented and should not be assumed available in the app.

## Implemented

### Data and persistence

- Added migrations `008_admissions_fee_management.sql`, `009_admissions_only_fees.sql`, and `010_admissions_without_sections.sql` to extend existing student, class-folder, admission, and shared payment tables; enforce one-time admission-fee-only charges; and prevent new admissions from referencing sections.
- Added fee charges and payment allocations for the one-time admission fee only. Existing section tables and admission references are retained for database compatibility and historical records.
- Generated stable student IDs from existing student row IDs.
- Migrated existing admission fees into fee-charge records and allocated existing admission payments against those charges without deleting existing student or payment rows.
- Added payment idempotency keys and saved post-payment balances for receipt reprints.
- Added schema migration and admissions service tests.

### Admissions workflows

- Created class/year folders with a standard admission-fee default. The legacy `monthly_fee` column remains unused to avoid a destructive schema change.
- Registered students with guardian, contact, optional CNIC/B-Form, and previous-school information.
- Created an admission linked to the student, class, and academic year.
- Removed section creation and selection from the Admissions UI and backend.
- Searched admissions by student ID, student name, father name, phone, CNIC, B-Form, roll number, or registration number; filtered by class folder, education board, payment status, and roll-slip status.
- Captured subjects/stream and tracked official roll number, registration number, expected slip date, and the Pending → Ready to Call → Called & Informed → Slip Delivered workflow.
- Added dashboard reminders for slips due today or overdue and a WhatsApp action that opens a prepared message without sending automatically.
- Added encrypted local PDF/JPG attachments for paid bank challans, submitted admission forms, and issued roll-number slips, with manager-only access and audit events.
- Derived Paid, Partial, and Unpaid fee statuses from recorded charges and payments; included roll/slip and payment statuses in CSV/Excel exports and added print-ready filtered reports.
- Displayed fee balances, charges, discounts, allocations, and payment history in a dedicated Manage Fees view opened from each student row; this view supports payment collection and receipt reprinting.
- Removed monthly tuition configuration and generation; the class and admissions screens now focus on admissions and one-time admission fees.

### Fees and payment

- Added one-time admission fee charges with optional discounts and due dates.
- New charges are limited to the one-time admission fee. Database triggers prevent new non-admission or monthly charges while retaining existing historical rows.
- Recorded cash, bank, Easypaisa, and JazzCash payments in the existing shared `payments` table.
- Used an atomic database transaction for payment, receipt counter, allocations, and audit record.
- Allocated payments oldest-due-first across outstanding charges. Payments cannot exceed the outstanding balance, avoiding unsupported advance credits.
- Repeated submissions with the same idempotency key return the existing receipt rather than adding a second payment.
- Issued receipts and allowed reprinting from saved payment records.

### Screen, access, and export

- Replaced the Admissions placeholder with overview, students and fees, add-student, and class/session screens.
- Added single-icon popup feedback for friendly validation, error, and success messages.
- Added dashboard counts and collection/balance totals sourced from SQLite.
- Allowed cashiers to register students and collect payments, while restricting class creation and admission fee/discount overrides to Admin or Manager.
- Masked sensitive CNIC, B-Form, and address fields from cashier list/detail responses.
- Added CSV export for the currently loaded student list.
- Added audit events for class creation, admissions, and payments.

## Remaining work

### Student records and enrollment

- Add editing of student information with audit history.
- Add a dedicated profile view, including the complete contact/academic/admission record.
- Implement enrollment history as a separate model before promotion or transfer; current admission records are tied to the existing class-folder model.
- Add individual and bulk promotion, transfer, graduation, leaving, cancellation, and reactivation workflows without deleting financial history.
- Add duplicate-person checks and safe identity-number uniqueness rules if desired by the business.
- Add backup/restore coverage for encrypted admission documents. The backup screen and workflow are not implemented yet.

### Fee accounting

- Keep class folders focused on class name, academic year/session, and the one-time standard admission fee.
- Add editing of admission fee defaults and active/inactive class management; the current UI creates class folders but does not edit or deactivate them.
- Decide and implement fee-change policy for historical and future charges.
- Keep the initial fee ledger focused on the one-time admission charge, its discount, and payments against that charge.
- Add controlled reversals/refunds for posted admission payments. Posted payments currently have no reversal UI/workflow.
- Reconcile older admissions where collected payments exceed the original recorded admission fee; migration allocations intentionally cannot allocate more than that charge.
- Add validations and tests for closed-day rules when daily closing is implemented and connected to admissions payments.

### Reports and operations

- Add a dedicated due/defaulter report that classifies a charge overdue only after its due date.
- Add date, class, session, status, and payment-method report filters.
- CSV/Excel student export is available alongside print-ready filtered reports.
- Add richer report totals and payment-method summaries.
- Add dashboard trends, class distribution, recent admissions, and recent payments.
- Add A4 receipt formatting and configuration from the shop settings; current receipt print layout targets 80mm.
- Add dedicated receipt lookup/reprint independent of selecting a student.

### Verification and release

- Add UI/IPC tests for authorization, validation, receipt reprinting, and search/filter behavior.
- Validate the migration against a copy of a real, existing POS database before release.
- Test migration and payment persistence in the packaged Electron app with its actual `userData` database.
- Resolve the existing TypeScript error in `src/main/repositories/user.repository.ts` before claiming the repository-wide typecheck passes.
- Add or restore the repository’s ESLint configuration so lint checks can run.
- Do not delete, reset, or replace a user's existing database while deploying this feature.

## Recommended next phases

1. **Stabilize admission-fee accounting:** test migration on representative legacy data; reconcile legacy overpayments; implement payment reversal with audit trail.
2. **Complete student profiles:** add record editing and separate historical enrollment records before promotion/transfer features.
4. **Add school operations:** admission-fee defaulter reporting and document backup/restore coverage.
5. **Finish receipt and dashboard UX:** A4/thermal receipts, reprint lookup, and admission-focused dashboard summaries.
6. **Production validation:** test upgrades, document backup/restore, packaged startup migrations, and the full POS regression suite.

## Validation status at time of writing

- `npm test`: passed, 16 tests across 4 test files.
- `npm run build`: passed.
- `npm run typecheck`: blocked by an existing type error in `src/main/repositories/user.repository.ts` at line 35; no admissions-related TypeScript errors were reported.
- `npm run lint`: unavailable because this repository currently has no ESLint configuration.

## Related implementation files

- Database changes: `migrations/008_admissions_fee_management.sql`
- Shared validation/types: `src/shared/schemas/admissions.schema.ts`, `src/shared/types/api.ts`
- Main-process data/business logic: `src/main/repositories/admissions.repository.ts`, `src/main/services/admissions.service.ts`
- IPC/preload: `src/main/ipc/admissions.handler.ts`, `src/preload/index.ts`
- UI: `src/renderer/src/pages/AdmissionsPage.tsx`
- Tests: `tests/admissions.service.test.ts`, `tests/migrate.test.ts`
