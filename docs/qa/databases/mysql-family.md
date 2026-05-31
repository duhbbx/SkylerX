# MySQL family — manual QA

**Covers**: MySQL, MariaDB, OceanBase (MySQL mode), TiDB.
**Driver**: `packages/core-driver/src/dialects/mysql.ts` (mysql2 npm package, pure JS).
**Wire**: MySQL protocol (port 3306 default).

> Doris / StarRocks also speak MySQL wire but have distinct DDL — see [`doris-starrocks.md`](./doris-starrocks.md).

## Setup

- Branch / commit:
- OS:
- Server: <!-- MySQL 8.0.x / MariaDB 11.x / OceanBase 4.3 / TiDB 7.5+ -->
- Test DB: `qa_db` (create fresh)

## Connection

- [ ] Plain TCP host + port + user + password → green toast with version
- [ ] Default DB specified → tree expands to that DB by default
- [ ] No default DB → tree shows all accessible DBs
- [ ] Unix socket (if applicable) — replace host with `localhost` + socket path
- [ ] SSL: `ssl: { rejectUnauthorized: false }` for self-signed → connects
- [ ] SSL: `rejectUnauthorized: true` with mismatched cert → fails with specific TLS error
- [ ] Wrong password → ER_ACCESS_DENIED_ERROR (1045) with hostname in message
- [ ] Wrong host → ETIMEDOUT or ECONNREFUSED within 10s
- [ ] Connection charset = `utf8mb4` (verify with `SHOW VARIABLES LIKE 'character_set_connection'`)
- [ ] timeZone option honored
- [ ] Evidence:

## Database / schema

- [ ] `CREATE DATABASE qa_db DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
- [ ] `SHOW DATABASES` → `qa_db` appears
- [ ] `USE qa_db` → tree updates
- [ ] `DROP DATABASE qa_db` → gone from tree
- [ ] Evidence:

### Charset / collation
- [ ] Insert UTF-8 4-byte chars (emoji) → stored and retrieved correctly
- [ ] Insert Chinese / Japanese / Korean → no `?` substitution
- [ ] Evidence:

## Tables

### CREATE TABLE — covers all major column types

```sql
CREATE TABLE qa_t (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  email        VARCHAR(255) UNIQUE,
  age          TINYINT UNSIGNED,
  salary       DECIMAL(15,2),
  bio          TEXT,
  payload      JSON,
  binary_data  BLOB,
  is_active    BOOLEAN DEFAULT TRUE,
  status       ENUM('active','inactive','pending') DEFAULT 'pending',
  tags         SET('a','b','c'),
  birth_date   DATE,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_name (name),
  KEY idx_status_active (status, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] Statement runs → table appears in tree
- [ ] Expand table → all columns + types + NULL/NOT NULL + defaults correct
- [ ] Indexes visible (PK, UNIQUE, idx_name, idx_status_active)
- [ ] AUTO_INCREMENT starts at 1
- [ ] Evidence: paste expand-table screenshot

### ALTER TABLE
- [ ] `ALTER TABLE qa_t ADD COLUMN phone VARCHAR(20) AFTER email` → column added at right position
- [ ] `ALTER TABLE qa_t MODIFY COLUMN phone VARCHAR(50) NOT NULL DEFAULT ''` → type+nullable updated
- [ ] `ALTER TABLE qa_t DROP COLUMN phone`
- [ ] `ALTER TABLE qa_t ADD INDEX idx_email (email)` then `DROP INDEX idx_email`
- [ ] `ALTER TABLE qa_t RENAME TO qa_t_renamed` → tree updates
- [ ] Evidence:

### DROP / TRUNCATE
- [ ] `TRUNCATE TABLE qa_t` → table kept, rows 0, AUTO_INCREMENT reset
- [ ] `DROP TABLE qa_t` → gone from tree
- [ ] Evidence:

## Indexes

- [ ] B-tree index: `CREATE INDEX idx_n ON qa_t(name)`
- [ ] Composite: `CREATE INDEX idx_ns ON qa_t(name, status)`
- [ ] UNIQUE: `CREATE UNIQUE INDEX uq_email ON qa_t(email)`
- [ ] FULLTEXT (MySQL/MariaDB only): `CREATE FULLTEXT INDEX ft_bio ON qa_t(bio)`
- [ ] Functional index (MySQL 8.0+): `CREATE INDEX idx_lower_email ON qa_t((LOWER(email)))`
- [ ] `SHOW INDEX FROM qa_t` → all listed
- [ ] EXPLAIN proves index used: `EXPLAIN SELECT * FROM qa_t WHERE name='x'`
- [ ] Evidence:

## Views

- [ ] `CREATE VIEW qa_v AS SELECT id, name FROM qa_t WHERE is_active = TRUE`
- [ ] `SELECT * FROM qa_v` returns rows
- [ ] Updatable view: `UPDATE qa_v SET name='X' WHERE id=1` → underlying table updated
- [ ] `CREATE OR REPLACE VIEW qa_v AS ...` works
- [ ] `DROP VIEW qa_v`
- [ ] Tree shows views under their own group
- [ ] Evidence:

## Constraints

- [ ] PRIMARY KEY enforces uniqueness — duplicate INSERT fails (ER_DUP_ENTRY 1062)
- [ ] UNIQUE — same, duplicate fails
- [ ] NOT NULL — INSERT with NULL fails (ER_BAD_NULL_ERROR 1048)
- [ ] DEFAULT — INSERT omitting column uses default
- [ ] CHECK (MySQL 8.0.16+ / MariaDB): `ALTER TABLE qa_t ADD CONSTRAINT chk_age CHECK (age >= 0)`
- [ ] FK: `ALTER TABLE child ADD FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE`
- [ ] FK CASCADE works (delete parent → children gone)
- [ ] FK RESTRICT fails on delete-with-children
- [ ] Evidence:

## Functions / Stored procedures

```sql
DELIMITER //
CREATE FUNCTION qa_double(x INT) RETURNS INT DETERMINISTIC RETURN x * 2;
CREATE PROCEDURE qa_proc(IN n VARCHAR(100)) BEGIN INSERT INTO qa_t(name) VALUES(n); END;
//
DELIMITER ;
```

- [ ] Function created → callable: `SELECT qa_double(5)` → 10
- [ ] Procedure created → callable: `CALL qa_proc('test')`
- [ ] Tree shows under Functions / Procedures group
- [ ] DDL gen for proc/func produces valid recreate script (with DELIMITER)
- [ ] `DROP FUNCTION qa_double`, `DROP PROCEDURE qa_proc`
- [ ] Evidence:

### DELIMITER handling
- [ ] Editor: paste full script with DELIMITER → app sends as single batch, not split on `;`
- [ ] Evidence:

## Triggers

```sql
CREATE TRIGGER qa_before_insert BEFORE INSERT ON qa_t FOR EACH ROW
SET NEW.created_at = NOW();
```

- [ ] Created, fires on INSERT (verify by inserting and checking created_at)
- [ ] `SHOW TRIGGERS` → listed
- [ ] BEFORE / AFTER × INSERT / UPDATE / DELETE all work
- [ ] `DROP TRIGGER qa_before_insert`
- [ ] Tree shows triggers under Tables → Triggers group
- [ ] Evidence:

## Sequences

- MySQL itself: no sequences (uses AUTO_INCREMENT only)
- **MariaDB 10.3+**: `CREATE SEQUENCE seq_x START WITH 100`; `SELECT NEXTVAL(seq_x)`
  - [ ] Sequence created, NEXTVAL increments
  - [ ] Tree shows under Sequences (MariaDB only)

## Users · Roles · Grants

```sql
CREATE USER 'qa_user'@'%' IDENTIFIED BY 'StrongPass!2026';
GRANT SELECT, INSERT, UPDATE ON qa_db.qa_t TO 'qa_user'@'%';
SHOW GRANTS FOR 'qa_user'@'%';
```

- [ ] User created → appears in `mysql.user`
- [ ] Connect with new user → can SELECT qa_t, cannot SELECT other tables
- [ ] `REVOKE INSERT ON qa_db.qa_t FROM 'qa_user'@'%'` → INSERT now fails
- [ ] Roles (MySQL 8.0+): `CREATE ROLE 'qa_role'`, `GRANT ALL ON qa_db.* TO 'qa_role'`, `GRANT 'qa_role' TO 'qa_user'@'%'`, `SET DEFAULT ROLE 'qa_role' TO 'qa_user'@'%'`
- [ ] After SET DEFAULT ROLE, qa_user sees full DB privs
- [ ] `DROP USER 'qa_user'@'%'`
- [ ] Evidence:

### Password change
- [ ] `ALTER USER 'qa_user'@'%' IDENTIFIED BY 'NewPass!'` → works
- [ ] Old password no longer accepted

## DML / Query

### INSERT
- [ ] Single row INSERT
- [ ] Multi-row INSERT: `INSERT INTO qa_t (name) VALUES ('a'),('b'),('c')`
- [ ] INSERT ... SELECT
- [ ] INSERT ... ON DUPLICATE KEY UPDATE (upsert)
- [ ] INSERT IGNORE
- [ ] INSERT with sub-second timestamp precision (DATETIME(6))
- [ ] Evidence: paste affected-rows for each

### UPDATE / DELETE
- [ ] `UPDATE qa_t SET name=UPPER(name) WHERE id<10`
- [ ] `UPDATE qa_t JOIN qa_t2 ON ... SET qa_t.x = qa_t2.y`
- [ ] `DELETE FROM qa_t WHERE id IN (SELECT id FROM tmp)`
- [ ] Multi-table DELETE: `DELETE qa_t, qa_t2 FROM qa_t JOIN qa_t2 ON ...`
- [ ] Evidence:

### SELECT — query shapes
- [ ] Simple: `SELECT * FROM qa_t WHERE id=1`
- [ ] JOINs: INNER, LEFT, RIGHT, CROSS (MySQL has no FULL OUTER — verify FAILS gracefully)
- [ ] Subquery (correlated and non): `SELECT * FROM a WHERE id IN (SELECT id FROM b WHERE …)`
- [ ] EXISTS / NOT EXISTS
- [ ] CTE (MySQL 8.0+): `WITH cte AS (SELECT …) SELECT * FROM cte`
- [ ] Recursive CTE: ancestor chain query → terminates
- [ ] Window functions (MySQL 8.0+): ROW_NUMBER(), RANK(), LAG, LEAD, SUM() OVER (PARTITION BY …)
- [ ] GROUP BY + HAVING + ORDER BY + LIMIT
- [ ] UNION / UNION ALL / INTERSECT (8.0.31+) / EXCEPT (8.0.31+)
- [ ] JSON functions: `JSON_EXTRACT`, `->>` operator
- [ ] FULLTEXT search: `MATCH(col) AGAINST('term' IN NATURAL LANGUAGE MODE)`
- [ ] Evidence:

### Type-specific queries
- [ ] BIGINT precision: insert max signed bigint, SELECT — grid shows correct (or as string if > MAX_SAFE_INTEGER)
- [ ] DECIMAL: precision preserved
- [ ] JSON: `WHERE payload->'$.k' = 'v'`
- [ ] ENUM: `WHERE status = 'active'`
- [ ] SET: `WHERE FIND_IN_SET('a', tags)`
- [ ] Evidence:

## Transactions

(See [`../features/transactions.md`](../features/transactions.md) for full battery.)

Quick verify here:
- [ ] InnoDB tables transactional; MyISAM not (skip if no MyISAM)
- [ ] DDL implicitly commits — manual-commit mode UI warns before DDL runs
- [ ] Savepoints: `SAVEPOINT sp1; ROLLBACK TO sp1`
- [ ] Isolation levels: `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` works
- [ ] Evidence:

## Dialect-specific quirks

### MySQL
- [ ] `sql_mode` ONLY_FULL_GROUP_BY warning surfaces in linter
- [ ] `utf8` (3-byte) vs `utf8mb4` (4-byte) — verify connection forces utf8mb4
- [ ] `DELETE` cannot use table alias in single-table form — try and verify

### MariaDB
- [ ] `RETURNING` clause (MariaDB 10.5+) on INSERT / UPDATE / DELETE
- [ ] `SEQUENCE` (covered above)
- [ ] System-versioned tables (`WITH SYSTEM VERSIONING`) — DDL gen captures
- [ ] Vector type / vector index (MariaDB 11.7+) — verify driver doesn't crash on `VECTOR` column

### OceanBase (MySQL mode)
- [ ] `VERSION()` returns OceanBase version
- [ ] Tenant info: `SELECT TENANT_NAME FROM oceanbase.DBA_OB_TENANTS`
- [ ] Partition operations: `ALTER TABLE … MODIFY PARTITION` works

### TiDB
- [ ] AUTO_RANDOM column type instead of AUTO_INCREMENT (recommended for distributed)
- [ ] `tidb_decode_plan('...')` for plan decoding
- [ ] `EXPLAIN ANALYZE` shows TiKV/TiFlash node breakdown
- [ ] `SHOW REGIONS` works for sharding info

## Known limitations

- mysql2 driver does NOT support multiple statements per query by default — app config forces `multipleStatements: true` for editor execute; verify it's NOT enabled for inline param queries (SQLi vector)
- LONGTEXT / LONGBLOB > 1MB may need `max_allowed_packet` tuning server-side
- ENUM ordering is by definition, not lexical — verify ORDER BY on ENUM column matches DDL order
- FK off by default in some replication setups — health check should flag
