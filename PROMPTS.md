# Phase prompts (paste one at a time; commit to git after each works)

Models: Opus 4.6 for [DB]/[LOGIC] steps, Sonnet 4.6 for [UI] steps. Start a fresh chat per phase.

## Phase 0 [UI+setup]
Read SPEC.md, ARCHITECTURE.md, RULES.md. Scaffold Electron + Vite + React + TypeScript with Tailwind and shadcn/ui, better-sqlite3 and Vitest. Set up contextIsolation, a typed preload API, one example IPC channel with Zod validation, and the migration runner that applies migrations/001_init.sql. Create the sidebar layout with the 12 modules as empty pages. Build no features yet.

## Phase 1 [LOGIC] Auth and settings
Implement login, session in the main process, password hashing, role permissions from SPEC.md section 1, user management (admin only), shop settings. Add tests for permissions.

## Phase 2 [DB+UI] Products and inventory
Categories, products, suppliers, purchases, stock movements, low-stock alerts. Stock changes only through stock_movements. Add seed data.

## Phase 3 [LOGIC] Normal sales (most important)
sales:create as one transaction per SPEC rule 5, with receipt numbering and tests (totals, discount limits per role, stock deduction, rollback, negative-stock rule). Then build the sales screen with mock-free real IPC. Then receipt printing.

## Phase 4 [LOGIC] Udhaar
Customers, ledger entries, repayments, balance calculation, history, reminders. Tests for balance.

## Phase 5 [UI] Stamp paper    ## Phase 6 [UI] Admissions    ## Phase 7 [UI] Schemes
Build Admissions first as a reusable "folder + records + payment + receipt" pattern, then reuse it for Schemes with the SchemeStatus rules. Payments go through the shared payments service.

## Phase 8 [LOGIC] Daily closing
Cash formula from SPEC.md section 5, day lock, admin unlock with audit log.

## Phase 9 [UI] Dashboard and reports
Read-only queries over existing data, Excel/PDF export.

## Phase 10 [LOGIC] Backup and restore
db.backup(), automatic backups, USB copy, restore with integrity check and safety copy, history.

## Phase 11 Hardening
Clean Windows install test, crash log, installer, restore drill.
