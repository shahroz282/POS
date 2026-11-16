# POS Feedback: Recommendations and Implementation Status

This document records the code-informed recommendations and their implementation status against the supplied feedback. The original findings below describe the state before this change set; use the status section for the current behavior. It is based on the renderer, IPC, services, repositories, migrations, tests, [SPEC.md](./SPEC.md), and [ARCHITECTURE.md](./ARCHITECTURE.md).

## Summary

The original analysis prioritized cash reconciliation and filer-customer access first, followed by stamp-paper corrections/reporting and photocopy. The implementation status below records what has now been delivered.

## Implementation Status

| Feedback area | Status |
|---|---|
| Daily opening balance and categorized cash-in/out | Implemented with persisted openings, audited movements, expected-cash reconciliation, and previous-day counted cash suggested (not saved automatically) as the next opening. |
| Dashboard stamp-paper amount | Implemented using the daily summary endpoint; photocopy totals are also shown. |
| Filtered stamp-paper Excel export | Implemented using the active search/date filters. |
| Bill returns and corrections | Existing inventory-sale returns remain the correction path; simple stamp transactions now support audited full cancellation/refund. Saved invoices remain immutable rather than being overwritten. Partial simple-stamp refunds and direct invoice editing are not included. |
| Optional documents and remarks | Payment information is shown before the optional document section; payment remarks remain optional. |
| Stamp-paper commission | New transactions use Commission and no new Other fee; historical fee data remains visible/exportable. |
| Filer customers | Admin-only at navigation and IPC, with a separate payment ledger. Filer billings stay out of ordinary module totals; dated, classified cash receipts appear separately in till reconciliation. Legacy advances remain unclassified where their original method/date is unavailable. |
| Photocopy service | Implemented as a non-stock service workflow with payment history, receipts, refunds, and separate reporting. |

Filer bill editing is performed through additive ledger adjustments; historical invoices are not silently rewritten. The status table describes the implemented scope, while the recommendations below preserve the original analysis and acceptance criteria.

| Original priority | Change | Original reason |
|---|---|---|
| P0 | Make opening cash and cash-in/out real, categorized ledger entries | The dashboard opening amount is currently display-only and does not affect reconciliation. |
| P0 | Restrict filer customers to Admin and separate their reporting | Filer customers are currently available to every role and included as a daily-closing module. |
| P1 | Show a daily stamp-paper summary on the dashboard | Stamp activity is calculated in reports, but has no dedicated dashboard summary card. |
| P1 | Add filtered Excel export to stamp-paper history | History already filters by text and date range; it has no export action. |
| P1 | Complete stamp-paper cancellation/refund and audited correction workflow | Normal-sale returns exist; the active stamp transaction screen has no equivalent correction workflow. |
| P1 | Rename stamp charges to Commission and remove Other fees for new transactions | The current form and schema expose both Service charges and Other fees. |
| P1 | Move optional stamp documents and remarks below payment information | Both are currently optional, but appear before the payment section. |
| P2 | Add photocopy as a non-stock service workflow | No photocopy module or data model is present. |

## Findings and Recommendations

### 1. Opening balance and cash-in/cash-out

**What exists:** The dashboard’s “Day opening” dialog saves a browser-local display amount and explicitly says it does not change Daily Closing calculations ([DashboardPage.tsx](./src/renderer/src/pages/DashboardPage.tsx)). Separately, the database has `daily_closings.opening_cash`, and the daily-closing service/repository use that value in the expected-cash formula. The main process exposes save and close IPC operations, but the Daily Closing page currently focuses on viewing reports and unlocking a day; it does not provide the opening/actual-cash workflow ([DailyClosingPage.tsx](./src/renderer/src/pages/DailyClosingPage.tsx), [daily-closing.handler.ts](./src/main/ipc/daily-closing.handler.ts), [daily-closing.repository.ts](./src/main/repositories/daily-closing.repository.ts)).

**Recommendation:**

- Remove the dashboard’s local-storage “Day opening” amount and use one persisted opening-cash value from `daily_closings`.
- Add a real start-of-day and close-of-day flow to Daily Closing. Show opening cash, cash receipts, cash-in, cash-out, cash expenses, cash refunds, expected cash, counted cash, and variance together.
- Suggest the previous day’s counted closing as the next day’s opening, while allowing an authorized user to enter a corrected opening with a required reason and audit record.
- Keep opening cash distinct from cash-in: opening is the amount already in the till at the start of the day; cash-in and cash-out are movements made during the day.
- Add cash-in/out forms and a history table. Each entry should record amount, date/time, direction, department/source, reason, user, and optional reference. Withdrawals reduce the expected counter balance; deposits increase it.
- Use the existing `cash_entries` table as a starting point, but add structured source/department and audit data through a numbered migration. Avoid relying on an unstructured `reason` string for reports.
- Do not write an extra cash entry for a sale, payment, refund, or repayment already recorded in its own ledger. That would count the same money twice.

**Acceptance checks:** A saved opening remains after restart and is the same amount shown on the dashboard and Daily Closing. A tagged cash-in increases expected cash; a tagged cash-out decreases it. A cash payment is counted once. A locked date rejects edits, and an authorized unlock is audited.

### 2. Daily stamp-paper amount on the dashboard

**What exists:** The daily-closing repository calculates stamp-paper totals from both the older inventory-based stamp tables and the active simple-transaction tables. The dashboard currently displays general sales, cash received, udhaar, expenses, opening cash, and inventory, but not a stamp-paper card ([daily-closing.repository.ts](./src/main/repositories/daily-closing.repository.ts), [DashboardPage.tsx](./src/renderer/src/pages/DashboardPage.tsx)).

**Recommendation:**

- Add a “Stamp paper today” summary using the same daily report calculation as Daily Closing rather than a second, inconsistent SQL calculation.
- Show at least billed amount and amount collected; include refunds and outstanding balance where appropriate.
- Use the current local business date and display PKR consistently.
- Provide a link to Stamp Paper history pre-filtered to today.
- Return only the summary fields appropriate to the user’s role. Do not grant cashiers access to broader reports merely to display this card.

**Acceptance checks:** The dashboard value matches the Stamp Paper module for the same date, includes both supported stamp transaction sources, and is unaffected by transactions from other dates.

### 3. Filtered Excel export for stamp-paper history

**What exists:** Stamp-paper history has a search field and from/to date filters. There is no export action in the page/API flow. The project already depends on `xlsx` and uses it for other exports ([StampPaperPage.tsx](./src/renderer/src/pages/StampPaperPage.tsx), [AdmissionsPage.tsx](./src/renderer/src/pages/AdmissionsPage.tsx), [ReportsPage.tsx](./src/renderer/src/pages/ReportsPage.tsx)).

**Recommendation:**

- Add an “Export Excel” action to the history view.
- Export the same records represented by the currently applied search and date filters—not a broader, unfiltered dataset.
- Include useful columns already shown in history: invoice, transaction date, reference, ticket, customer, registration, status, total payable, amount received, and outstanding balance.
- Include the applied date range in the worksheet title or a small header. Do not export attached documents or unrelated private data.
- Match existing export behavior and show success/error feedback; disable the action while exporting or when there are no matching records.

**Acceptance checks:** An export with a date range and search term contains only matching rows, and its totals/amount fields match the history table.

### 4. Bill returns, refunds, and editing/corrections

**What exists:** Standard inventory sales already support returns for Admin/Manager, including returned quantities, stock restoration, refund method/reason, return history, and receipt viewing. The product specification intentionally treats saved sales as immutable and uses returns for corrections ([SalesPage.tsx](./src/renderer/src/pages/SalesPage.tsx), [SPEC.md](./SPEC.md)). The active simple stamp-paper workflow supports new transactions, later payments, and document handling, but its API does not expose edit, cancel, or refund operations. A separate legacy stamp-sale API has cancellation support, so the two stamp flows should not be assumed to have identical capabilities ([api.ts](./src/shared/types/api.ts), [stamp-paper.service.ts](./src/main/services/stamp-paper.service.ts)).

**Recommendation:**

- Keep completed sales immutable. Do not silently overwrite an invoice, its payment, or its stock movement.
- Improve the existing normal-sale return flow where needed: make return action discoverable in history, clearly show remaining returnable quantities and refund amount/method, and retain the current role checks, stock restoration, audit, and idempotency guarantees.
- Add an equivalent, explicit cancellation/refund workflow for active simple stamp-paper transactions. Distinguish cancellation of an unpaid transaction from refunding money already collected.
- For mistakes that users describe as “editing,” provide an audited correction workflow: authorized user records a reason, reverses/cancels the original as appropriate, and creates a corrected transaction linked to it. Preserve the original invoice and its payment history.
- Ensure corrections respect closed-day rules and update cash reconciliation exactly once. Add corresponding receipt reprint/history details.

**Acceptance checks:** A partial or full return cannot exceed the unreturned quantity or collected amount. Retrying a return does not duplicate stock or refunds. The original invoice remains inspectable, and all corrections record user, time, reason, and linked replacement/refund.

### 5. Optional documents and remarks placement

**What exists:** Stamp-paper attachments are optional, and the remarks field is labeled optional. Both the Documents and Remarks sections currently appear before Payment Information ([StampPaperPage.tsx](./src/renderer/src/pages/StampPaperPage.tsx)).

**Recommendation:** Preserve their optional status and validation rules; move the Documents and Remarks sections below Payment Information. Label the document upload clearly as optional and keep payment fields together so the transaction can be entered without navigating around non-payment information.

**Acceptance checks:** A transaction can still be saved with no document and no remark, and the UI presents those optional sections after payment details.

### 6. Stamp-paper fee labels

**What exists:** The active form currently has Sale price, Service charges, and Other fees. Both charge fields contribute to total payable and are represented in the shared schema and database ([StampPaperPage.tsx](./src/renderer/src/pages/StampPaperPage.tsx), [stamp-paper.schema.ts](./src/shared/schemas/stamp-paper.schema.ts), [004_simple_stamp_transactions.sql](./migrations/004_simple_stamp_transactions.sql)).

**Recommendation:**

- Rename “Service charges” to “Commission” in the form, transaction detail, receipts, and exports.
- Remove “Other fees” from new-transaction entry and set no new other-fee amount.
- Preserve historical values. Use an additive migration and update schemas, service calculations, reports, receipt output, and tests together; do not rewrite an already-shipped migration or discard old transaction amounts.
- Confirm whether commission is the shop’s fee (revenue) or a pass-through charge before changing profit/report labels.

**Acceptance checks:** New stamp transactions calculate sale price plus commission only. Existing records retain their historical totals and remain readable/exportable.

### 7. Filer customers: Admin-only and separate accounting

**What exists:** Filer customer pages are currently included in the allowed-page list for every role. Their IPC handlers check authentication but do not restrict access to Admin. Filer records are also included as a module in daily-closing/report calculations; their advances are shown as unclassified because the filer record stores an `advance_paid` total rather than dated, method-specific payments ([App.tsx](./src/renderer/src/app/App.tsx), [filer-customers.handler.ts](./src/main/ipc/filer-customers.handler.ts), [daily-closing.repository.ts](./src/main/repositories/daily-closing.repository.ts), [013_filer_customers.sql](./migrations/013_filer_customers.sql)).

**Recommendation:**

- Make filer customers and their documents Admin-only in both navigation and main-process IPC authorization. Hiding a page alone is not an access control.
- Remove filer billings/advances from ordinary sales and daily business-update totals, and provide a separate Admin-only filer report and ledger.
- If filer advances must affect physical till reconciliation, record them as dated payments with a method and source, then show them as a distinct filer-cash line in the cash reconciliation—not as ordinary sales or an unclassified balance.
- Replace direct editing of `advance_paid` with payment and reversal entries so that fee due, paid-to-date, and balance are derived from history. Preserve secure document handling and audit access to sensitive filer records.

**Acceptance checks:** Cashier and Manager cannot list, search, edit, export, or read filer documents through either the UI or direct IPC calls. Filer revenue is excluded from normal sales metrics and separately reportable; physical cash received is still reconcilable without double counting.

### 8. Photocopy service

**What exists:** No photocopy page, job model, or photocopy-specific IPC/API was found. The app already has payment methods, receipts, sales, and cash-reporting patterns that can inform the feature ([SPEC.md](./SPEC.md), [api.ts](./src/shared/types/api.ts)).

**Recommendation:**

- Treat photocopy as a non-stock service sale, not an inventory purchase or a manual cash entry.
- Capture service details needed to price work: monochrome/color, page or side count, number of copies, single/duplex, unit price, optional discount, and optional customer/reference.
- Show the amount due and payment method; issue a receipt and support history/search and authorized corrections/refunds.
- Reuse the shared payment and receipt conventions. Either support non-stock service items in the existing sales pipeline or create a photocopy job linked to the shared payment ledger; do not create a second cash record for the same payment.
- Give photocopy its own dashboard/report department totals while including actual cash receipts in the common expected-cash calculation.

**Acceptance checks:** A photocopy sale is separately reportable, appears in its chosen department’s totals, contributes to expected cash only once, and can be reprinted and corrected with an audit trail.

## Suggested Delivery Order

1. **Cash foundation:** Replace the display-only opening amount, add daily start/close controls, and implement categorized cash-in/out with audit and closed-day enforcement.
2. **Access and reporting:** Restrict filer records to Admin, separate filer ledger/reporting, and define how real filer cash receipts appear in reconciliation.
3. **Stamp-paper improvements:** Add the dashboard summary and filtered Excel export; move optional documents/remarks; update fee labels with historical data preserved.
4. **Correction workflows:** Complete simple stamp cancellation/refund and improve the existing sales return UX without editing invoices in place.
5. **Photocopy:** Add the service workflow after payment and daily-cash rules are stable.

## Cross-Cutting Tests

- Add migration tests for any schema changes and retain old stamp-paper records and totals.
- Test opening balance persistence, next-day opening behavior, expected cash, categorized cash movements, duplicate-payment prevention, and locked-day rules.
- Test Admin-only filer authorization at the IPC boundary, not just page navigation.
- Test dashboard and Excel date/search filters against the same report/history data.
- Test returns/refunds for partial and full cases, retries, audit history, and cash reconciliation.
- Test photocopy totals, department reporting, receipts, refunds, and exactly-once cash accounting.

## Documentation Note

The feature-coverage table in [ARCHITECTURE.md](./ARCHITECTURE.md) describes the Dashboard, Sales, Daily Closing, and several other pages as placeholders, but the current source contains implemented dashboard data, sale/return flows, daily report logic, and related IPC/services. Refresh that table against the current code before using it as a feature-status checklist.
