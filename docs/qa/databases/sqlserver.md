# SQL Server — manual QA

**Covers**: SQL Server 2016–2022, Azure SQL Database, Azure SQL Edge (mac/Linux).
**Driver**: `packages/core-driver/src/dialects/sqlserver.ts` (mssql / tedious, pure JS).
**Wire**: TDS, port 1433 default.

## Setup

- Branch / commit:
- OS:
- Server: <!-- e.g. SQL Server 2022 / Azure SQL Edge -->
- Test DB: `qa_db`
- Test schema: `dbo` (default) and `qa_s`

## Connection

- [ ] Basic SQL auth: user + password → green toast, version (`@@VERSION`)
- [ ] Windows / NTLM auth: option exposed, works on Windows
- [ ] Azure AD auth (if applicable to Azure SQL) — verify
- [ ] Encryption: `encrypt: true` + `trustServerCertificate: true` for self-signed
- [ ] Encryption with proper cert: full verify works
- [ ] Wrong password → Login failed (18456) with state, NOT just "Unknown"
- [ ] Wrong host → connection timeout < 10s
- [ ] Default DB specified → `USE qa_db` on connect
- [ ] Evidence:

## Database / schema

- [ ] `CREATE DATABASE qa_db COLLATE SQL_Latin1_General_CP1_CI_AS`
- [ ] `USE qa_db` → tree updates
- [ ] `CREATE SCHEMA qa_s AUTHORIZATION dbo`
- [ ] Tree shows schemas under DB (default `dbo`, custom `qa_s`, system `sys` / `INFORMATION_SCHEMA`)
- [ ] `DROP SCHEMA qa_s`
- [ ] `DROP DATABASE qa_db` — requires no active connections; close other sessions first
- [ ] Evidence:

## Tables

### CREATE TABLE — type coverage

```sql
CREATE TABLE qa_db.dbo.qa_t (
  id           BIGINT IDENTITY(1,1) PRIMARY KEY,
  name         NVARCHAR(100) NOT NULL,
  email        NVARCHAR(255) UNIQUE,
  age          TINYINT,
  salary       DECIMAL(15,2),
  bio          NVARCHAR(MAX),
  payload      NVARCHAR(MAX) CHECK (ISJSON(payload) = 1),
  bin_data     VARBINARY(MAX),
  is_active    BIT DEFAULT 1,
  created_at   DATETIME2 DEFAULT SYSDATETIME(),
  updated_at   DATETIMEOFFSET,
  birth_date   DATE,
  guid         UNIQUEIDENTIFIER DEFAULT NEWID(),
  geo          GEOGRAPHY,
  geom         GEOMETRY
);
```

- [ ] Statement runs
- [ ] Tree expand → IDENTITY column shown with seed/increment
- [ ] All types render in grid correctly:
  - [ ] NVARCHAR with Unicode (Chinese / emoji)
  - [ ] VARBINARY: hex viewer renders
  - [ ] UNIQUEIDENTIFIER: GUID format
  - [ ] DATETIMEOFFSET: timezone preserved
  - [ ] GEOGRAPHY / GEOMETRY: WKT or hex shown
- [ ] Evidence:

### Identifier quoting
- [ ] Standard identifier: `qa_t` works unquoted
- [ ] Reserved word as identifier: `[order]` quoted with brackets
- [ ] App's safeIdent uses `[…]` for reserved / special chars
- [ ] Case-insensitive identifier collation (default) — `qa_t` and `QA_T` resolve to same
- [ ] Case-sensitive collation → must match case

### ALTER TABLE
- [ ] `ALTER TABLE qa_t ADD phone NVARCHAR(20)`
- [ ] `ALTER TABLE qa_t ALTER COLUMN phone NVARCHAR(50) NOT NULL` — fails if existing rows have NULL
- [ ] `ALTER TABLE qa_t DROP COLUMN phone`
- [ ] Rename via `sp_rename 'qa_t.phone', 'mobile', 'COLUMN'`
- [ ] `sp_rename 'qa_t', 'qa_t_v2'`

### Drop / truncate
- [ ] `TRUNCATE TABLE qa_t` — resets IDENTITY
- [ ] `DROP TABLE qa_t`
- [ ] Drop only if exists: `IF OBJECT_ID('qa_t') IS NOT NULL DROP TABLE qa_t`

## Indexes

- [ ] B-tree (clustered): exactly one per table; if PK isn't clustered, can have a separate clustered
- [ ] Nonclustered: `CREATE NONCLUSTERED INDEX qa_idx_name ON qa_t(name)`
- [ ] Composite + included columns: `CREATE INDEX qa_idx_n ON qa_t(name) INCLUDE (email)`
- [ ] UNIQUE: `CREATE UNIQUE INDEX uq_email ON qa_t(email)`
- [ ] Filtered: `CREATE INDEX qa_idx_active ON qa_t(name) WHERE is_active = 1`
- [ ] Columnstore: `CREATE COLUMNSTORE INDEX qa_cs ON qa_t(id, name)`
- [ ] Spatial: `CREATE SPATIAL INDEX qa_geo_idx ON qa_t(geo)`
- [ ] Full-text: `CREATE FULLTEXT INDEX ON qa_t(bio) KEY INDEX pk_qa_t`
- [ ] `ALTER INDEX qa_idx_name ON qa_t REBUILD WITH (ONLINE = ON)`
- [ ] Evidence:

## Views

- [ ] `CREATE VIEW qa_v AS SELECT id, name FROM qa_t WHERE is_active = 1`
- [ ] `SELECT * FROM qa_v` works
- [ ] Updatable view: simple INSERT/UPDATE/DELETE through view works for non-aggregated views
- [ ] INDEXED VIEW (materialized): `CREATE VIEW qa_iv WITH SCHEMABINDING AS …`, then `CREATE UNIQUE CLUSTERED INDEX … ON qa_iv(…)`
- [ ] `DROP VIEW qa_v`

## Constraints

- [ ] PK enforces uniqueness (error 2627)
- [ ] UNIQUE — error 2601 or 2627
- [ ] NOT NULL — error 515
- [ ] CHECK — error 547 (with constraint name)
- [ ] FK with CASCADE / SET NULL / SET DEFAULT — all work
- [ ] FK NO ACTION (default) blocks parent delete
- [ ] DEFAULT constraint named: `CONSTRAINT df_is_active DEFAULT 1 FOR is_active`
- [ ] Drop named default: `ALTER TABLE qa_t DROP CONSTRAINT df_is_active`

## Functions / Stored procedures

### Scalar function
```sql
CREATE OR ALTER FUNCTION dbo.qa_double (@x INT) RETURNS INT AS
BEGIN RETURN @x * 2; END
GO
```

- [ ] Created → `SELECT dbo.qa_double(5)` → 10
- [ ] `GO` separator handled — editor sends as batch boundary
- [ ] Tree shows under Functions group

### Inline table-valued function
```sql
CREATE FUNCTION dbo.qa_tvf (@n INT) RETURNS TABLE AS
RETURN (SELECT TOP (@n) id, name FROM qa_t ORDER BY id)
```

- [ ] Works, `SELECT * FROM dbo.qa_tvf(5)`

### Procedure
```sql
CREATE OR ALTER PROCEDURE dbo.qa_insert @n NVARCHAR(100) AS
BEGIN INSERT INTO qa_t(name) VALUES (@n) END
GO
```

- [ ] Created → `EXEC dbo.qa_insert N'hi'` works
- [ ] Output parameters work: `@result INT OUTPUT`
- [ ] Multi-result-set procedures — grid shows tabs per result

## Triggers

```sql
CREATE OR ALTER TRIGGER trg_qa_t_update ON qa_t AFTER UPDATE AS
BEGIN
  UPDATE qa_t SET updated_at = SYSDATETIMEOFFSET()
  FROM qa_t INNER JOIN inserted i ON qa_t.id = i.id;
END
```

- [ ] Created, fires on UPDATE
- [ ] Triggers shown under Tables → triggers in tree
- [ ] INSTEAD OF triggers (for views) — also work

## Sequences (SQL Server 2012+)

```sql
CREATE SEQUENCE qa_seq START WITH 1000 INCREMENT BY 10 CACHE 50;
SELECT NEXT VALUE FOR qa_seq;
ALTER SEQUENCE qa_seq RESTART WITH 5000;
DROP SEQUENCE qa_seq;
```

- [ ] All work
- [ ] Tree shows sequences

## Users · Roles · Grants

SQL Server has 2 layers: **logins** (server-level) and **users** (database-level).

```sql
-- server level
CREATE LOGIN qa_user WITH PASSWORD = 'StrongPass!2026';
-- database level
USE qa_db;
CREATE USER qa_user FOR LOGIN qa_user;
GRANT SELECT, INSERT ON SCHEMA::dbo TO qa_user;
GRANT CREATE TABLE TO qa_user;

CREATE ROLE qa_reader;
GRANT SELECT ON SCHEMA::dbo TO qa_reader;
ALTER ROLE qa_reader ADD MEMBER qa_user;
```

- [ ] All execute → check `sys.server_principals`, `sys.database_principals`
- [ ] Connect as qa_user → can SELECT
- [ ] `EXECUTE AS USER = 'qa_user'` switches context for testing
- [ ] `REVOKE`, `DROP USER`, `DROP LOGIN`
- [ ] Fixed roles: `db_owner`, `db_datareader`, `db_datawriter` — assignable via `ALTER ROLE`
- [ ] Server-level roles: `sysadmin`, `securityadmin` — verify can be granted via login
- [ ] Evidence:

## DML / Query

### INSERT
- [ ] Single, multi-row
- [ ] `INSERT ... OUTPUT inserted.*` (returns inserted rows)
- [ ] `MERGE qa_t USING …` (UPSERT)
- [ ] `INSERT INTO qa_t (…) VALUES (…)` with TABLOCK hint for bulk

### UPDATE / DELETE
- [ ] `UPDATE qa_t SET name = UPPER(name) FROM qa_t WHERE …` (note: FROM clause syntax)
- [ ] `DELETE qa_t OUTPUT deleted.* FROM qa_t WHERE …` (with output)
- [ ] `DELETE TOP (10) FROM qa_t` — must use parentheses

### SELECT — query shapes
- [ ] TOP N: `SELECT TOP 10 * FROM qa_t ORDER BY id`
- [ ] OFFSET / FETCH: `OFFSET 10 ROWS FETCH NEXT 20 ROWS ONLY`
- [ ] JOIN: INNER, LEFT, RIGHT, FULL, CROSS, CROSS APPLY, OUTER APPLY
- [ ] CTE: `WITH cte AS (…) SELECT …`
- [ ] Recursive CTE: hierarchy traversal
- [ ] Window functions: `ROW_NUMBER() OVER (PARTITION BY … ORDER BY …)`, LAG, LEAD
- [ ] PIVOT / UNPIVOT
- [ ] GROUPING SETS / ROLLUP / CUBE
- [ ] UNION / INTERSECT / EXCEPT
- [ ] STRING_AGG (2017+): `SELECT STRING_AGG(name, ',') FROM qa_t`
- [ ] Evidence:

### Type-specific queries
- [ ] BIGINT > Number.MAX_SAFE_INTEGER → grid shows as string with annotation
- [ ] NVARCHAR(MAX): edit + save preserves full content
- [ ] JSON via OPENJSON / JSON_VALUE / JSON_QUERY (2016+)
- [ ] XML via `nodes()` / `value()` / `query()`
- [ ] Geography: `geo.STDistance(otherGeo)` — works
- [ ] HIERARCHYID — round-trip works (if used)
- [ ] Evidence:

## Transactions

- [ ] Default autocommit; explicit BEGIN TRAN → SQL Server-style
- [ ] `BEGIN TRAN`, `COMMIT TRAN`, `ROLLBACK TRAN`
- [ ] Named savepoint: `SAVE TRAN sp1; ROLLBACK TRAN sp1`
- [ ] Isolation: READ UNCOMMITTED / READ COMMITTED / REPEATABLE READ / SERIALIZABLE / SNAPSHOT
- [ ] `SET TRANSACTION ISOLATION LEVEL …` per session
- [ ] `WITH (NOLOCK)` table hint = dirty read (linter should flag in prod)
- [ ] Distributed transactions (MS DTC) — out of scope, verify NOT broken if accidentally invoked

## Dialect-specific quirks

- [ ] `GO` is a batch separator (NOT a statement) — driver must NOT send `GO` over wire
- [ ] `SET NOCOUNT ON` at procedure start avoids extra row count messages
- [ ] `IDENTITY_INSERT`: `SET IDENTITY_INSERT qa_t ON` to insert explicit values into IDENTITY column
- [ ] `@@ROWCOUNT`, `@@IDENTITY`, `SCOPE_IDENTITY()` — function-style metadata
- [ ] Temporary tables: `#qa_temp` (session) vs `##qa_global` (global)
- [ ] CTE must be terminated with `;` if preceded by another statement
- [ ] DATEDIFF, DATEADD, DATEPART — heavily used; verify column types preserve precision

## Cross-platform

- [ ] mssql driver works on macOS / Linux (no Windows-specific dep)
- [ ] Windows NTLM auth: works on Windows only; on mac/Linux must use SQL auth
- [ ] Encryption defaults differ on Azure SQL (forced) — verify connection params handle

## Known limitations

- mssql driver does NOT support multiple result sets in same way as ADO.NET — each result is a separate grid tab
- `bcp` / `BULK INSERT` not surfaced in UI for client-side import (must use INSERT batches)
- Always Encrypted (Always Encrypted) columns are decrypted server-side; client transparently sees plaintext
- Service Broker / change tracking not exposed in UI
- Linked Servers (`sp_addlinkedserver`) usable via SQL but no UI helper
