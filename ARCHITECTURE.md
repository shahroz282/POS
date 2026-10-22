# Architecture

```
React UI -> preload (contextBridge) -> ipcMain handlers (Zod-validated)
         -> Services (business rules) -> Repositories -> SQLite (better-sqlite3)
```

## Layer rules
- UI never imports from main-process code and never touches the database or Node APIs.
- IPC handlers only validate input (Zod), check permission, call ONE service function, return a typed result.
- Services hold all business rules and own transactions.
- Repositories contain SQL only. No business rules.
- Shared Zod schemas and types live in `src/shared` and are used by both sides.

## Folder structure
```
src/
  main/        index.ts, window.ts, ipc/*.ts, services/*.ts, repositories/*.ts, db/(connection.ts, migrate.ts)
  preload/     index.ts   (exposes typed `window.api`)
  renderer/    app/, pages/, components/, hooks/, store/
  shared/      schemas/, types/, constants/ (enums, permissions)
migrations/    001_init.sql, 002_...
tests/         services and repository tests (Vitest)
```

## IPC conventions
- One channel per use case: `sales:create`, `sales:return`, `udhaar:recordRepayment`, `stock:adjust`, `closing:lock`.
- Every handler returns `{ ok: true, data } | { ok: false, error: { code, message } }`. Never throw raw errors to the UI.
- The current user comes from the main-process session, never from the renderer's input.

## Transactions
```ts
const saveSale = db.transaction((input: CreateSaleInput, userId: number) => {
  // 1 validate stock  2 insert sale + items  3 insert stock_movements + update products
  // 4 insert payment  5 insert udhaar_entry if unpaid  6 take invoice number from counters
  return saleId;
});
```
Use `better-sqlite3` `db.transaction()`. Do not `await` inside it. Never do partial writes outside a transaction.

## Database
- Open with `PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;`
- Migrations are numbered SQL files applied in order and recorded in `schema_migrations`. Never edit an applied migration; add a new one.
- Money = INTEGER rupees. Dates = ISO text (`YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS`, local time).

## Security
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` where possible, strict CSP, no remote content, no `eval`. Validate every IPC input. Hash passwords. Backups use SQLite's online backup API (`db.backup()`), not a raw file copy of an open database. Restore verifies the file (`PRAGMA integrity_check`) and keeps a copy of the current database before replacing it.

## Printing and exports
80mm receipts: HTML/CSS print template via `webContents.print()` (ESC/POS only if needed later). Excel: `exceljs`. PDF: `webContents.printToPDF()`.

## Packaging
`electron-builder` Windows installer. `better-sqlite3` is a native module: rebuild for Electron (`electron-builder install-app-deps` or `@electron/rebuild`). Test on a clean Windows PC.

## Testing
Vitest against an in-memory SQLite with real migrations. Required tests: sale total/discount, stock deduction, rollback on failure, udhaar balance, return restocking, day-lock rejection, receipt numbering, permission checks.
