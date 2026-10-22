# Rules for the AI agent (paste into Antigravity workspace rules)

1. Read SPEC.md and ARCHITECTURE.md before making changes. If they conflict with a request, stop and ask.
2. Work on ONE phase/step at a time. Do not build features that were not requested.
3. Follow the layers strictly: UI -> preload -> IPC (Zod) -> service -> repository -> SQLite. The UI never touches the database.
4. Money is INTEGER rupees. Never use floating point for money.
5. Any multi-step write runs inside one `db.transaction()` in a service. No partial writes.
6. Never edit an applied migration. Add a new numbered migration.
7. Validate all IPC input with Zod. Return `{ ok, data | error }`. Never trust the user id from the renderer.
8. Never store or log plain-text passwords.
9. Write Vitest tests for every service touching money, stock or udhaar, in the same step as the code.
10. Use the enums and statuses exactly as defined in SPEC.md.
11. After each step: run typecheck, lint and tests, then summarise what changed and what to test manually.
12. Do not add dependencies without saying why. Prefer the stack in ARCHITECTURE.md.
