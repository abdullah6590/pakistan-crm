# Project Log — Pakistan CRM

This is the running record of what has been done, where things stand and what comes next.
Claude reads it at the start of every session (it is linked from `CLAUDE.md`) and updates it after every piece of work.
No passwords, keys, passphrases or customer data are written here.

**Last updated:** 2026-10-23 (sale bills: edit, print/PDF, new customer, input fixes)

---

## 1. Rules that always apply (owner instructions)

- `U2024-21-Oct-26-08-40.bak`, `dev.db` and `test.db` must never change. They are checked by SHA-256: `.bak` `60ebe74d…`, `dev.db` `0f435940…`, `test.db` `4d8c834a…`.
- No restoring over a live database, no destructive database operations, no live database switch.
- No legacy financial data is imported until the acceptance tests and a migration plan are approved.
- No production deployment, production service or public hosting without the owner's approval.
- Ask before installing software, changing machine settings or environment variables, or running migrations. The one exception is T-1: the desktop toolchain is approved, for building and testing only.
- Check `git status` before working. Never reset, stash or discard the owner's changes. Nothing is committed unless the owner asks.
- Never delete unsynchronised local records automatically. Deactivate rather than delete.
- The screenshot business (cups, glass, lids) is a separate business and is never merged with U2024.
- Ask the owner only for real business decisions, accounts or credentials, hardware or network setup, or production approval.
- Never claim a test passed unless it was actually run and passed.

## 2. Current state (as of 2026-10-23)

| Area | State |
|---|---|
| Audit and offline-first programme, Phases 0–9 | Complete. Reports are in `audit-reports/`: 01–15 (audit) and 20–26 (offline-first) |
| Final test gate (re-run 2026-10-23 after single-instance work) | vitest 154/154; type check 0 errors; lint clean; build OK; HTTP/CLI suites all pass: workflows 27, security 21, offline 10, office 5, backup 7, Drive 5, restore 7, tenant restore 3, multi-tenant 6 |
| Working database | `crm.db`: a clean development and acceptance database (`.env.local` points to it; the old setting is in `.env.local.before-crm-db`). It holds one admin account, the owner's, with the e-mail changed to the owner's Gmail on 2026-10-22. The owner reset its password with `scripts/reset-password.ts` on 2026-10-23 (audited, backup in `backups/`); the hash is now `efcbdc7c…` |
| Desktop app (Windows) | **0.1.3** = 0.1.2 plus the page-cache fix (D-036: after an upgrade the login page showed without styling because the old version's saved pages linked to old style files; the app now clears that cache on every start and the installer clears it before installing). Installer: `desktop/src-tauri/target/release/bundle/nsis/Pakistan CRM_0.1.3_x64-setup.exe` (SHA-256 `a591fa30…`). Installed-copy tests: installer 7/8 (U-04 fails only because an in-place upgrade from 0.1.0 followed by uninstall leaves 0.1.0's old program files, no data), instance 10/10, smoke 7/7. Testers upgrade with "Do not uninstall" (Report 27 §6). Older installers kept; never distribute 0.1.0. Owner's own copy: 0.1.2 in the scratchpad `install-test` folder; move steps in Report 25 §2 |
| Backups for `crm.db` | Set to go to `D:\PakistanCRM-Backups`, daily at 02:00 plus hourly when something changes. They stay **off** until the owner sets a passphrase |
| Google Drive backup | Built and tested against an imitation of Google only. Do not rely on it until a real Google sign-in, upload and restore have been verified |
| Sales module (legacy screens) | Bills can be edited after saving (`src/lib/sales/bill.ts`): the old bill is undone (stock, customer charge, Finance income) and the corrected one applied in one transaction; same invoice number; audited (AuditLog entity `Sale`, action `AMEND`). Bill page: Edit, Print (print window offers Save as PDF), Download PDF (`/api/sales/[id]/pdf`). New sale: product list closes after picking; "Create new customer" in the customer search; quantity/price boxes select on click and drop leading zeros. pdfkit is now loaded unbundled (`serverExternalPackages`), which also fixes the PDF reports |
| Hosting / production | Not decided. Nothing has been deployed |
| Git | Nothing from this programme has been committed |

### Owner decisions already made (2026-10-22)
- **A-1:** The owner account is the owner's own (the former `vendor1@example.com` account). Its e-mail was changed with the same user ID, password hash and role.
- **D-1:** Start from a fresh, clean database (`crm.db`).
- **D-2:** Whoever creates a stock issue or stock count cannot approve it. The only exception is an owner override through `scripts/approval-override.ts`, which needs a reason, is audited and is currently **off**. Overrides are listed in Reports → "Own-approval overrides".
- **D-3:** Reserved number blocks for the office server are on by default (`CRM_HUB_NUMBER_SERIES`).
- **D-4:** `db:reset` and seed only work on `*.scratch.db` / `*.sandbox.db`, with `CRM_CONFIRM_RESET=<name>`. They are refused in production.
- **T-1:** The Windows desktop toolchain is approved, for building and testing only.

## 3. Waiting on the owner

- [x] ~~Log in with the new e-mail~~: the owner's screenshots of 2026-10-23 17:35 show them signed in on the website (`localhost:3000`, `crm.db`) with the owner's Gmail address, as ADMIN.
- [ ] **Move own desktop copy to 0.1.3** (Report 25 §2): uninstall 0.1.0 *without* ticking "Delete the application data", then install 0.1.3 into `C:\Users\s\AppData\Local\Pakistan CRM`.
- [ ] Send 0.1.3 to business-owner testers (guide: Report 27). It is unsigned, so SmartScreen will warn.
- [ ] **Turn backups on:** Books → Backups → enter and save a passphrase, tick "Automatic backups on", Save settings, Back up now. Then run the restore drill (`scripts/restore-drill.ts`) on the real backup.
- [ ] Code-signing certificate, before the desktop app is shared with other businesses.
- [ ] Google Cloud project for the real Drive backup (G-1…G-6).
- [ ] Hosting decision (H-1) and go-live approval (S-1).
- [ ] Office server on real hardware and network (L-1…L-5); printer test (P-1).

## 4. Next changes (offered or planned, not started)

- Desktop: a setup screen for the device role (today `desktop.json` is edited by hand), auto-update, code signing.
- Desktop: old program files left after in-place upgrade + uninstall (U-04). Fix: in the PREINSTALL hook, close the app (CheckIfAppIsRunning) and remove `$INSTDIRpp` and `$INSTDIR
ode` only when `$INSTDIRpppp-entry.cjs` exists; same in uninstall. D-030 route-cache leftovers are fixed in 0.1.3.
- Optional: delete the leftover `crm-accounting-test-*` folders in `%TEMP%` (from unit tests; harmless).
- **Needs an owner decision (financial):** in the legacy Sales module the customer ledger shows the "Charge for Sale" record of a credit sale as a payment received (it cancels the sale), and deleting a sale only returns stock (its customer charge and Finance income stay). Bill editing mirrors what creating a bill does, so it does not make either worse. Fix only with the owner's agreement.
- Pre-existing lint errors (2) in `new-sale-client.tsx` search effects (setState in effect); behaviour is fine.

## 5. Useful facts for the next session

- **Desktop rebuild:** `cd desktop && npm run build && npm run smoke`. PATH needs `%USERPROFILE%\.cargo\bin`.
- **Desktop data location:** `%APPDATA%\pk.pakistancrm.desktop\`, holding `data\crm.db`, `logs\` and `desktop.json`.
- Each desktop install has its own empty database. The first person to register becomes the admin.
- The desktop app runs on a random free port on 127.0.0.1, uses its own Node.js, and its server stops when the window closes.
- The Bash tool cannot start when the working directory is inside `desktop/` (EPERM). `cd` into it inside the command instead.
- Bash heredocs lose backslashes. Write patch files with the Write tool.
- **Desktop tests:** `node desktop/instance-test.mjs [exe] [installed]` (I-01…I-10) and `node desktop/installer-test.mjs <0.1.0-setup> <new-setup> <test-edition-setup>` (U-01…U-06). The installer test exports and restores the owner's HKCU registration and shortcuts. The test edition is built with `npx tauri build --config <json with identifier pk.pakistancrm.uninstalltest, productName "Pakistan CRM Uninstall Test">` and moved out of `bundle/nsis` afterwards. Copies of the old installer and the test edition are in the scratchpad `installers/` folder.
- **Never run tests from `desktop/bundle/app` before packaging:** the server writes `$` page-cache folders into it (D-031). `check-bundle.mjs` now refuses; rebuild with `npm run build`.
- **NSIS `/D=` must not be quoted** and must be last. Node quotes arguments with spaces, so use install folders without spaces (D-033). The uninstaller returns at once and finishes from a temp copy, so wait for its registry entry to disappear.
- NSIS dialogs show up only as "panes" in UI Automation. Drive them with BM_SETCHECK and WM_COMMAND sent to the button's parent (`desktop/uninstall-ui.ps1`).
- Runtime file paths need `/* turbopackIgnore: true */`. Without it, the standalone build copies the whole project (databases included).
- libsql keeps database files locked on Windows, so any file swap must run in a fresh process.
- The audit log is append-only (database triggers). Fix mistakes with a correction entry, never with UPDATE.

## 6. Change history

| Date | What was done |
|---|---|
| 2026-10-21 | Audit of the legacy U2024 backup and the existing CRM; Reports 01–15; owner decisions recorded |
| 2026-10-22 | Offline-first Phases 0–9: tenancy, offline work, sync, office server, numbering, encrypted backups, Google Drive (imitation), restore and recovery, production readiness. Reports 20–26 |
| 2026-10-22 | Owner's 7-point decisions: e-mail changed in `crm.db` (backup first, audited); D-2 own-approval block plus override script and report; D-3 hub number blocks; D-4 reset guard; backup settings saved for `crm.db` |
| 2026-10-23 | Desktop app (Tauri) built, installed, smoke-tested and uninstalled cleanly. Defects D-026 to D-029 fixed; D-030 open (cosmetic). Full gate re-run: all pass |
| 2026-10-23 | Added `scripts/reset-password.ts` (forgotten password: hidden prompt, backup first, audited); tested on a scratch copy only |
| 2026-10-23 | The owner installed the desktop app on their PC to test it. This log was created |
| 2026-10-23 | The owner reset their `crm.db` password with `scripts/reset-password.ts` (audited, backup first) |
| 2026-10-23 | **Desktop 0.1.1:** single-instance lock per data folder (`instance.rs`): a second launch brings the window forward and exits before starting anything; no stale locks; port retry with a per-launch health token; the window shows at once. Uninstaller hook keeps business data even if "Delete the application data" is ticked (D-032) and clears the remembered install folder (D-035). Bundle check now also runs before packaging (D-031). New tests: instance 10/10, installer 8/8, smoke 6/6 on the installed copy; full gate passes. Reports 24, 25, 26 updated; Report 27 (tester guide) added. Test-tool defect D-033 (a silent reinstall of identical 0.1.0 files into the owner's folder; verified no change) fixed with guards |
| 2026-10-23 | **Sale bills** (owner request): edit after saving (stock, customer balance and Finance corrected; audited; admin or maker only), Print and Download PDF on the bill page, app sidebar/header hidden when printing, product list no longer covers the cart, "Create new customer" from the sale screen, quantity/price boxes fixed (no stuck 0/1, no leading zeros). pdfkit unbundled (PDFs were failing with a font path error). Tests: unit 159/159 (5 new), sale end-to-end 9/9, full gate passes. Desktop 0.1.2 built with them: installer 8/8, instance 10/10, smoke 7/7 on the installed copy. `crm.db` changed only through the owner's own use of the website |
| 2026-10-23 | **Desktop 0.1.3:** login page without styling after upgrading (owner report; D-036, old saved pages linked to old style files) fixed: cache cleared on start and by the installer; uninstaller removes it. Installer test now checks the login page's styles after an upgrade from a used 0.1.0 (pass). U-04 fails on leftover 0.1.0 program files (no data). Tester guide (Report 27) now says "Do not uninstall" when upgrading |
| 2026-10-23 | `README.md` rewritten for the current system (Books, offline/sync, backups, desktop app, sale-bill editing, commands, configuration, roles); old default logins and passwords removed from it |
| 2026-10-23 | Code pushed to GitHub (public repo) on a branch with a pull request; `audit-reports/` kept local only and added to `.gitignore` (owner decision) |
