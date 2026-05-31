---
title: Roteiro
description: Próximos bancos de dados e funcionalidades planejadas do SkylerX.
---

# Roteiro

> Última atualização: 2026-05-31 · Plano direcional, não é um compromisso. A cadência real depende de feedback e recursos.
> Versão completa: [ROADMAP.md no GitHub](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md)

## Legenda

- ✅ Publicado · 🟢 Em andamento / este trimestre · 🔵 Próximo trimestre · ⚪ Candidato · 🟣 Longo prazo

## 1. Bancos de dados

### Já suportados

MySQL · MariaDB · PostgreSQL · SQLite · H2 · Oracle · SQL Server · DM (达梦) · KingbaseES · OceanBase · TiDB · GBase · ClickHouse · Snowflake · Redshift · Apache Doris · StarRocks · DuckDB · TDengine · MongoDB · Redis · Elasticsearch

### 🟢 2026 T3

- **PolarDB-PG / -X** (nuvem)
- **GaussDB** (Huawei, modo PG)
- **TimescaleDB** (séries temporais / ext. PG)
- **Cassandra / ScyllaDB** (CQL)
- **InfluxDB 3.x** (FlightSQL)

### 🔵 2026 T4

- **Trino / Presto** (consultas federadas)
- **Apache Hive** (HS2)
- **Neo4j** (grafo, Cypher)
- **Couchbase** (N1QL)
- **AWS DynamoDB** (PartiQL)
- **pgvector / Milvus / Qdrant** (vetorial)

### ⚪ 2027 S1

Apache IoTDB · Nebula Graph · SequoiaDB · GreatSQL · Hologres · Lindorm · TDSQL-C · QuestDB · Druid · Pinot · Flink SQL Gateway · Materialize · RisingWave · Vertica · BigQuery · Athena

## 2. Funcionalidades

| Categoria | Marcos próximos |
|---|---|
| **Editor** | Modo Notebook · Visual Query Builder · Speech-to-SQL · Tradutor de SP entre dialetos |
| **Grade** | Visão Form · Filtro multi-valor estilo Excel · Master/Detail · Lookup de FK |
| **Esquema** | Diagrama ER com layout automático · Engenharia direta · Migração v2 |
| **DBA** | Detecção de índices mortos · Reescrita IA de queries lentas · Dashboard de replicação |
| **IA** | Mock data v2 (FK-aware) · Health check v2 · Autocompletar streaming · RAG sobre esquema |
| **Colab.** | Sincronização de conexões E2E · Biblioteca de queries da equipe · Edição web |
| **Exportação** | Visualizador de gráficos (ECharts) · Push para BI (Metabase / Superset / PowerBI / Tableau) |
| **Plataforma** | Assinatura de código (macOS / Windows) · Sentry · Playwright E2E |

## Como participar

- Vote em [Issues](https://github.com/duhbbx/SkylerX/issues)
- Nova solicitação: [Feature request](https://github.com/duhbbx/SkylerX/issues/new/choose)
- Roteiro completo: [ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md)
