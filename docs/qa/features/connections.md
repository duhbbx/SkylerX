# Connections — manual QA

Covers: new connection, edit, test, delete, duplicate, prod-flag, settings encryption.

> Run when changing: `apps/desktop/src/main/ipc/connections.ts`, `apps/desktop/src/main/db/connectionsStore.ts`, any connection UI under `packages/ui/src/components/ConnectionForm.vue`, `apps/desktop/src/main/db/settingsStore.ts`.

## Setup

- Branch / commit:
- OS:
- DB type: <!-- e.g. MySQL 8.0 local docker -->

## Happy path

### Create
- [ ] Click `+` on left tree → choose dialect → form opens with sensible defaults
- [ ] Fill host / port / user / password / default DB → "Test connection" → green toast with server version
- [ ] Save → connection appears in left tree, default collapsed
- [ ] Evidence:

### Edit
- [ ] Right-click → Edit → form shows current values populated (password masked as `••••`)
- [ ] Change name → save → tree updates without reload
- [ ] Evidence:

### Test connection (standalone, before save)
- [ ] "Test connection" with correct creds → green toast within ~3s
- [ ] Server version string is meaningful (not "unknown")
- [ ] Evidence:

### Delete
- [ ] Right-click → Delete → confirm dialog appears
- [ ] Confirm → connection gone from tree, gone from `connections:list` IPC
- [ ] Restart app → still gone (no resurrection)
- [ ] Evidence:

### Duplicate
- [ ] Right-click → Duplicate → form opens with `(copy)` suffix on name, all fields filled including password
- [ ] Save → new connection appears alongside original
- [ ] Evidence:

## Edge cases

### Validation
- [ ] Empty host → inline form validation fires, no IPC call
- [ ] Empty port → inline validation, no IPC call
- [ ] Duplicate name (same as existing connection) → red message "name already used", focus returns to name field
- [ ] Evidence:

### Wrong credentials
- [ ] Wrong password → red toast with **specific** auth error (mention "auth" or "password", not "unknown")
- [ ] Wrong host (unreachable) → red toast within 10s mentioning timeout or DNS
- [ ] Wrong port (refused) → red toast mentioning "refused" or "ECONNREFUSED"
- [ ] Wrong DB / schema name → either succeeds with empty tree or specific "database does not exist"
- [ ] Evidence:

### Prod flag
- [ ] Toggle "Production" on a connection → red badge appears on tree node
- [ ] Run a `DELETE FROM ...` against prod connection → modal demands typing connection name to confirm
- [ ] Type wrong name → button stays disabled
- [ ] Type right name → DELETE executes
- [ ] Evidence:

## Persistence regression (the big one)

### Force-kill safety
- [ ] Add a new MySQL connection (or any dialect) → save
- [ ] In a terminal: `pkill -9 Electron` (or Activity Monitor → Force Quit)
- [ ] Restart app → **connection still present, all fields intact**
- [ ] Evidence:

### Settings persistence (AI keys etc.)
- [ ] Open settings → set AI provider = DeepSeek + paste a real apiKey
- [ ] Close settings dialog
- [ ] `pkill -9 Electron` → restart app
- [ ] Open settings → provider still DeepSeek, apiKey still loaded (re-masked)
- [ ] Evidence:

### Encryption verification
- [ ] After saving settings with apiKey, inspect SQLite file (`~/Library/Application Support/SkylerX/skylerx.db` on macOS) with `sqlite3` CLI
- [ ] Open `app_settings` table → `value` column should be base64'd encrypted blob (prefix `enc:` or `plain:`), **not** raw JSON with the apiKey visible
- [ ] Evidence: paste `SELECT * FROM app_settings;` output (apiKey should NOT appear as plaintext)

## Cross-platform

- [ ] macOS: keychain integration prompt appears on first safeStorage encrypt (macOS Keychain Access shows "SkylerX" entry)
- [ ] Windows: DPAPI fallback works (no keychain prompt)
- [ ] Linux: libsecret backend (will fallback to `plain:` prefix if unavailable, with console warning) — verify no crash
- [ ] Evidence:

## Network disconnect recovery (distilled from dbeaver #6903; user-hit ECONNRESET)

- [ ] Open a connection, run a query, then drop the network / restart the DB
      server → the next query shows a **clear, specific error** (not a silent hang
      or a cryptic stack), and the app stays responsive
- [ ] After the DB comes back, running a query **reconnects** (or a single retry
      succeeds) without deleting + recreating the connection
- [ ] An idle connection the server closed (timeout) → next action transparently
      reconnects or errors clearly, doesn't loop a re-popping error dialog

## Known limitations (don't file as bugs)

- Cloud drivers (Snowflake / Redshift) may take 5-15s on first Test connection due to handshake
- Oracle thin mode requires no Instant Client; if user has it installed, behavior is unchanged
- DM driver needs `electron-rebuild` if pulling fresh — not a connection bug
