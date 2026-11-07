# Schemes Management: Detailed Implementation Plan

## Purpose and project fit

Implement a complete, offline-first Schemes Management module in the existing Saqib POS desktop application. Follow the established Electron main-process, preload, IPC, Zod, repository/service, SQLite, React, and Tailwind patterns. Extend the existing `schemes`, `scheme_applications`, and shared `payments` records with forward-only migrations; preserve existing data and unrelated POS behavior.

The current Schemes page is a placeholder. The initial database already contains basic scheme folders and applications, and `payments` already has a `scheme_app_id` association. These should be extended rather than replaced or duplicated.

## Implementation status

The core module is now implemented in the repository: additive migration, scheme/application services and IPC, folder and application workflows, fee collection, payment history and reversal, local encrypted document handling, status history, dashboard totals including recent payments, and filtered XLSX export. The applicant form contains one primary phone field and deliberately has no WhatsApp or date-of-birth field. Focused migration and service tests, the full test suite, renderer type-check, and production build have passed. Full-project type-check still reports a pre-existing unsafe cast in `src/main/repositories/user.repository.ts`; lint is unavailable because the repository has no ESLint configuration.

Operational integration that depends on modules which are still placeholders remains incomplete: there is no existing backup/restore workflow to include the new document directory, and Daily Closing has not yet been implemented. Scheme payments are stored only once in the shared payments ledger and the payment service checks the existing day-lock table. Do not treat backup/restore or full day-close reporting as delivered until those modules are implemented and tested.

Scheme configuration currently supports adding categories, custom fields, and document requirements; historical definitions are retained. Editing/deactivating individual categories, custom fields, or document requirements is not yet exposed in the UI.

### Confirmed applicant-field scope

- Capture **one primary phone number** only.
- Do not add a WhatsApp number field.
- Do not add a date-of-birth field.
- Keep other optional applicant details, such as father/husband name, CNIC, address, city, and district, where useful.

### Design decisions and recommendations

- Keep application status and fee/payment status independent. Payment status is derived from charges and saved payments.
- Use a permanent application number such as `SCH-KC-2026-0001`. Generate it from a per-scheme, per-year counter inside the registration transaction. Never delete or reuse an issued number.
- Use a separate receipt-number series for payments, such as `SCHR-YYYYMMDD-0001`; never use an application number as a payment receipt.
- Continue recording collections in the existing shared `payments` table. Do not also insert a matching `cash_entries` row: that would count the same receipt twice. Cash and daily-closing reports should include cash payments from this shared ledger.
- Support Cash, Bank, Easypaisa, JazzCash, and Other. The existing shared payment table currently restricts methods to the first four, so schema evolution must preserve every existing payment, allocation, foreign key, and index while enabling Other.
- Use the fuller application workflow from the requested requirements: Received, Under Review, Submitted, Approved, Rejected, Pending Documents, Completed, and Cancelled. Define and enforce permitted transitions in the service, and record each transition in history.
- Allow Cashiers to register applications and collect payments, but reserve scheme setup, fee/discount overrides, payment reversal, and other administrative changes for Admin or Manager.
- Mask CNIC and other sensitive identity data from Cashier list/detail responses and exports. Allow full CNIC in exports only for Admin and Manager.
- The repository does not yet have a completed Daily Closing module. Scheme collections can be correctly saved and reported in the shared payment ledger now; daily-closing integration must be verified when that module is implemented.

## Existing implementation to preserve

- Electron renderer uses React and calls the main process only through typed `window.api` methods in the preload bridge.
- Main-process IPC handlers authenticate the session, validate inputs, enforce permissions, and return the shared `IpcResult<T>` envelope.
- Business rules belong in services; SQL access belongs in repositories.
- SQLite schema changes use numbered SQL migrations. The current latest migration is `010_admissions_without_sections.sql`; the next migration should be numbered `011`.
- Money is stored as integer PKR. Payment saves must use a database transaction and the existing shared payment infrastructure.
- Existing admissions and stamp-paper modules provide patterns for ledger summaries, idempotency, audit events, document handling, exports, receipts, and error presentation.
- `xlsx` is already a project dependency and is used for Excel export.

## Scope and exclusions

### Included

- Scheme folders, editable details, categories, required documents, configurable additional fields, activation/closure.
- Application registration, search, listing, profiles, editing, and controlled status transitions.
- Local document storage with validated uploads and SQLite metadata.
- Application fee and discount records, partial/full fee collection, payment history, receipts, and controlled reversals.
- Dashboard statistics, searchable/filterable reports, and Excel exports.
- Audit events, authorization, privacy controls, and migration/regression tests.

### Not included unless requested separately

- Applicant date of birth or WhatsApp number.
- Automatic online payment processing, SMS/WhatsApp messaging, or cloud synchronization.
- Automatic deletion of applicants, documents, charges, or posted financial records.
- Full daily-closing implementation; scheme payments will be stored so that it can consume them.

## Proposed data model and migration

Add a forward-only migration, tentatively `011_schemes_management.sql`. Final table/column details should be checked against the exact existing schema before writing SQL.

### Extend existing scheme folders

Extend `schemes` with the data needed for management, including:

- Unique, stable scheme code for application-number generation.
- Explicit lifecycle status (for example Active, Closed, Suspended) while preserving the existing `is_active` meaning for compatibility or migrating it consistently.
- Opening and closing dates, description, and default application fee.
- Created/updated timestamps and the user responsible for administrative changes where the existing schema does not already provide them.

Do not hardcode scheme names or categories. Existing schemes must remain accessible and receive safe, deterministic codes during migration where necessary.

### Scheme configuration tables

- `scheme_categories`: scheme-owned category options, active state, and uniqueness within a scheme.
- `scheme_custom_fields`: scheme-owned field definitions, including stable key, label, type, required flag, options/validation metadata, display order, and active state.
- `scheme_document_requirements`: scheme-owned required/optional document definitions and display order.

Validate field types and options in the main process. Do not allow arbitrary SQL, executable expressions, or filesystem paths in configurable metadata.

### Extend applications

Extend `scheme_applications` rather than replacing it. Add the missing applicant and workflow information, such as:

- Permanent unique application number.
- Father/husband name, address, city, district, and other agreed optional personal details.
- Scheme category/type, purpose, and application remarks.
- Processing status and status timestamps as needed.
- Created/updated metadata.

There must be exactly one primary mobile/phone field. Do not add `whatsapp`, alternate phone, or date-of-birth columns to the new feature schema or forms.

Add `scheme_custom_field_values` keyed to an application and field definition. Preserve values as validated text/JSON data with clear handling for field type; do not allow edits to a field definition to corrupt historical application answers.

Add `application_status_history` with prior/new status, timestamp, actor, and optional remarks. Status history is append-only.

Add an application-document metadata table with application, document category, original filename, stored relative path, MIME type, size, upload time, and actor. Store file bytes outside the database in the application user-data directory.

### Fee and payment ledger

- Record each application's agreed fee and discount in an immutable application fee charge, or in an equivalent append-only charge model. Do not silently rewrite the fee when the scheme's default changes.
- Keep posted payments in `payments` with `scheme_app_id`, a unique receipt number, payment method, reference, notes, actor, and timestamp.
- Add/retain a unique idempotency key and saved post-payment balance for scheme payments; enforce uniqueness in SQLite as well as handling retries in the service.
- Add scheme-payment allocations if the finalized fee model allows multiple charges. For a single application-fee charge, allocate every payment to that charge and ensure allocations cannot exceed the payment or charge balance.
- Extend the shared method constraint to support Other while preserving all legacy payment IDs, values, admission allocations, scheme links, and constraints. Use a tested, foreign-key-safe SQLite table migration and validate `PRAGMA foreign_key_check`; do not change the original migration.
- Reversals must be new auditable records or an equivalent append-only reversal model. Never delete or mutate the original payment to conceal a reversal.

### Application numbering and receipts

- Allocate `SCH-[SCHEME CODE]-[YEAR]-[SERIAL]` from a dedicated counter keyed by scheme and year, within the same transaction that creates the application.
- Use a separate daily counter and prefix for scheme payment receipts, such as `SCHR-YYYYMMDD-0001`.
- Cancellation does not release an application number. Applications and counters are not hard-deleted.
- Generate receipt output only from a successfully saved payment row. Receipt reprinting must read the saved historical payment and fee data.

## Implementation phases

### Phase 1 — Confirm current schema and migration compatibility

1. Recheck all current scheme, payment, counter, audit, and backup tables before migration implementation.
2. Decide the exact scheme lifecycle and application status transition rules.
3. Design migration of existing schemes/applications: preserve records, assign stable scheme codes and application numbers, and map existing statuses without losing meaning.
4. Prototype the shared `payments` table evolution with current foreign keys and admission allocations.
5. Add migration tests that start from both an empty database and representative pre-migration records.

**Exit criteria:** migration is repeatable, preserves legacy data and relationships, and leaves `PRAGMA foreign_key_check` empty.

### Phase 2 — Shared schemas, types, permissions, and IPC foundation

1. Add Zod schemas and shared row/input/result types for schemes, applications, fees, payments, documents, filters, and exports.
2. Add scheme IPC handlers following the existing authenticated handler pattern.
3. Validate every main-process input, including IDs, integers, dates, status transitions, payment methods, custom values, export requests, and document metadata.
4. Enforce role checks in the main process; renderer visibility is not an authorization boundary.
5. Add typed preload methods and `WindowApi` entries for every implemented operation.

**Exit criteria:** invalid requests are rejected at IPC, and unauthorized users cannot bypass UI restrictions.

### Phase 3 — Scheme folders and configuration

1. Implement list, create, edit, activate, close, and suspend operations.
2. Enforce unique scheme codes, valid date ranges, non-negative integer fees, and safe lifecycle changes.
3. Implement scheme-specific categories, custom-field definitions, and required-document definitions.
4. Prevent destructive edits to definitions that would erase historical answers or records; deactivate obsolete configuration instead.
5. Audit scheme and configuration changes.

**Exit criteria:** all folder/configuration actions persist locally and remain available after restart.

### Phase 4 — Applicant registration and status workflow

1. Implement application creation with scheme selection, application date, applicant name, father/husband name, one phone number, optional CNIC/address/city/district, category, purpose, custom values, and remarks.
2. Omit date of birth, WhatsApp, and alternate-phone controls and fields.
3. Generate application numbers atomically and never reuse them.
4. Implement application list, global search by application ID/name/father or husband/CNIC/phone/scheme, and filters by scheme/category/date/status/payment state.
5. Implement applicant profiles and safe edits. Record status changes in append-only history and enforce the agreed transition graph.
6. Preserve application and financial history when an application is cancelled.

**Exit criteria:** registration, search, profile, edit, and status history work with persisted records and have service-level tests.

### Phase 5 — Local document storage

1. Implement stage/commit/discard flows consistent with the existing stamp-paper document approach.
2. Accept only explicitly allowed image/PDF MIME types and extensions; validate actual file signatures, maximum size, and safe filenames on the main process.
3. Store under an application-specific directory in app user-data storage, using generated unique filenames. Never trust a renderer-supplied path or overwrite another document.
4. Store metadata and relative paths in SQLite; support list, read/view, replace, and download actions through validated IPC.
5. Restrict document access by role, audit access/replacement, and prevent path traversal.
6. Specify how scheme documents are included and verified in backup/restore before marking document backup support complete.

**Exit criteria:** documents survive restart, are scoped to the correct application, and invalid files/paths are rejected.

### Phase 6 — Fees, payments, and financial controls

1. Create an immutable application fee charge using the scheme default, with controlled per-application discount override.
2. Restrict fee/default and discount overrides to Admin/Manager; allow registration without full payment.
3. Calculate due as charges minus discounts and saved payments; do not store a mutable payment-status field as a source of truth.
4. Implement application search and fee-collection workflow with full applicant/scheme/fee/prior-payment/balance details.
5. Save payment, allocation, receipt counter, idempotency key, balance-after snapshot, and audit event in one transaction.
6. Reject zero/negative and over-balance payments; permit partial payments. Ensure duplicate clicks/retries with the same idempotency key cannot create a second payment.
7. Support Cash, Bank, Easypaisa, JazzCash, and Other with reference and remarks.
8. Reject money-entry changes dated to a locked day once daily closing is implemented; until then, document and test the integration boundary.
9. Implement Admin/Manager-controlled reversals with reason, permission checks, audit event, and preserved original receipt.

**Exit criteria:** financial totals reconcile from saved charges, discounts, payments, allocations, and reversals; failed transactions leave no partial records.

### Phase 7 — Receipts and printing

1. Add a receipt view based only on saved payment and application data.
2. Include branding, receipt number, application ID, scheme, applicant, father/husband name, CNIC subject to role, phone, application date, fee, discount, prior paid, amount received, remaining balance, method, reference, payment timestamp, and signature area.
3. Support 80 mm and A4 print layouts consistent with settings and desktop printing.
4. Offer immediate printing after successful save and historical reprinting from payment history.
5. Never display a success/receipt for a failed or unsaved payment; handle printer cancellation/errors visibly.

**Exit criteria:** reprinted receipt values match the persisted payment and balance snapshot.

### Phase 8 — Dashboard, reports, and Excel

1. Implement database-backed totals for scheme counts, applications, daily/monthly registrations, status counts, fee collection, outstanding balances, recent applications, and recent payments.
2. Implement all-application and scheme-specific lists/reports with date, category, status, and payment-state filters.
3. Add daily/monthly collection, outstanding, fully paid, partially paid, and status reports based on ledger queries.
4. Export actual database results to XLSX using the installed `xlsx` library and the existing native save-dialog pattern.
5. Include headings, date/currency formats, and report totals; prevent spreadsheet formula injection.
6. Mask CNIC for Cashiers and exclude sensitive fields from unauthorized exports.
7. Add report/export limits and useful validation for large datasets.

**Exit criteria:** dashboard and exports match independent SQLite queries and honor role-based privacy.

### Phase 9 — POS and operational integration

1. Ensure scheme collections use the shared `payments` table and are identifiable by `scheme_app_id`.
2. Ensure scheme payment summaries include all payment methods, while cash-on-hand totals include only CASH payments.
3. Do not add duplicate `cash_entries` for scheme payments. Reports should distinguish payment source/module and link application and receipt.
4. When Daily Closing is implemented, include scheme CASH payments in the expected-closing formula and locked-day checks.
5. Review backup/restore so the database and applicant-document storage are backed up and restored consistently.

**Exit criteria:** each receipt is counted exactly once in reports/cash calculations; backup/restore preserves referential and document integrity.

### Phase 10 — UI integration and usability

1. Replace the Schemes placeholder with dashboard, scheme folders, applications, application profile, fee collection/payment history, and reports views.
2. Add clear loading, empty, validation, success, and error states; disable duplicate submissions while requests are in progress.
3. Keep the existing desktop design system and navigation.
4. Provide confirmation for scheme closure, application cancellation, and payment reversal.
5. Keep forms usable at the current POS window size, with searchable dropdowns and readable tables.

**Exit criteria:** every visible action is wired to persistent data and errors are shown without silent fallbacks.

### Phase 11 — Verification and release

1. Add focused migration, repository/service, IPC authorization, and renderer workflow tests.
2. Test application ID uniqueness, counter rollback, status transitions, fee math, partial payments, discounts, idempotency, reversals, receipts, filters, exports, and sensitive-data masking.
3. Test document size/type/path validation, isolation between applicants, replacement, backup, and restore.
4. Run `npm run typecheck`, targeted tests, `npm test`, `npm run lint`, and `npm run build`; report any pre-existing failures separately.
5. Test upgrading a copy of a real database and run all existing admissions, stamp-paper, migration, and SQLite adapter tests.
6. Verify packaged Electron startup, migration execution, user-data document storage, and persistence across restarts.

**Exit criteria:** all migrations preserve existing data; focused and regression checks pass; outstanding limitations are documented.

## Suggested acceptance checklist

- [ ] One phone-number field only; no WhatsApp or date-of-birth field in UI, validation, or new schema.
- [ ] Scheme folders and their categories/fields/documents are configurable and persistent.
- [ ] Application IDs are unique, scheme-specific, permanent, and not reused after cancellation.
- [ ] Applicant search, profiles, editing, and status history use real SQLite data.
- [ ] Payment status is derived independently from application processing status.
- [ ] Partial payments, retries, discounts, Other payment method, and receipt numbering work atomically.
- [ ] Reversals preserve original financial history and are auditable.
- [ ] Each collection is counted once; scheme cash is included in future daily closing.
- [ ] Documents are validated, isolated per application, and included in backup/restore.
- [ ] Reports/Excel exports reflect database records and enforce CNIC privacy.
- [ ] Existing POS modules and legacy data remain functional after migration.
