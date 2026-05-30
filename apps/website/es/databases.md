---
title: Bases de datos soportadas
description: Lista de los 17 dialectos SQL + 3 NoSQL soportados por SkylerX, con paquetes de driver y notas de protocolo
---

# Bases de datos soportadas

SkylerX integra cada dialecto mediante una **capa unificada de abstracción de drivers** (`@db-tool/core-driver`). Los dialectos SQL pasan por `execute(sql, params)`; los NoSQL usan el canal paralelo `executeCommand(payload)`.

Añadir un nuevo dialecto se reduce a:

1. Agregar una entrada al enum `DbDialect`
2. Implementar la interfaz `DatabaseDriver` en `dialects/<name>.ts`
3. Registrarlo con una línea en `dialects/index.ts`

<DatabaseGrid />

## Matriz de compatibilidad de protocolos

Muchos dialectos "nuevos" son compatibles con protocolos existentes (MySQL wire / PG wire), por lo que pueden **reutilizar directamente el driver correspondiente**, con coste de integración casi nulo:

### Familia del protocolo MySQL (usa `mysql2`)

- MySQL · MariaDB · OceanBase · TiDB · Doris · StarRocks

### Familia del protocolo PostgreSQL (usa `pg`)

- PostgreSQL · KingbaseES (人大金仓) · openGauss · Greenplum · CockroachDB · H2 (modo PG-server) · Amazon Redshift

### Drivers independientes

| Dialecto | Paquete del driver | Notas |
|---|---|---|
| Oracle | `oracledb` | Modo thin por defecto, JS puro sin Instant Client; soporta roles SYSDBA / SYSOPER |
| 达梦 DM | `dmdb` | Paquete oficial, carga perezosa, recomendado para 信创 |
| SQL Server | `mssql` | JS puro, soporta Windows / SQL Auth |
| SQLite | `better-sqlite3` | Archivo local, soporta `.db` / `.sqlite` |
| DuckDB | `@duckdb/node-api` | Archivo local, orientado a OLAP; BigInt se convierte automáticamente a string para evitar pérdida de precisión |
| ClickHouse | `@clickhouse/client` | Protocolo HTTP |
| Snowflake | `snowflake-sdk` | DW en la nube, soporta autenticación con contraseña / clave privada / OAuth |
| TDengine 涛思 | `@tdengine/websocket` | Protocolo WebSocket, escenarios de series temporales |

### Canal paralelo NoSQL

| Dialecto | Paquete del driver | Canal |
|---|---|---|
| MongoDB | `mongodb` | `executeCommand({ op, args, context })`, soporta ops find/aggregate/insert/update/delete, etc. |
| Redis | `ioredis` | `executeCommand({ op, args })`, muestreo SCAN + extracción completa de TYPE |
| Elasticsearch | `@elastic/elasticsearch` | REST/HTTP, soporta ops search/get/bulk/raw, etc. |

## Suite completa para el ecosistema chino 信创

SkylerX es una de las pocas herramientas open source con **soporte nativo para todas las principales bases de datos chinas**:

| Base de datos | Proveedor | Protocolo | Estado |
|---|---|---|---|
| **达梦 DM** | Dameng | Propio | ✅ Completo |
| **KingbaseES (人大金仓)** | Renmin University Kingbase | Compatible PG | ✅ Completo |
| **openGauss** | Huawei / China Mobile | Compatible PG | ✅ Completo |
| **OceanBase** | Ant Group | Compatible MySQL (también tenant Oracle) | ✅ Completo |
| **TiDB** | PingCAP | Compatible MySQL | ✅ Completo |
| **TDengine** | TAOS Data | WebSocket | ✅ Completo |

Funciones complementarias:
- 🛡 Utilidad de cifrado/descifrado con **algoritmos nacionales chinos SM2/SM3/SM4**
- 📋 Panel de **cumplimiento GB17859 (等保 2.0)** (familia MySQL + PG)
- 🔄 **Asistente de migración Oracle → 达梦 DM** (traducción automática de tipos + funciones + DDL)

## Notas de compatibilidad

| Escenario | Soporte |
|---|---|
| Consultas SQL estándar (SELECT / JOIN / WINDOW / CTE) | ✅ Todos los dialectos |
| Editor: resaltado / autocompletado / formateo | ✅ Todos los dialectos SQL |
| Resultados visuales / cuadrícula editable | ✅ Todos los dialectos SQL |
| EXPLAIN visual | ✅ MySQL / PG / dialectos principales |
| Modo de transacciones manuales (Manual commit) | ✅ MySQL / PG / Oracle / DM / SQL Server / Snowflake / OceanBase / KingbaseES / Greenplum / openGauss / TiDB / CockroachDB |
| Análisis del log de consultas lentas | ✅ Familia MySQL + familia PG |
| Monitor de retardo de replicación | ✅ Familia MySQL + familia PG + SQL Server AOAG |
| Comparación de estructura / datos | ✅ Todos los dialectos SQL |
| Backup / restauración (formato SQL, multiplataforma) | ✅ Todos los dialectos SQL |
| Asistente de IA | ✅ Todos los dialectos (traducción SQL entre dialectos) |

## ¿Falta tu base de datos?

- [Abre un Issue solicitando un nuevo dialecto →](https://github.com/duhbbx/SkylerX/issues/new)
- Los dialectos compatibles con protocolo (basados en MySQL / PG wire) **se integran en 5 minutos**
- Para bases de datos empresariales propias, contacta para colaboración: `duhbbx@gmail.com`
