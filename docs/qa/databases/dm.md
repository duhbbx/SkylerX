# DM (达梦) — manual QA

**Covers**: DM Database Management System v8 (达梦数据库 DM8).
**Driver**: `packages/core-driver/src/dialects/dm.ts` (`dmdb` npm, **native module**, lazy-loaded).
**Wire**: DM proprietary, port 5236 default.

> DM has high syntactic / semantic compatibility with Oracle. Most Oracle test cases apply with minor identifier-case adjustments. Use [`oracle.md`](./oracle.md) as the primary template; this file calls out **DM-specific** behavior.

## Setup

- Branch / commit:
- OS:
- Server: DM8 (`SYSDBA` available)
- Test schema: `QA_USER`

## Native module load (regression)

DM uses a native (C++) Node addon. ABI must match Electron's bundled Node.

- [ ] Fresh `pnpm install` + `pnpm --filter @db-tool/desktop rebuild:native` succeeds on current OS
- [ ] First connection attempt → `dmdb` lazy-loads without crash
- [ ] If electron-rebuild was skipped → error message mentions "incompatible ABI", not generic "Cannot find module"
- [ ] On Windows: dmdb DLL dependencies (VC++ runtime?) resolved
- [ ] On macOS arm64: native binary is arm64, not x64-via-Rosetta
- [ ] On Linux: glibc / musl ABI matches user's distro
- [ ] Evidence: paste boot log of first DM connection

## Connection

- [ ] Basic user + password + host + port → green toast, version
- [ ] SYSDBA login → elevated role
- [ ] Service name (DM-specific) — verify field labeled correctly
- [ ] SSL connection — option exposed if applicable
- [ ] Wrong password → DM-prefixed error code (not generic)
- [ ] Connection charset = UTF-8
- [ ] Evidence:

## Database / schema

DM has schemas (≈ Oracle users).

- [ ] `CREATE USER QA_USER IDENTIFIED BY "StrongPass!2026"` — creates user + schema
- [ ] `GRANT RESOURCE TO QA_USER` — basic object creation
- [ ] Connect as QA_USER → has own schema
- [ ] `CREATE SCHEMA qa_s` (DM also supports independent schemas)
- [ ] Tree shows schemas as expandable nodes

## Tables

DM tables look like Oracle. Run the Oracle `CREATE TABLE` block with these adjustments:

```sql
CREATE TABLE QA_T (
  ID          BIGINT IDENTITY(1,1) PRIMARY KEY,   -- DM also supports IDENTITY (SQL Server-like)
  NAME        VARCHAR(100) NOT NULL,
  EMAIL       VARCHAR(255) UNIQUE,
  AGE         INT,
  SALARY      NUMERIC(15,2),
  BIO         CLOB,
  PAYLOAD     CLOB,
  BIN_DATA    BLOB,
  IS_ACTIVE   BIT DEFAULT 1,
  CREATED_AT  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UPDATED_AT  TIMESTAMP,
  BIRTH_DATE  DATE
);
```

- [ ] Statement runs
- [ ] Tree expand → all types correct
- [ ] DM supports both `IDENTITY` (SQL Server-style) and sequences (Oracle-style)
- [ ] Run all of [`oracle.md`](./oracle.md) ALTER / DROP / TRUNCATE cases — verify each works on DM (same syntax)

### Identifier case
- [ ] Same as Oracle: unquoted → UPPER, quoted → preserved
- [ ] App's safeIdent matches Oracle behavior
- [ ] Evidence:

## Indexes

- [ ] B-tree (default)
- [ ] Bitmap (`CREATE BITMAP INDEX …`)
- [ ] Function-based (`CREATE INDEX … ON QA_T(LOWER(NAME))`)
- [ ] UNIQUE
- [ ] Cluster index: DM has a CLUSTER concept — verify DDL gen captures
- [ ] `ALTER INDEX … REBUILD`

## Views / MVs

- [ ] `CREATE VIEW`
- [ ] `CREATE MATERIALIZED VIEW` — supported
- [ ] `DBMS_MVIEW.REFRESH` package available (Oracle compatibility)

## Constraints

Same as Oracle:
- [ ] PK / UNIQUE / NOT NULL / CHECK / FK with CASCADE / SET NULL / RESTRICT
- [ ] DM-specific: row-level security policies via `DBMS_RLS` package

## Functions / Stored procedures / Packages

DM uses Oracle-compatible PL/SQL dialect.

```sql
CREATE OR REPLACE FUNCTION QA_DOUBLE(X IN NUMBER) RETURN NUMBER IS
BEGIN RETURN X * 2; END;
/
```

- [ ] Same `/`-as-terminator behavior as Oracle
- [ ] Packages with spec + body → tree shows expandable

## Triggers / Sequences

- [ ] Same as Oracle (BEFORE / AFTER × INSERT / UPDATE / DELETE, FOR EACH ROW)
- [ ] CREATE / ALTER / DROP SEQUENCE works
- [ ] `seq.NEXTVAL`, `seq.CURRVAL` syntax

## Users · Roles · Grants

DM follows Oracle privilege model:

```sql
CREATE USER QA_USER IDENTIFIED BY "Pass!2026";
GRANT CONNECT, RESOURCE TO QA_USER;
GRANT CREATE VIEW, CREATE SYNONYM, CREATE SEQUENCE TO QA_USER;

CREATE ROLE QA_RPT;
GRANT SELECT ON QA_T TO QA_RPT;
GRANT QA_RPT TO QA_USER;
```

- [ ] Create / grant / revoke / drop — same Oracle syntax
- [ ] `SET ROLE QA_RPT` works
- [ ] DM-specific predefined roles: `DBA`, `RESOURCE`, `CONNECT`, `PUBLIC`
- [ ] DM safety levels (B1, B2, B3 — 等保 / classified info system levels): if configured, labels visible
- [ ] Evidence:

### 等保合规相关
- [ ] DM has classified info / multi-level security features; if shipped in test env, verify:
  - [ ] `DBMS_SEC` package functions don't crash on call
  - [ ] Audit logs accessible if granted SECURITY role
- [ ] Evidence:

## DML / Query

Run the Oracle DML / query battery — should pass identically. Specifically verify:

- [ ] `SELECT … FROM DUAL` — DM supports
- [ ] ROWNUM-based pagination — supported
- [ ] OFFSET / FETCH (newer DM) — verify version
- [ ] CONNECT BY hierarchical — supported
- [ ] PIVOT / UNPIVOT — supported (with `XML`-output option)
- [ ] MERGE INTO — supported
- [ ] CTE (`WITH …`) — supported
- [ ] Recursive CTE — supported in newer DM
- [ ] Window functions — supported
- [ ] `MINUS` operator — supported (not `EXCEPT`)
- [ ] Evidence:

### MySQL compat mode
DM has a MySQL-compat mode that changes some behaviors. If enabled on the test server:
- [ ] `LIMIT n OFFSET m` syntax works (MySQL-style)
- [ ] Identifier case behavior may shift to lowercase-by-default
- [ ] App should ideally treat as a different "dialect" but currently only ships one DM driver — document any drift in PR

## Transactions

- [ ] Same as Oracle: DML transactional, DDL implicit commit
- [ ] Savepoints, isolation levels, FOR UPDATE
- [ ] After error → TX continues until explicit ROLLBACK (Oracle-like)

## Dialect-specific quirks

### 信创 / 等保 compliance
- [ ] DM ships with 国密 (SM2 / SM3 / SM4) crypto built into the engine — if column-level encryption used, app's safeStorage layer is separate from DM's
- [ ] DM-Audit (审计): if enabled, every DML is logged server-side; app should NOT bypass

### Identifier case (regression bait)
- [ ] Schema = `QA_USER` (UPPERCASE); table = `QA_T`; quoted `"qa_t"` is different
- [ ] App's DDL gen must use the actual stored case
- [ ] Hit this before — DDL gen was forcing UPPERCASE in dbms_metadata.get_ddl lookups, broke schemas with quoted lowercase idents — should NOT regress

### Object names in catalogs
- [ ] DM-specific catalog views: `SYSOBJECTS` (DM-specific, like SQL Server's `sysobjects`)
- [ ] Also has `DBA_TABLES`, `USER_TABLES` (Oracle-compatible)
- [ ] Verify tree metadata uses appropriate path for each version

### National-character types
- [ ] NCHAR / NVARCHAR — UTF-16 storage; Chinese chars work
- [ ] CLOB / NCLOB — large text supported

### Diagnostics
- [ ] `SP_DIAGNOSE` family of procs — exposed via "Run health check" in DBA panel?
- [ ] `V$SESSIONS`, `V$SQL`, `V$LONG_RUNNING_TRANS` — slow-query / active-query panel uses these

## Quota / tablespace

- [ ] Like Oracle, new user MAY need explicit quota: `ALTER USER QA_USER QUOTA UNLIMITED ON USERS`
- [ ] OR DM's `DEFAULT TABLESPACE` clause at CREATE USER
- [ ] Verify the NewSchemaDialog template includes safe defaults
- [ ] Evidence:

## Cross-platform

- [ ] **macOS arm64**: native `dmdb` binary exists for arm64 — verify
- [ ] **macOS x64**: native `dmdb` binary exists — verify
- [ ] **Windows x64 / ARM64**: native DLL + dependencies bundled
- [ ] **Linux x64**: glibc compatibility; for musl (Alpine) may not work — verify
- [ ] **Linux ARM64**: native binary required; check `dmdb` ships ARM64 build
- [ ] If a platform fails to load `dmdb`, app must show clear "DM driver unavailable on this platform" instead of cryptic node error
- [ ] Evidence: paste platform-by-platform load test output

## Known limitations

- DM native module: actually dmdb is **pure JS** (NOT native), so no electron-rebuild needed despite older docs. Size ~few MB.
- DM uses some non-standard SQL extensions (e.g. `DBMS_PIPE` for IPC inside engine) — out of scope to test
- Some DBA views are restricted to DBA role; without DBA grant, health check should degrade gracefully
- DM's audit log (审计) is server-side; app does not consume it directly
- 国产化 / 信创认证: SkylerX itself does not undergo 等保 / 信创 certification — that's the DM server's responsibility
- DM-specific quirk: `CURRENT_SCHEMA()` function is NOT supported, throws `[-2207] Member access [CURRENT_SCHEMA] unresolved`. Use `SYS_CONTEXT('USERENV','CURRENT_SCHEMA')` instead.

## ⚠️ Major upstream limitation — dmdb cipher incompatibility with Electron's BoringSSL

**Symptom**: DM connections from packaged SkylerX (or any Electron-based app) fail with `[6071] 消息加密失败 - Unknown cipher` or `[20017] 获取连接请求等待超时`.

**Root cause** (verified end-to-end on 2026-06-01):

dmdb's protocol-level password handshake hard-codes the **DES-CFB** cipher when the server reports its default `algorighm = 0` (typo is in dmdb source — preserved here for grep). Three independent OpenSSL ecosystems behave differently:

| Runtime | Crypto library | DES-CFB support |
|---|---|---|
| Node 12 / 14 (era of dameng's official examples) | OpenSSL 1.1.x | ✅ default |
| **Node 18+ / 24** (modern Node CLI) | OpenSSL 3.x default | ❌ removed |
| **Node 18+ / 24 with `--openssl-legacy-provider`** | OpenSSL 3.x + legacy provider | ✅ available |
| **Electron 22+ / 34** (production SkylerX runtime) | **BoringSSL** (`process.versions.openssl === '0.0.0'`) | ❌ permanently removed, no legacy provider concept |

BoringSSL is Google's OpenSSL fork used by Chromium; it aggressively prunes legacy ciphers and **does NOT have a legacy provider mechanism at all**. There is no Node CLI flag that can re-enable DES-CFB in Electron.

**Diagnostic trap**: standalone Node tests of dmdb will pass (Node 24 OpenSSL 3.6.2 still has DES-CFB via legacy provider) while the same code in Electron fails. **Always test crypto-using drivers in actual Electron, not standalone Node.**

**Workaround in SkylerX** (`packages/core-driver/src/dialects/dm.ts`):
- `buildDmUrl()` appends `?loginEncrypt=0` to the connection URL, telling dmdb to **skip the protocol-level password handshake encryption entirely**.
- Trade-off: password is sent in cleartext on the wire. Safe only for:
  - localhost / Docker containers
  - Connections wrapped in SSH tunnel (SkylerX's existing SSH feature)
  - Connections wrapped in DM server-side SSL (`ENABLE_ENCRYPT=1`)

**Other workarounds we tried and abandoned**:
- `?algorighm=1` URL param — does not flow into `this.pt.algorighm` (server overrides via startup response)
- `OPENSSL_CONF` with legacy provider section — Electron's BoringSSL doesn't read provider configs
- Monkey-patching `MsgSecurity.DES_CFB = MsgSecurity.AES256_CFB` — client encrypts with AES, server expects DES, gives `[-2501] 用户名或密码错误`
- `NODE_OPTIONS=--openssl-legacy-provider` — Electron rejects this from NODE_OPTIONS; even as a direct CLI arg it has no effect because Electron uses BoringSSL not OpenSSL

**Long-term fix**: dameng must update dmdb to support modern OpenSSL/BoringSSL-compatible ciphers (e.g., default to AES-256-CFB). This is tracked upstream; until then, document the SSH-tunnel recommendation in the UI / docs.
