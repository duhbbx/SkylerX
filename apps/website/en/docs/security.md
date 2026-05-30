# Security & Compliance

SkylerX targets dev / test / prod alike, with a baked-in **end-to-end security model from connection credentials through result rendering, SQL submission, and bulk export**. This page maps every line of defense actually implemented in code: what it does, what it doesn't, and what evidence it produces for ops and audit.

## 1. Overview

SkylerX's security model breaks down along the "data flow", with code-level enforcement at each stage:

| Stage | Module / file | Responsibility |
|---|---|---|
| Credential storage | `apps/desktop/src/main/db/connectionStore.ts` | Passwords / SSH keys encrypted via OS keychain (Electron `safeStorage`) |
| Environment tagging | `packages/ui/src/connEnv.ts` | dev / test / prod tri-color + read-only connections + read-only statement allowlist |
| Statement gating | `packages/ui/src/sqlLint.ts` | 7 heuristic rules (UPDATE/DELETE without WHERE, DROP/TRUNCATE on prod, etc.) |
| Display layer | `packages/ui/src/masking.ts` + `DataMaskingViewDialog` | Column-name pattern matching → render-time masking + persistent masking views |
| Governance / audit | `compliance.ts` / `PiiScannerDialog` / `DataContractDialog` / `export-encrypt.ts` | MLPS compliance checks, PII scanning, data contracts, encrypted export |

Each section below is anchored to the code.

## 2. Connection-password encryption (OS keychain)

Code: `apps/desktop/src/main/db/connectionStore.ts`

When you create/edit a connection, the password doesn't land in SQLite plaintext — it goes through Electron `safeStorage` (macOS = Keychain, Windows = DPAPI, Linux = libsecret / kwallet):

```ts
function encryptPassword(plain?: string): string | null {
  if (!plain) return null
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(plain).toString('base64')}`
  }
  return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`
}
```

Storage always carries a prefix so versions can be told apart:

| Prefix | Meaning | When seen |
|---|---|---|
| `enc:` | OS-keychain ciphertext | Normal path on macOS / Windows / most Linux |
| `plain:` | base64 fallback (**dev only**) | When `safeStorage.isEncryptionAvailable()` returns `false` — common on bare Linux containers without libsecret / kwallet |
| Other | Legacy unprefixed values | Historical data |

> **Important**: when you see `plain:`, SkylerX still works, but it's **plaintext-equivalent**. On Linux, install `gnome-keyring` or `kwallet` and then re-edit each connection (any change followed by save triggers re-encryption).

### SSH tunnel keys

SSH config has `password` / `privateKey` / `passphrase` — all go through the same encryption pipeline. The list call (`listConnections`) **strips key material before returning**, avoiding redundant in-memory copies:

```ts
function decryptSsh(stored, withSecrets) {
  const ssh = JSON.parse(decryptPassword(stored)) as SshConfig
  return withSecrets
    ? ssh
    : { ...ssh, password: undefined, privateKey: undefined, passphrase: undefined }
}
```

Full key material is restored only when actually connecting or repopulating the edit form (`getConnection`).

## 3. Environment tags dev / test / prod + production safeguards

Code: `packages/ui/src/connEnv.ts`

Connection config field `extra.env` holds a tri-state:

| Value | UI label | Color (`ENV_META.color`) | Default strictness |
|---|---|---|---|
| `dev` | Development | `#4caf50` green | Standard |
| `test` | Testing | `#e0a020` orange | Standard |
| `prod` | Production | `#e04050` red | **Extra SQL rules + pre-execution confirmation** |

### Whole-connection read-only (`extra.readOnly`)

`connReadOnly()` marks read-only connections. SkylerX gates this in two places:

1. **Whole-connection level**: `isReadOnlyStatement(sql)` uses a first-keyword allowlist (`select` / `with` / `show` / `explain` / `desc(ribe)` / `pragma`) to block write statements at the wire.
2. **Commit mode**: read-only connections are forced to `auto` commit (manual tx is meaningless for read-only); see `initialCommitMode()`.

### Production watermark

`Settings → Production watermark` lets you customize text / angle / opacity / color. On prod connections, all views (SQL editor, result grid, export preview) overlay an SVG watermark to deter screenshot leaks.

## 4. SQL Linter — 7 built-in rules

Code: `packages/ui/src/sqlLint.ts`

Heuristic string scanning — not a full parser, just hits on "obviously dangerous" patterns. Severities:

| Severity | UI feedback | Still runs? |
|---|---|---|
| `error` | Modal confirmation | Only after explicit confirm |
| `warn` | Toast | **Yes** (warning only) |
| `info` | Up to caller (e.g. badge in editor margin) | Yes |

Full rule table:

| Rule ID | Severity | Trigger | Message |
|---|---|---|---|
| `no-where-update` | error | `UPDATE` starts + no `WHERE` | UPDATE without WHERE — will update the entire table |
| `no-where-delete` | error | `DELETE FROM` + no `WHERE` | DELETE without WHERE — will empty the entire table |
| `prod-drop` | error | env=prod + `DROP TABLE/DATABASE/SCHEMA/INDEX/VIEW` | DROP XXX on production |
| `prod-truncate` | warn | env=prod + `TRUNCATE` | TRUNCATE on production |
| `cross-join` | warn | `SELECT` + `FROM a, b` (comma join) or `JOIN` without `ON/USING` | Multi-table query without join condition (suspected Cartesian product) |
| `select-star` | info | `SELECT *` | `SELECT *` — list columns explicitly |
| `forgotten-limit` | info | `SELECT` without `LIMIT` / `FETCH FIRST` / `TOP n` / `COUNT()` | SELECT without LIMIT may return a lot of data |

### The Linter is "cheap"

Comments are stripped with two regexes (`/\/\*[\s\S]*?\*\//g` and `/--[^\n]*/g`) so `-- WHERE 1=1` can't fool the linter. All rules are O(n) string scans — fast enough to run on the execution hot path.

### Multi-statement merge

`lintStatements(stmts, ctx)` keeps a finding by max severity across same-id hits — useful when you copy a whole SQL file and select-all to execute.

## 5. Data contracts (notNull / range / regex)

Code: `packages/ui/src/components/DataContractDialog.vue`

A data contract pre-declares "values that shouldn't appear" for business fields. Four parts per contract:

| Field | Type | Description |
|---|---|---|
| `name` | string | Contract name |
| `table` | string | The `schema.table` it applies to |
| `notNull` | `string[]` | Columns that must not be NULL |
| `range` | `Record<string, [min, max]>` | Numeric range; `null` = unbounded |
| `regex` | `Record<string, string>` | Regex the column value must match |
| `enabled` | boolean | Toggle |

Stored in `localStorage.skylerx.dataContracts` as a JSON array.

### Typical usage

```json
{
  "name": "users completeness",
  "table": "public.users",
  "notNull": ["phone", "email"],
  "range": { "age": [0, 150] },
  "regex": { "email": "^[^@]+@[^@]+$", "phone": "^1\\d{10}$" },
  "enabled": true
}
```

### Import / export

- **📋 Export** → copies JSON to clipboard, paste into team docs / git repo
- **📥 Import** → paste JSON to replace the current list

DBAs author contracts, then distribute to developers, where they automatically take effect in SkylerX.

## 6. Sensitive-field scanner (PII Scanner)

Code: `packages/ui/src/components/PiiScannerDialog.vue`

Two-stage heuristic: **column-name match → sample verification**.

### Column-name match

Uses `columnPattern` regexes from `DEFAULT_MASK_RULES` (next section). E.g. `user_phone` hits `(phone|mobile|tel|手机|电话)`, classified as `phone`.

### Sample verification (optional)

For matched columns, pulls the first N rows (default 50, 10-1000) and re-checks with regex:

| kind | Sample regex |
|---|---|
| `phone` | `/^\+?[\d\s\-()]{7,20}$/` |
| `email` | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| `idCard` | `/^\d{15}$\|^\d{17}[\dxX]$/` |
| `bankCard` | `/^\d{12,19}$/` |
| `name` / `address` / `default` | None — column-name only |

Hit rate < 30% is treated as "name coincidence, not actually PII" and dropped from the report.

### Report and next steps

The report groups by table sorted by hit count, with **📋 Export CSV** (columns: schema/table/column/data_type/rule/kind/sample). The CSV is ready for audit; you can also right-click a DB → "Generate masking view" picking these columns.

## 7. Data masking views (DataMaskingViewDialog)

Code: `packages/ui/src/masking.ts` + `packages/ui/src/components/DataMaskingViewDialog.vue`

### 7.1 Built-in mask rules

`DEFAULT_MASK_RULES` is the baseline; you can edit / add / remove under `Settings → Data masking`.

| Name | columnPattern | kind | Default on | Algorithm |
|---|---|---|---|---|
| Phone | `(phone\|mobile\|tel\|手机\|电话)` | phone | ✅ | First 3 + `****` + last 4 |
| Email | `(email\|mail\|邮箱)` | email | ✅ | First letter + `***@domain` |
| ID card | `(id_?card\|身份证\|idno)` | idCard | ✅ | First 6 + `*…` + last 4 |
| Bank card | `(bank_?card\|card_?no\|账号\|账户)` | bankCard | ✅ | First 4 ` **** **** ` last 4 |
| Name | `(real_?name\|user_?name\|full_?name\|姓名)` | name | ❌ | First char + `*` (rest hidden) |
| Address | `(address\|addr\|地址)` | address | ❌ | First 6 chars + `***` |
| Password / Token | `(password\|passwd\|secret\|pwd\|token\|api_?key\|密码)` | default | ✅ | First 2 + `****` + last 2 |

### 7.2 Render-time masking vs database-level masking views

SkylerX offers two independent masking paths:

- **Render-time masking**: `Settings → Data masking → Enable`. The frontend masks by column-name → rule → algorithm in real time. **Doesn't touch the database**; export dialog lets you pick "raw / masked".
- **Database masking views** (`DataMaskingViewDialog`): generate `CREATE OR REPLACE VIEW ... AS SELECT mask_expr(c) ...` SQL and land it in the DB. Apps then **read through the view, not the raw table**. Six strategies:

| Strategy | Generated SQL expression (MySQL example) |
|---|---|
| `raw` | `` `c` AS `c` `` |
| `md5` | `` md5(CAST(`c` AS char(4000))) AS `c` `` |
| `partial` | `` CONCAT(LEFT(`c`,N), '***', RIGHT(`c`,M)) AS `c` `` |
| `fixed` replace | `'***' AS \`c\`` |
| `truncate` | `` LEFT(`c`, max) AS `c` `` |
| `null` | `` NULL AS `c` `` |

The dialog suggests a strategy per column via `recommendStrategy(colName)`; the user can override per column. The generated SQL is editable before execution (▶ Create view).

## 8. MLPS 2.0 compliance check

Code: `packages/ui/src/compliance.ts` + `packages/ui/src/components/ComplianceDialog.vue`

Checks limited to "verifiable through a database connection" — doesn't cover OS-level concerns like firewall / disk encryption. Four states:

| Severity | Meaning |
|---|---|
| `pass` ✅ | Compliant |
| `warn` ⚠️ | Non-compliant but low risk (audit disabled, SSL off, etc.) |
| `fail` ❌ | Serious violation (remote root, empty-password user) |
| `unknown` — | Can't determine (insufficient privileges, enterprise-only feature) |

### MySQL family (MySQL / MariaDB / OceanBase / TiDB) — 7 checks

| ID | Category | Title | Detection |
|---|---|---|---|
| `mysql.auth.password-policy` | Authentication | Enforce strong-password policy | `SHOW VARIABLES LIKE 'validate_password%'`, policy ≥ MEDIUM and length ≥ 8 |
| `mysql.audit.enabled` | Audit | Audit logging enabled | `audit_log_*` (enterprise) or `server_audit_*` (MariaDB) |
| `mysql.auth.root-remote` | Access control | root not allowed to log in remotely | `SELECT user, host FROM mysql.user WHERE user='root'` |
| `mysql.auth.anonymous` | Access control | No anonymous users | `mysql.user WHERE user=''` |
| `mysql.transport.ssl` | Integrity | Enforce SSL | `require_secure_transport=ON` |
| `mysql.audit.slowlog` | Audit | Slow query log enabled | `slow_query_log=ON` |
| `mysql.integrity.binlog` | Integrity | binlog enabled | `log_bin=ON` (required for PITR / replication) |

### PostgreSQL family (PG / KingbaseES / openGauss / Greenplum / CockroachDB) — 6 checks

| ID | Category | Title | Detection |
|---|---|---|---|
| `pg.auth.password-encryption` | Authentication | Password encryption uses SCRAM-SHA-256 | `SHOW password_encryption` |
| `pg.audit.pgaudit` | Audit | pgaudit extension installed | `pg_extension WHERE extname='pgaudit'` |
| `pg.transport.ssl` | Integrity | SSL enabled | `SHOW ssl` |
| `pg.access.superuser-count` | Access control | Superuser count limited (≤ 2) | `SELECT rolname FROM pg_roles WHERE rolsuper` |
| `pg.audit.log-statement` | Audit | log_statement configured | `SHOW log_statement` ≠ none |
| `pg.auth.empty-password` | Authentication | No login-able users with empty password | `pg_authid WHERE rolpassword IS NULL AND rolcanlogin` |

### Markdown report export

Click **Export Markdown** → `renderReport()` groups by category and adds "Summary: ✅ N · ⚠️ N · ❌ N · — N" plus each rule's description / conclusion / raw `evidence`. File name auto-formats with connection name + timestamp: `compliance-<safeName>-<YYYY-MM-DDTHH-MM-SS>.md`.

### Parallel execution

"Start check" runs all rules in `Promise.all`; failures don't affect others (try/catch falls back to `unknown`), drivers handle their own pooling.

### Other dialects

Non-MySQL/PG family fall through to a placeholder:

```
This dialect has no compliance checks yet — please verify manually
```

Oracle / SQL Server / SQLite / DM rules to follow.

## 9. Chinese SM2 / SM3 / SM4 (planned)

The compliance rules already flag "`password_encryption=md5` is weak under Chinese / MLPS norms" (see the `pg.auth.password-encryption` description). The auxiliary API for SM2 / SM3 / SM4 (for app-layer SM signing / encryption before write) is **not yet released**, planned for v0.6 as a standalone `cryptoCn.ts` module:

- SM2 elliptic-curve sign / encrypt (based on sm-crypto)
- SM3 hash
- SM4 symmetric block cipher (CBC / ECB)

We'll add a "Chinese-crypto helper API" section once the API stabilizes.

## 10. Encrypted export .skbk

Code: `packages/ui/src/export-encrypt.ts`

Encrypts arbitrary text (typically a SQL dump or connection config) with a password into a single-line JSON file with extension `.sql.enc` / `.skbk`.

### Algorithm stack

| Stage | Algorithm | Parameters |
|---|---|---|
| Key derivation | PBKDF2-HMAC-SHA-256 | iter = `DEFAULT_ITER` = **200,000** (tunable, recorded in header) |
| Encryption | AES-GCM 256 | salt 16 bytes + iv 16 bytes, regenerated each time |
| Integrity | AES-GCM built-in 128-bit auth tag | Wrong password / tampered file → decrypt throws `WRONG_PASSWORD` |
| File header | `magic: 'SKYLERX-ENC-v1'` | Identifies version on algorithm/param upgrades |

> **PBKDF2 iter = 200,000 trade-off**: OWASP 2023 recommends SHA-256 ≥ 600,000, but desktop has to account for older hardware (Atom CPUs sit at 1+ second at 600k). If your contents are extremely sensitive, raise the iter at call time in `encryptText`.

### On-disk format

```json
{
  "magic": "SKYLERX-ENC-v1",
  "salt": "<base64 16B>",
  "iv":   "<base64 16B>",
  "iter": 200000,
  "data": "<base64 ciphertext + tag>"
}
```

Field order is fixed for clean git diffs; single-line JSON for streaming I/O.

### Error codes

| Error | When thrown | UI feedback |
|---|---|---|
| `INVALID_BLOB` | Parsing missing fields / wrong types / `magic` mismatch | "File is corrupted" |
| `WRONG_PASSWORD` | AES-GCM auth tag mismatch (wrong password / tampered) | "Wrong password" (no distinction — avoids leaking raw errors) |

### Web Crypto dependency

Uses `globalThis.crypto.subtle` — no third-party deps. Electron renderer + modern browsers work directly; Node 18+ also works (for tests). Ancient environments throw `Web Crypto API unavailable: upgrade to Node 18+ or a modern browser`.

## 11. AI privacy boundary

The AI assistant (Anthropic / OpenAI / DeepSeek / Codex / Grok) is a key SkylerX feature, but what gets sent to third-party APIs is **only what the context demands**:

| Data | Sent? | Notes |
|---|---|---|
| Current SQL text | ✅ | Required for the conversation / completion the user triggered |
| Current schema hint (DB / table / column names) | ✅ | Metadata only — **no row data** |
| Error message + error code | ✅ | For "Ask AI" diagnosis; see [AI](./ai.md) section 4 |
| Connection metadata (dialect / connection name / DB name) | ✅ | So the AI picks the right dialect |
| **Result-set rows** | ❌ | Even with AI inline completion on, we only send schema hints — not the rows SELECT returned |
| **Connection password / SSH private key** | ❌ | The keychain ciphertext is never decrypted into a prompt |
| **Entire local connection config** | ❌ | Only the dialect / database of the selected connection |

To fully isolate AI:

1. `Settings → AI Provider → clear API Key` → disables inline completion / chat / Ask AI entry
2. Or use a local endpoint (Ollama / vLLM / private deploy) by setting `endpoint` to `http://localhost:...`

> **AI webhook notifications follow the same rule**: the body contains "title + summary + trigger time" by default — no SQL row data. Edit templates under `Settings → Notifications`.

## 12. Security shortcuts

| Action | Entry |
|---|---|
| MLPS compliance check | ⌘K → "MLPS 2.0 compliance check · connection" / right-click connection → Compliance |
| PII scan | Right-click DB → PII Scanner |
| Generate masking view | Right-click DB / table → Generate masking view |
| Data contracts | ⌘K → "Data contracts" / Tools → Data contracts |
| Encrypted export | Result grid / SQL editor → Export → pick `.skbk` |
| Security policies for all connections | `Settings → Data masking` / `Settings → Production watermark` |
| Customize shortcuts (avoid mishits) | `Settings → Key bindings` |

## 13. Known limitations

What DBAs need to know about real-world edges:

- **SQL Linter is heuristic**: no full SQL parser, string scanning may miss in rare cases (e.g. nested `/* ... */` comments combined with string literals containing the `where` keyword). For high-risk operations enable the prod confirmation prompt (type connection name) as well.
- **Compliance checks need read permission**: `mysql.user` requires SELECT, `pg_authid` requires superuser. Lacking permission yields `unknown`, not `fail` — **don't treat unknown as pass**.
- **Render masking is UI-only**: data in the DB is still raw. To stop apps reading raw values, go through database masking views + tighter DB-account privileges.
- **Encrypted export doesn't defeat "offline brute force"**: 200k PBKDF2 rounds is ~10^7 cost — weak passwords are still crackable offline. Use strong passwords or distribute via KMS / public-key.
- **Environment tag is a soft constraint**: `extra.env = 'prod'` is filled by the user. If they slip and pick `dev`, prod rules don't fire. Standardize this via team-wide "export config → coworker imports" practice.
