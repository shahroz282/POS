# SAQIB PHOTO STATE - Offline POS: Product Specification (v2)

Windows desktop app, one computer, fully offline. Stack: Electron + React + TypeScript + SQLite.
Currency: PKR. All money is stored as INTEGER rupees (never floats).

## 1. Roles and permissions
| Action | Admin | Manager | Cashier |
|---|---|---|---|
| Normal sale, stamp paper, admission, scheme entries | yes | yes | yes |
| Discount | any | any | up to `max_cashier_discount_percent` (default 5) |
| See purchase price / profit | yes | yes | no |
| Returns / refunds | yes | yes | no |
| Purchases, stock adjustments | yes | yes | no |
| Udhaar repayments | yes | yes | yes |
| Daily closing | yes | yes | no |
| Unlock a closed day | yes | no | no |
| Reports | yes | yes | sales only |
| Users, settings | yes | no | no |
| Backup (create) | yes | yes | no |
| Restore | yes | no | no |

## 2. Modules (original numbering)
1. Login: username + password, role-based redirect to Dashboard.
2. Dashboard: today's sales, cash received, udhaar given, expenses, low-stock count; quick actions (new sale, stamp paper, admission, scheme application, receive udhaar, cash in/out, daily report); recent transactions; alerts.
3. Normal sales: search/select item -> quantity/price -> cart -> optional discount -> optional customer -> received amount -> udhaar option -> save (atomic) -> print receipt.
4. Stamp paper: bank employee name, customer name, price, register number, status, remarks, save, optional receipt. Separate from inventory.
5. Admissions: class folders (9th, 10th, add folder) -> add/search student -> admission details -> save -> collect fee -> receipt -> Excel export.
6. Schemes: scheme folders (e.g. CM APNA GHAR 2026, add folder) -> add/search application -> details (date, CNIC, mobile, category) -> application fee -> status -> remarks -> save -> payment -> receipt -> Excel export.
7. Daily closing: opening cash, cash in/out, sales cash, refunds, expenses, expected vs actual closing cash, day lock, date-range reports.
8. Udhaar: customer ledger, charges, repayments, outstanding balance, history, reminders.
9. Stock and inventory: categories, products, purchases, stock movements, returns, low-stock alerts, profit report.
10. Reports: sales, profit, stock, udhaar, customer, admissions, schemes; export Excel/PDF.
11. Settings: shop details, receipt format, users, tax/discount rules, backup settings.
12. Backup and restore: manual, automatic, external USB, restore with verification, history.

## 3. Status enums (single source of truth)
- Role: ADMIN, MANAGER, CASHIER
- SaleStatus: COMPLETED, PARTIAL (unpaid balance moved to udhaar), RETURNED (fully returned)
- UdhaarType: CHARGE, REPAYMENT
- StampStatus: PENDING, COMPLETED, CANCELLED
- AdmissionStatus: ACTIVE, COMPLETED, CANCELLED
- SchemeStatus: PENDING, APPROVED, REJECTED, CANCELLED
  - PENDING -> APPROVED | REJECTED; APPROVED -> CANCELLED. REJECTED and CANCELLED are final.
  - Fee payment is NOT a status. It is derived from the `payments` table.
- PayMethod: CASH, BANK, EASYPAISA, JAZZCASH
- CashType: CASH_IN, CASH_OUT
- MoveType: PURCHASE, SALE, RETURN, ADJUSTMENT
- BackupStatus: SUCCESS, FAILED

## 4. Business rules (defaults; change here first, then in code)
1. A saved sale is immutable. Corrections are done only through a Sale Return.
2. Negative stock is not allowed (setting `allow_negative_stock`, default 0).
3. Udhaar requires a named customer (no walk-in udhaar).
4. Udhaar balance is never stored. balance = SUM(CHARGE) - SUM(REPAYMENT) from `udhaar_entries`.
5. Saving a sale is ONE database transaction: sale + items + stock movements + payment + udhaar entry + invoice number. Any failure rolls back everything.
6. A closed day (`daily_closings.is_locked = 1`) rejects new or changed money entries dated that day. Only Admin can unlock (logged in `audit_logs`).
7. Receipt numbers use separate series per module: INV, STP, ADM, SCH. Format `PREFIX-YYYYMMDD-0001`, generated inside the saving transaction from the `counters` table.
8. Every payment links to exactly one of: sale, stamp transaction, admission, scheme application.
9. Passwords are hashed (argon2 or bcrypt). Never stored or logged in plain text.
10. Important actions are written to `audit_logs` (login, sale return, stock adjustment, day unlock, restore, user changes, settings changes).

## 5. Cash formula (daily closing)
expected_closing = opening_cash + cash payments received (all modules) + CASH_IN entries
                   - CASH_OUT entries - cash refunds - expenses paid in cash
difference = actual_closing - expected_closing (shown to user, stored on lock)

## 6. Out of scope for v1
Multi-computer sync, online payments, barcode label printing, multi-branch, customer-facing display.
