# Safety & Production Guards — manual QA

Covers: prod-flag confirmation, dangerous-SQL guard, settings encryption, audit log.

> Run when changing: `packages/ui/src/safety/*`, `packages/ui/src/sql-linter.ts` (production rules), `apps/desktop/src/main/db/settingsStore.ts`, any production-flag UI.

## Setup

- Branch / commit:
- OS:
- Two connections: one **prod-flagged**, one not

## Prod-flag UI cue

- [ ] Prod-flagged connection in tree → red badge / dot / underline
- [ ] Hover → tooltip "Production — destructive actions require confirmation"
- [ ] Title bar / status bar shows red "PROD" marker when prod connection is active
- [ ] Evidence: screenshot of both connections in tree

## Type-to-confirm modal

Trigger destructive SQL on prod connection. Verify modal:

- [ ] `DELETE FROM users` (no WHERE) → modal appears
- [ ] Modal contents:
  - [ ] Connection name + DB name displayed
  - [ ] Affected tables listed (parsed from SQL)
  - [ ] **Type the connection name** input
  - [ ] "Confirm" button disabled until typed-name matches exactly
- [ ] Type wrong → button stays disabled
- [ ] Type right → button enables → click → SQL runs
- [ ] Cancel → modal closes, no SQL run
- [ ] Evidence:

## Dangerous SQL detection

Each of these on prod must trigger modal:

| SQL | Triggers modal? | Status |
|---|:---:|:---:|
| `DELETE FROM t` (no WHERE) | yes | [ ] |
| `DELETE FROM t WHERE 1=1` | yes (always-true WHERE) | [ ] |
| `UPDATE t SET x=1` (no WHERE) | yes | [ ] |
| `UPDATE t SET x=1 WHERE 1=1` | yes | [ ] |
| `TRUNCATE TABLE t` | yes | [ ] |
| `DROP TABLE t` | yes | [ ] |
| `DROP DATABASE d` | yes (extra strong) | [ ] |
| `DROP SCHEMA s CASCADE` | yes | [ ] |
| `ALTER TABLE t DROP COLUMN c` | yes | [ ] |
| `CREATE TABLE t (...)` | NO (additive, not destructive) | [ ] |
| `SELECT * FROM t` | NO | [ ] |
| `INSERT INTO t VALUES (...)` | NO (additive) | [ ] |

On **non-prod** connection, the same destructive SQL should still trigger a **lighter** confirmation (yellow modal, just "Are you sure?") but not type-to-confirm. Verify:

- [ ] Non-prod + `DELETE FROM t` (no WHERE) → yellow modal, single OK/Cancel
- [ ] Non-prod + `DROP TABLE t` → yellow modal, single OK/Cancel
- [ ] Evidence:

## Bypass logic

- [ ] Inside manual-commit mode → destructive SQL still triggers confirm
- [ ] After commit, re-running same destructive SQL triggers again (no "skip for session" by default)
- [ ] Settings → "Don't ask again for this session" — if exposed, verify it ONLY applies to non-prod
- [ ] Verify there is NO settings option to disable the prod confirm globally (security policy)
- [ ] Evidence:

## Settings encryption

(Detailed in `connections.md` — quick verify here)

- [ ] AI apiKey in settings → SQLite `app_settings.value` is base64'd blob, not plaintext
- [ ] Stop app → inspect `~/Library/Application Support/SkylerX/skylerx.db`:
  ```sh
  sqlite3 skylerx.db 'SELECT * FROM app_settings;'
  ```
- [ ] Output should be `enc:base64...` (or `plain:base64...` on Linux without libsecret)
- [ ] Decoded base64 (without decryption) must NOT contain the literal apiKey
- [ ] Evidence: paste output

## Sensitive data in logs

- [ ] Console logs (DevTools) during connection — connection password should NOT appear in any log
- [ ] AI request logs — apiKey should NOT appear in any log (request headers redacted)
- [ ] History store — passwords in SQL are masked (`CREATE USER ... IDENTIFIED BY '***'`)
- [ ] Evidence: scan logs after testing scenarios

## File-permissions hygiene

- [ ] Settings SQLite (`skylerx.db`) on Unix is `600` or `640`, not world-readable
- [ ] Connection-cache file (if separate) — same
- [ ] Verify with `ls -la ~/Library/Application\ Support/SkylerX/`
- [ ] Evidence: paste output

## Audit log (if shipped)

- [ ] All destructive SQL recorded in audit log with timestamp + connection + SQL
- [ ] Audit log entries signed (HMAC?) so tampering is detectable — verify via signature check
- [ ] Audit log retention (settings) — default 90 days
- [ ] Audit log export — full timeline as CSV
- [ ] Evidence:

## Network safety

- [ ] All AI requests go through main process (no renderer-direct API calls) — verify via DevTools Network panel: only Electron-internal requests, no direct fetch to anthropic.com etc. from renderer
- [ ] CORS / preflight bypass intentional (main process is not subject to browser CORS)
- [ ] Evidence:

## Update-source verification

- [ ] OSS-CN channel: server's signed `latest.yml` is verified before downloading installer
- [ ] GitHub channel: GitHub TLS cert verified, no signing skip
- [ ] If signature fails → red toast, no install
- [ ] Evidence:

## Cross-platform

- [ ] macOS: safeStorage uses Keychain; verify entry "SkylerX" appears in Keychain Access
- [ ] Windows: safeStorage uses DPAPI (per-user); not visible in any UI but works
- [ ] Linux: safeStorage uses libsecret (gnome-keyring / kwallet); falls back to `plain:` if neither
- [ ] Evidence:

## Known limitations

- "Plain" fallback on Linux (no libsecret) means apiKey on disk is base64-encoded but not encrypted at rest — by design, with console warning
- Audit log feature flag — may not be shipped in current version (`audit-log: in roadmap`)
- Sandbox enforcement: renderer process is sandboxed; preload exposes the only IPC surface — verify no node integration in renderer (DevTools console: `require` should be undefined)
