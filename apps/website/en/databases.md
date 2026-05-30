---
title: Supported databases
description: The 17 SQL + 3 NoSQL dialects SkylerX supports, with driver packages and protocol notes
---

# Supported databases

SkylerX hooks into each dialect through a **unified driver abstraction** (`@db-tool/core-driver`). SQL dialects go through `execute(sql, params)`; NoSQL dialects use a parallel `executeCommand(payload)` channel.

Adding a new dialect takes three steps:

1. Add an entry to the `DbDialect` enum
2. Implement the `DatabaseDriver` interface in `dialects/<name>.ts`
3. Register one line in `dialects/index.ts`

<DatabaseGrid />

## Protocol compatibility matrix

Many "new" dialects are wire-compatible with an existing protocol (MySQL wire / PG wire). They **reuse the existing driver** at essentially zero cost:

### MySQL protocol family (uses `mysql2`)

- MySQL · MariaDB · OceanBase · TiDB · Doris · StarRocks

### PostgreSQL protocol family (uses `pg`)

- PostgreSQL · KingbaseES · openGauss · Greenplum · CockroachDB · H2 (PG-server mode) · Amazon Redshift

### Dedicated drivers

| Dialect | Driver | Notes |
|---|---|---|
| Oracle | `oracledb` | Defaults to thin mode — pure JS, no Instant Client; supports SYSDBA / SYSOPER roles |
| DM | `dmdb` | Official package, lazy-loaded; the workhorse for Chinese-vendor compliance |
| SQL Server | `mssql` | Pure JS, supports Windows / SQL auth |
| SQLite | `better-sqlite3` | Local file, `.db` / `.sqlite` |
| DuckDB | `@duckdb/node-api` | Local file, OLAP-friendly; BigInts auto-stringified to avoid precision loss |
| ClickHouse | `@clickhouse/client` | HTTP protocol |
| Snowflake | `snowflake-sdk` | Cloud DW, supports password / private-key / OAuth auth |
| TDengine | `@tdengine/websocket` | WebSocket protocol, time-series workloads |

### NoSQL parallel channel

| Dialect | Driver | Channel |
|---|---|---|
| MongoDB | `mongodb` | `executeCommand({ op, args, context })`, supports find/aggregate/insert/update/delete and more |
| Redis | `ioredis` | `executeCommand({ op, args })`, SCAN sampling + bulk TYPE fetch |
| Elasticsearch | `@elastic/elasticsearch` | REST/HTTP, supports search/get/bulk/raw and more |

## The full Chinese-vendor stack

SkylerX is one of the few open-source tools with **native support for every mainstream Chinese database**:

| Database | Vendor | Protocol | Status |
|---|---|---|---|
| **DM** | Dameng | proprietary | ✅ Full |
| **KingbaseES** | Kingbase | PG-compatible | ✅ Full |
| **openGauss** | Huawei / China Mobile | PG-compatible | ✅ Full |
| **OceanBase** | Ant | MySQL-compatible (also Oracle tenant) | ✅ Full |
| **TiDB** | PingCAP | MySQL-compatible | ✅ Full |
| **TDengine** | Taos Data | WebSocket | ✅ Full |

Companion features:
- 🛡 **SM2/SM3/SM4** (Chinese cryptography) helpers
- 📋 **MLPS 2.0 compliance check** panel (MySQL + PG families)
- 🔄 **Oracle → DM migration wizard** (auto-translates types + functions + DDL)

## Compatibility notes

| Scenario | Support |
|---|---|
| Mainstream SQL (SELECT / JOIN / WINDOW / CTE) | ✅ All dialects |
| Editor: highlighting / autocomplete / format | ✅ All SQL dialects |
| Result grid / editable cells | ✅ All SQL dialects |
| EXPLAIN visualizer | ✅ MySQL / PG / major dialects |
| Manual-commit transaction mode | ✅ MySQL / PG / Oracle / DM / SQL Server / Snowflake / OceanBase / KingbaseES / Greenplum / openGauss / TiDB / CockroachDB |
| Slow-query log analysis | ✅ MySQL family + PG family |
| Replication lag monitoring | ✅ MySQL family + PG family + SQL Server AOAG |
| Schema / data diff | ✅ All SQL dialects |
| Backup / restore (SQL format, cross-platform) | ✅ All SQL dialects |
| AI assistant | ✅ All dialects (cross-dialect SQL translation included) |

## Database not listed?

- [File an issue to request a new dialect →](https://github.com/duhbbx/SkylerX/issues/new)
- Protocol-compatible dialects (MySQL / PG wire) can be added **in 5 minutes**
- For proprietary enterprise databases, reach out: `duhbbx@gmail.com`
