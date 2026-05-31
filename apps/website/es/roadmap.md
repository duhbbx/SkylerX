---
title: Hoja de ruta
description: Bases de datos próximas y funciones planificadas de SkylerX.
---

# Hoja de ruta

> Actualizado: 2026-05-31 · Plan direccional, no es un compromiso. La cadencia real depende del feedback y los recursos.
> Fuente completa: [ROADMAP.md en GitHub](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md)

## Leyenda

- ✅ Publicado · 🟢 En curso / este trimestre · 🔵 Próximo trimestre · ⚪ Candidato · 🟣 Largo plazo

## 1. Bases de datos

### Ya soportadas

MySQL · MariaDB · PostgreSQL · SQLite · H2 · Oracle · SQL Server · DM (达梦) · KingbaseES · OceanBase · TiDB · GBase · ClickHouse · Snowflake · Redshift · Apache Doris · StarRocks · DuckDB · TDengine · MongoDB · Redis · Elasticsearch

### 🟢 2026 Q3

- **PolarDB-PG / -X** (nube)
- **GaussDB** (Huawei, modo PG)
- **TimescaleDB** (series temporales / PG ext)
- **Cassandra / ScyllaDB** (CQL)
- **InfluxDB 3.x** (FlightSQL)

### 🔵 2026 Q4

- **Trino / Presto** (consultas federadas)
- **Apache Hive** (HiveServer2)
- **Neo4j** (grafo, Cypher)
- **Couchbase** (N1QL)
- **AWS DynamoDB** (PartiQL)
- **pgvector / Milvus / Qdrant** (vectores)

### ⚪ 2027 H1

Apache IoTDB · Nebula Graph · SequoiaDB · GreatSQL · Hologres · Lindorm · TDSQL-C · QuestDB · Druid · Pinot · Flink SQL Gateway · Materialize · RisingWave · Vertica · BigQuery · Athena

## 2. Funciones

| Categoría | Próximos hitos |
|---|---|
| **Editor** | Modo Notebook · Visual Query Builder · Speech-to-SQL · Traductor de SPs entre dialectos |
| **Grid de resultados** | Vista Form · Filtro multi-valor estilo Excel · Master/Detail · Lookup FK |
| **Esquema** | ER diagram auto-layout · Forward engineering · Migración v2 |
| **DBA** | Detección de índices muertos · Reescritura de queries lentas con IA · Dashboard de replicación |
| **IA** | Mock data v2 (FK-aware) · Health check v2 · Completado streaming · RAG sobre esquema |
| **Colaboración** | Sincronización de conexiones E2E · Biblioteca de queries en equipo · Edición web |
| **Exportación** | Visor de gráficos (ECharts) · Push a BI (Metabase / Superset / PowerBI / Tableau) |
| **Plataforma** | Firma de código (macOS / Windows) · Sentry · E2E Playwright |

## ¿Quieres participar?

- Vota issues en [GitHub Issues](https://github.com/duhbbx/SkylerX/issues)
- Nuevas peticiones: [Feature request](https://github.com/duhbbx/SkylerX/issues/new/choose)
- Roadmap completo: [ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md)
