# Oracle — manual QA

**Covers**: Oracle 19c/21c/23c, OceanBase (Oracle tenant).
**Driver**: `packages/core-driver/src/dialects/oracle.ts` (oracledb npm, thin mode, lazy-loaded).
**Wire**: Oracle Net (TNS), port 1521 default.

## Setup

- Branch / commit:
- OS:
- Server: <!-- e.g. Oracle XE 21c (gvenzl/oracle-xe), OB 4.3 Oracle tenant -->
- Test schema: `QA_USER` (uppercase by convention)
- Tablespace: `USERS`

## Connection

### Auth modes
- [ ] Basic: user + password + host + port + service name → connects
- [ ] SID-style connection string (legacy): `host:port:SID`
- [ ] EZ-connect: `host:port/service_name`
- [ ] TNS: TNS_ADMIN + alias (less common in app, may be future)
- [ ] SYSDBA: connect AS SYSDBA → connects with elevated role
- [ ] Wallet-based (mTLS) — skip unless tested env supports
- [ ] Evidence:

### thin-mode load (regression)
- [ ] First Oracle connection in a session → driver lazy-loads `oracledb`
- [ ] No Instant Client required (thin mode is pure JS)
- [ ] If user has Instant Client installed, behavior unchanged
- [ ] On low memory / corrupt install → meaningful error, not crash
- [ ] Evidence: paste console of first-connect

### Error specificity
- [ ] Wrong password → ORA-01017 with hint
- [ ] Wrong service → ORA-12514
- [ ] Listener down → ORA-12541
- [ ] User locked → ORA-28000
- [ ] User expired → ORA-28001 (with hint to reset)
- [ ] Evidence:

## Database / schema

Oracle has CDB / PDB (Container DB / Pluggable DB) from 12c+.

- [ ] Connect to PDB (e.g. `XEPDB1`) — tree shows schemas in that PDB
- [ ] Connect to CDB$ROOT — tree shows PDBs as containers
- [ ] `ALTER SESSION SET CONTAINER = XEPDB1` works
- [ ] Tree's schema = Oracle user (each user gets their own schema)

### Create schema
- [ ] `CREATE USER QA_USER IDENTIFIED BY "StrongPass!2026" DEFAULT TABLESPACE USERS QUOTA UNLIMITED ON USERS`
- [ ] `GRANT CONNECT, RESOURCE TO QA_USER`
- [ ] Now QA_USER can create objects in its own schema

> ⚠️ **Quota gotcha**: without `QUOTA UNLIMITED ON USERS`, creating tables fails with ORA-01950 even though CONNECT/RESOURCE are granted. This has bitten us before.

## Tables

### CREATE TABLE — type coverage

```sql
CREATE TABLE QA_USER.QA_T (
  ID          NUMBER(19) GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  NAME        VARCHAR2(100 CHAR) NOT NULL,
  EMAIL       VARCHAR2(255 CHAR) UNIQUE,
  AGE         NUMBER(3),
  SALARY      NUMBER(15,2),
  BIO         CLOB,
  PAYLOAD     CLOB CHECK (PAYLOAD IS JSON),
  BIN_DATA    BLOB,
  IS_ACTIVE   NUMBER(1) DEFAULT 1 CHECK (IS_ACTIVE IN (0,1)),
  CREATED_AT  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP,
  UPDATED_AT  TIMESTAMP WITH LOCAL TIME ZONE,
  BIRTH_DATE  DATE,
  RAW_DATA    RAW(2000),
  INTERVAL_Y  INTERVAL YEAR TO MONTH,
  INTERVAL_D  INTERVAL DAY TO SECOND
);
```

- [ ] Statement runs
- [ ] Tree expand → all types render
- [ ] IDENTITY column behaves as auto-increment
- [ ] Insert / select round-trip preserves each type
- [ ] Evidence:

### Identifier case (the recurring trap)
- [ ] Unquoted identifier `QA_T` → stored as `QA_T` (uppercase)
- [ ] Quoted `"qa_t"` → stored as `qa_t` (case-preserving)
- [ ] Mixing: `CREATE TABLE "test" …` then `SELECT * FROM test` → ORA-00942 (wrong case)
- [ ] App's `safeIdent` should NOT quote standard uppercase identifiers
- [ ] Verify: `dbms_metadata.get_ddl` lookups use the actual stored case, not forced UPPERCASE
- [ ] Evidence: paste a test of both cases

### ALTER TABLE
- [ ] `ALTER TABLE QA_T ADD PHONE VARCHAR2(20)` (note: no `COLUMN` keyword needed)
- [ ] `ALTER TABLE QA_T MODIFY (PHONE VARCHAR2(50) NOT NULL)`
- [ ] `ALTER TABLE QA_T DROP COLUMN PHONE` (caution: drops data)
- [ ] `ALTER TABLE QA_T SET UNUSED COLUMN PHONE` (mark unused without physical drop)
- [ ] `ALTER TABLE QA_T RENAME COLUMN PHONE TO MOBILE`
- [ ] `ALTER TABLE QA_T RENAME TO QA_T_V2`

### Drop / truncate
- [ ] `TRUNCATE TABLE QA_T` (DDL, implicit commit, resets HWM)
- [ ] `DROP TABLE QA_T PURGE` (skip recycle bin)
- [ ] `DROP TABLE QA_T` then `FLASHBACK TABLE QA_T TO BEFORE DROP`
- [ ] Verify recycle bin via `SELECT * FROM USER_RECYCLEBIN`

## Indexes

- [ ] B-tree: `CREATE INDEX QA_IDX_NAME ON QA_T(NAME)`
- [ ] Bitmap: `CREATE BITMAP INDEX QA_IDX_ACTIVE ON QA_T(IS_ACTIVE)` (DSS workloads)
- [ ] Function-based: `CREATE INDEX QA_IDX_LOWER_NAME ON QA_T(LOWER(NAME))`
- [ ] Reverse key: `CREATE INDEX QA_IDX_R ON QA_T(ID) REVERSE`
- [ ] Composite, descending: `CREATE INDEX QA_IDX_ND ON QA_T(NAME ASC, CREATED_AT DESC)`
- [ ] UNIQUE: `CREATE UNIQUE INDEX UQ_EMAIL ON QA_T(EMAIL)`
- [ ] Domain index (text): `CREATE INDEX BIO_IDX ON QA_T(BIO) INDEXTYPE IS CTXSYS.CONTEXT` (requires Oracle Text)
- [ ] Invisible index: `ALTER INDEX QA_IDX_NAME INVISIBLE` — query planner ignores
- [ ] `ALTER INDEX QA_IDX_NAME REBUILD ONLINE`
- [ ] Evidence: paste `SELECT INDEX_NAME, INDEX_TYPE FROM USER_INDEXES WHERE TABLE_NAME='QA_T'`

## Views

```sql
CREATE OR REPLACE VIEW QA_V AS SELECT ID, NAME FROM QA_T WHERE IS_ACTIVE = 1;
CREATE OR REPLACE MATERIALIZED VIEW QA_MV REFRESH ON DEMAND AS SELECT … FROM QA_T;
```

- [ ] Regular view: creatable, selectable, updatable (if simple)
- [ ] MV: `REFRESH ON DEMAND` requires `BEGIN DBMS_MVIEW.REFRESH('QA_MV'); END;`
- [ ] MV with `REFRESH FAST` requires MV log on base table — verify
- [ ] `DROP VIEW QA_V`, `DROP MATERIALIZED VIEW QA_MV`
- [ ] Tree shows views and MVs in separate groups

## Constraints

- [ ] PRIMARY KEY enforces uniqueness (ORA-00001 on dup)
- [ ] UNIQUE — ORA-00001
- [ ] NOT NULL — ORA-01400
- [ ] CHECK — ORA-02290 (with constraint name)
- [ ] FK with ON DELETE CASCADE / SET NULL — both work
- [ ] FK ON DELETE NO ACTION (default RESTRICT) — child blocks parent delete
- [ ] DEFERRABLE INITIALLY DEFERRED — checked at COMMIT
- [ ] DISABLE / ENABLE constraint: `ALTER TABLE QA_T DISABLE CONSTRAINT UQ_EMAIL`

## Functions / Stored procedures / Packages

### Standalone function
```sql
CREATE OR REPLACE FUNCTION QA_DOUBLE(X IN NUMBER) RETURN NUMBER IS
BEGIN RETURN X * 2; END;
/
```

- [ ] Created → `SELECT QA_DOUBLE(5) FROM DUAL` → 10
- [ ] `/` terminator handling: editor must NOT split PL/SQL block on `;`
- [ ] DDL gen from tree → produces valid recreate
- [ ] Evidence:

### Standalone procedure
```sql
CREATE OR REPLACE PROCEDURE QA_INSERT(P_NAME IN VARCHAR2) IS
BEGIN INSERT INTO QA_T(NAME) VALUES (P_NAME); COMMIT; END;
/
```

- [ ] Created → `BEGIN QA_INSERT('hi'); END;` runs

### Package + body
```sql
CREATE OR REPLACE PACKAGE QA_PKG AS
  FUNCTION ADD_ONE(X NUMBER) RETURN NUMBER;
END QA_PKG;
/
CREATE OR REPLACE PACKAGE BODY QA_PKG AS
  FUNCTION ADD_ONE(X NUMBER) RETURN NUMBER IS BEGIN RETURN X + 1; END;
END QA_PKG;
/
```

- [ ] Both spec + body created
- [ ] `SELECT QA_PKG.ADD_ONE(10) FROM DUAL` → 11
- [ ] Tree shows package with expandable spec / body
- [ ] Drop: `DROP PACKAGE QA_PKG`

### Type
- [ ] `CREATE TYPE QA_OBJ AS OBJECT (X NUMBER, Y VARCHAR2(50))` → works
- [ ] Object table: `CREATE TABLE QA_OBJ_T OF QA_OBJ`

## Triggers

```sql
CREATE OR REPLACE TRIGGER QA_T_UPDATE_TS
BEFORE UPDATE ON QA_T FOR EACH ROW
BEGIN :NEW.UPDATED_AT := SYSTIMESTAMP; END;
/
```

- [ ] Trigger created → fires on UPDATE
- [ ] BEFORE / AFTER × INSERT / UPDATE / DELETE all supported
- [ ] FOR EACH ROW vs statement-level
- [ ] Compound triggers (more advanced) — verify spec parses

## Sequences

```sql
CREATE SEQUENCE QA_SEQ START WITH 1000 INCREMENT BY 10 CACHE 50;
SELECT QA_SEQ.NEXTVAL FROM DUAL;  -- 1000
SELECT QA_SEQ.CURRVAL FROM DUAL;  -- 1000
ALTER SEQUENCE QA_SEQ INCREMENT BY 100;
DROP SEQUENCE QA_SEQ;
```

- [ ] All work
- [ ] Tree shows sequences
- [ ] IDENTITY column auto-creates a sequence; visible

## Users · Roles · Grants

```sql
CREATE USER QA_USER IDENTIFIED BY "StrongPass!2026" DEFAULT TABLESPACE USERS QUOTA UNLIMITED ON USERS;
GRANT CONNECT, RESOURCE TO QA_USER;
GRANT CREATE VIEW, CREATE SYNONYM, CREATE SEQUENCE, CREATE PROCEDURE TO QA_USER;
GRANT CREATE TRIGGER, CREATE TYPE, CREATE MATERIALIZED VIEW TO QA_USER;
GRANT CREATE DATABASE LINK TO QA_USER;

CREATE ROLE QA_RPT;
GRANT SELECT ON QA_USER.QA_T TO QA_RPT;
GRANT QA_RPT TO QA_USER;
```

- [ ] All execute → check `DBA_USERS` (if granted DBA view)
- [ ] Connect as QA_USER → can do covered operations
- [ ] `SET ROLE QA_RPT` → activates additional role
- [ ] `REVOKE`, `DROP ROLE QA_RPT`, `DROP USER QA_USER CASCADE`
- [ ] Profile / password policy: `CREATE PROFILE QA_PROF LIMIT FAILED_LOGIN_ATTEMPTS 3 PASSWORD_LIFE_TIME 90`
- [ ] System privileges: full list visible in `USER_SYS_PRIVS`
- [ ] Object privileges: `USER_TAB_PRIVS`
- [ ] Evidence:

## DML / Query

### INSERT
- [ ] Single row
- [ ] Multi-row via `INSERT ALL INTO QA_T(NAME) VALUES('a') INTO QA_T(NAME) VALUES('b') SELECT 1 FROM DUAL`
- [ ] INSERT ... SELECT
- [ ] MERGE (Oracle's upsert):
  ```sql
  MERGE INTO QA_T t USING (SELECT 1 ID, 'X' NAME FROM DUAL) s
  ON (t.ID = s.ID)
  WHEN MATCHED THEN UPDATE SET t.NAME = s.NAME
  WHEN NOT MATCHED THEN INSERT (NAME) VALUES (s.NAME);
  ```
- [ ] Evidence:

### UPDATE / DELETE
- [ ] `UPDATE QA_T SET NAME = UPPER(NAME) WHERE ROWNUM <= 10`
- [ ] `UPDATE (SELECT … FROM QA_T t JOIN QA_T2 …) SET …`  (updatable inline view)
- [ ] `DELETE FROM QA_T WHERE …`

### SELECT — query shapes
- [ ] DUAL: `SELECT 1 FROM DUAL`, `SELECT SYSDATE FROM DUAL`
- [ ] ROWNUM-based pagination: `SELECT * FROM (SELECT t.*, ROWNUM rn FROM QA_T t) WHERE rn BETWEEN 10 AND 20`
- [ ] OFFSET / FETCH (12c+): `OFFSET 10 ROWS FETCH NEXT 20 ROWS ONLY`
- [ ] JOIN: INNER, LEFT, RIGHT, FULL OUTER, CROSS
- [ ] Old-style outer join `(+)` — linter should flag as legacy
- [ ] CTE: `WITH cte AS (…) SELECT …`
- [ ] Recursive CTE: `WITH RECURSIVE …` (12c+)
- [ ] CONNECT BY (Oracle hierarchical): `SELECT … CONNECT BY PRIOR id = parent_id`
- [ ] Window functions: `ROW_NUMBER() OVER (PARTITION BY …)`, LAG, LEAD, FIRST_VALUE
- [ ] PIVOT / UNPIVOT
- [ ] MODEL clause (advanced — verify parses)
- [ ] UNION / INTERSECT / MINUS (Oracle uses MINUS, not EXCEPT)
- [ ] Evidence:

### Type-specific queries
- [ ] CLOB > 4000 bytes: SELECT, edit, save → preserves
- [ ] BLOB binary round-trip preserves bytes
- [ ] JSON: `WHERE JSON_VALUE(payload, '$.k') = 'v'` (12c+)
- [ ] XMLType: `WHERE EXTRACTVALUE(xmlcol, '/a/b') = 'x'`
- [ ] DATE arithmetic: `WHERE created_at > SYSDATE - 7`
- [ ] INTERVAL: `INTERVAL '1' DAY`
- [ ] TIMEZONE: `FROM_TZ(TIMESTAMP '2026-01-01 00:00:00', 'UTC')`
- [ ] Evidence:

## Transactions

- [ ] DML transactional, DDL implicitly commits (warn before DDL in manual-commit mode)
- [ ] Savepoints: `SAVEPOINT sp1; ROLLBACK TO sp1`
- [ ] `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`
- [ ] `SELECT … FOR UPDATE` locks rows
- [ ] Read-only TX: `SET TRANSACTION READ ONLY`
- [ ] After error, TX still continues (vs PG behavior); explicit ROLLBACK only resets

## Dialect-specific quirks

- [ ] OB Oracle tenant has no `VERSION()` — use `SELECT 1 FROM DUAL` + `v$version` for version probe (regression #28 caught this)
- [ ] Some functions are PL/SQL only, not SQL: e.g. `DBMS_OUTPUT.PUT_LINE` only inside BEGIN/END
- [ ] `DBMS_METADATA.GET_DDL(…)` for DDL gen — verify uppercase identifier lookup matches stored case
- [ ] `RAISE_APPLICATION_ERROR(-20001, 'msg')` in PL/SQL — error propagates to UI
- [ ] National character types (NCHAR, NVARCHAR2, NCLOB) work alongside VARCHAR2
- [ ] DBA views require granted role: `GRANT SELECT_CATALOG_ROLE TO QA_USER` → DBA_TABLES etc. accessible
- [ ] AWR / ASH (Diagnostics+Tuning pack, licensed) — health check should NOT call without confirmation
- [ ] DBLINK: `CREATE DATABASE LINK qa_link CONNECT TO … IDENTIFIED BY …`

## OceanBase (Oracle tenant) quirks

- [ ] Use Oracle driver, NOT MySQL driver, even though port may be 2881
- [ ] Service name = tenant name (e.g. `oracle_tenant`)
- [ ] `dbms_metadata` partial support — fall back to `USER_TAB_COLUMNS` if `get_ddl` fails
- [ ] Reduced PL/SQL: most basic functions/procs work; some packages may be unavailable
- [ ] `v$version` works; `VERSION()` does NOT (Oracle-strict)

## Known limitations

- Oracle Wallet (mTLS) auth flow not yet wired into the connection dialog
- TDE (Transparent Data Encryption) is server-side — app reads decrypted values transparently
- ANYDATA / SDO_GEOMETRY columns may render as `<unsupported>` in grid
- DBMS_REDEFINITION online ops — not exposed in UI yet
- Apex / E-Business Suite metadata may be very large — schema diff intentionally times out at 60s
