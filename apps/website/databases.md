---
title: 支持的数据库
description: SkylerX 支持的 17 个 SQL + 3 个 NoSQL 方言列表,含驱动包名与协议说明
---

# 支持的数据库

SkylerX 通过**统一的驱动抽象层**(`@db-tool/core-driver`)接入各方言。SQL 方言走 `execute(sql, params)`,NoSQL 走 `executeCommand(payload)` 平行通道。

新增方言只需:

1. 在 `DbDialect` 枚举里加一项
2. 在 `dialects/<name>.ts` 里实现 `DatabaseDriver` 接口
3. `dialects/index.ts` 注册一行

<DatabaseGrid />

## 协议兼容性矩阵

很多"新"方言用现有协议(MySQL wire / PG wire)兼容,这些可以**直接复用对应驱动**,几乎零成本接入:

### MySQL 协议族(用 `mysql2`)

- MySQL · MariaDB · OceanBase · TiDB · Doris · StarRocks

### PostgreSQL 协议族(用 `pg`)

- PostgreSQL · 人大金仓 KingbaseES · openGauss · Greenplum · CockroachDB · H2(PG-server 模式) · Amazon Redshift

### 各自独立驱动

| 方言 | 驱动包 | 说明 |
|---|---|---|
| Oracle | `oracledb` | 默认 thin 模式,纯 JS 无需 Instant Client;支持 SYSDBA / SYSOPER 角色 |
| 达梦 DM | `dmdb` | 官方分发包,惰性加载,信创主推 |
| SQL Server | `mssql` | 纯 JS,支持 Windows / SQL Auth |
| SQLite | `better-sqlite3` | 本地文件,支持 `.db` / `.sqlite` |
| DuckDB | `@duckdb/node-api` | 本地文件,OLAP 友好;BigInt 自动字符串化避免精度丢失 |
| ClickHouse | `@clickhouse/client` | HTTP 协议 |
| Snowflake | `snowflake-sdk` | 云 DW,支持密码 / 私钥 / OAuth 鉴权 |
| TDengine 涛思 | `@tdengine/websocket` | WebSocket 协议,时序场景 |

### NoSQL 平行通道

| 方言 | 驱动包 | 通道 |
|---|---|---|
| MongoDB | `mongodb` | `executeCommand({ op, args, context })`,支持 find/aggregate/insert/update/delete 等 op |
| Redis | `ioredis` | `executeCommand({ op, args })`,SCAN 抽样 + 全量 TYPE 拉取 |
| Elasticsearch | `@elastic/elasticsearch` | REST/HTTP,支持 search/get/bulk/raw 等 op |

## 国产信创全家桶

SkylerX 是少数**原生支持全部主流国产数据库**的开源工具:

| 数据库 | 厂商 | 协议 | 状态 |
|---|---|---|---|
| **达梦 DM** | 达梦数据库 | 自有 | ✅ 完整 |
| **人大金仓 KingbaseES** | 人大金仓 | PG 兼容 | ✅ 完整 |
| **openGauss** | 华为 / 中国移动 | PG 兼容 | ✅ 完整 |
| **OceanBase** | 蚂蚁 | MySQL 兼容(也支持 Oracle 租户) | ✅ 完整 |
| **TiDB** | PingCAP | MySQL 兼容 | ✅ 完整 |
| **TDengine** | 涛思 | WebSocket | ✅ 完整 |

配套功能:
- 🛡 **国密 SM2/SM3/SM4** 加解密工具
- 📋 **等保 2.0 合规检查**面板(MySQL + PG 系)
- 🔄 **Oracle → 达梦 DM 迁移向导**(自动翻译类型 + 函数 + DDL)

## 兼容性说明

| 场景 | 支持度 |
|---|---|
| 主流 SQL 标准查询(SELECT / JOIN / WINDOW / CTE) | ✅ 全方言 |
| 编辑器:语法高亮 / 自动补全 / 格式化 | ✅ 全 SQL 方言 |
| 可视化结果集 / 可编辑网格 | ✅ 全 SQL 方言 |
| EXPLAIN 可视化 | ✅ MySQL / PG / 主流方言 |
| Manual commit 手动事务模式 | ✅ MySQL / PG / Oracle / DM / SQL Server / Snowflake / OceanBase / KingbaseES / Greenplum / openGauss / TiDB / CockroachDB |
| 慢查询日志解析 | ✅ MySQL 系 + PG 系 |
| 复制延迟监控 | ✅ MySQL 系 + PG 系 + SQL Server AOAG |
| 结构对比 / 数据对比 | ✅ 全 SQL 方言 |
| 备份 / 恢复(SQL 格式,跨平台) | ✅ 全 SQL 方言 |
| AI 助手 | ✅ 全方言(SQL 翻译跨方言互转) |

## 缺少你的数据库?

- [提 Issue 申请新方言 →](https://github.com/duhbbx/SkylerX/issues/new)
- 协议兼容的方言(基于 MySQL / PG wire)**5 分钟可接入**
- 企业自研数据库可联系商务合作:`duhbbx@gmail.com`
