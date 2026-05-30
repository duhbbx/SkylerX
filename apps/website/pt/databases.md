---
title: Bancos de dados suportados
description: Lista dos 17 dialetos SQL + 3 NoSQL suportados pelo SkylerX, com nomes de pacotes de driver e descrições de protocolo
---

# Bancos de dados suportados

O SkylerX conecta-se a cada dialeto via uma **camada unificada de abstração de driver** (`@db-tool/core-driver`). Dialetos SQL usam `execute(sql, params)`, NoSQL usam o canal paralelo `executeCommand(payload)`.

Para adicionar um novo dialeto, basta:

1. Adicionar uma entrada no enum `DbDialect`
2. Implementar a interface `DatabaseDriver` em `dialects/<name>.ts`
3. Registrar uma linha em `dialects/index.ts`

<DatabaseGrid />

## Matriz de compatibilidade de protocolo

Muitos dialetos "novos" são compatíveis com protocolos existentes (MySQL wire / PG wire) e podem **reutilizar diretamente os drivers correspondentes**, com integração praticamente sem custo:

### Família protocolo MySQL (com `mysql2`)

- MySQL · MariaDB · OceanBase · TiDB · Doris · StarRocks

### Família protocolo PostgreSQL (com `pg`)

- PostgreSQL · KingbaseES · openGauss · Greenplum · CockroachDB · H2 (modo PG-server) · Amazon Redshift

### Drivers independentes

| Dialeto | Pacote de driver | Notas |
|---|---|---|
| Oracle | `oracledb` | Modo thin por padrão, JS puro sem Instant Client; suporta papéis SYSDBA / SYSOPER |
| 达梦 DM | `dmdb` | Pacote oficial, carregamento lazy, principal recomendado para 信创 |
| SQL Server | `mssql` | JS puro, suporta autenticação Windows / SQL |
| SQLite | `better-sqlite3` | Arquivo local, suporta `.db` / `.sqlite` |
| DuckDB | `@duckdb/node-api` | Arquivo local, amigável a OLAP; BigInt auto-stringified para evitar perda de precisão |
| ClickHouse | `@clickhouse/client` | Protocolo HTTP |
| Snowflake | `snowflake-sdk` | DW na nuvem, suporta senha / chave privada / OAuth |
| TDengine 涛思 | `@tdengine/websocket` | Protocolo WebSocket, cenários de séries temporais |

### Canal paralelo NoSQL

| Dialeto | Pacote de driver | Canal |
|---|---|---|
| MongoDB | `mongodb` | `executeCommand({ op, args, context })`, suporta ops find/aggregate/insert/update/delete etc. |
| Redis | `ioredis` | `executeCommand({ op, args })`, amostragem SCAN + busca completa TYPE |
| Elasticsearch | `@elastic/elasticsearch` | REST/HTTP, suporta ops search/get/bulk/raw etc. |

## Suporte completo a bancos de dados chineses (信创)

O SkylerX é uma das poucas ferramentas open source com **suporte nativo a todos os principais bancos de dados chineses**:

| Banco de dados | Fabricante | Protocolo | Status |
|---|---|---|---|
| **达梦 DM** | 达梦数据库 | Próprio | ✅ Completo |
| **KingbaseES** | 人大金仓 | Compatível PG | ✅ Completo |
| **openGauss** | Huawei / China Mobile | Compatível PG | ✅ Completo |
| **OceanBase** | Ant | Compatível MySQL (também suporta tenant Oracle) | ✅ Completo |
| **TiDB** | PingCAP | Compatível MySQL | ✅ Completo |
| **TDengine** | 涛思 | WebSocket | ✅ Completo |

Recursos complementares:
- 🛡 Ferramenta de criptografia / descriptografia **Criptografia nacional chinesa SM2/SM3/SM4**
- 📋 Painel de **Conformidade GB17859 (segurança nível 2.0 da China)** (família MySQL + PG)
- 🔄 **Assistente de migração Oracle → 达梦 DM** (traduz tipos + funções + DDL automaticamente)

## Notas de compatibilidade

| Cenário | Suporte |
|---|---|
| Consultas SQL padrão (SELECT / JOIN / WINDOW / CTE) | ✅ Todos os dialetos |
| Editor: highlight sintático / autocompletar / formatação | ✅ Todos os dialetos SQL |
| Grade de resultados visual / editável | ✅ Todos os dialetos SQL |
| Visualização de EXPLAIN | ✅ MySQL / PG / principais dialetos |
| Modo de transação manual (Manual commit) | ✅ MySQL / PG / Oracle / DM / SQL Server / Snowflake / OceanBase / KingbaseES / Greenplum / openGauss / TiDB / CockroachDB |
| Análise de logs de slow query | ✅ Família MySQL + família PG |
| Monitor de atraso de replicação | ✅ Família MySQL + família PG + SQL Server AOAG |
| Comparação de estrutura / dados | ✅ Todos os dialetos SQL |
| Backup / restauração (formato SQL, multiplataforma) | ✅ Todos os dialetos SQL |
| Assistente de IA | ✅ Todos os dialetos (tradução SQL entre dialetos) |

## Não encontrou o seu banco?

- [Abra uma issue solicitando novo dialeto →](https://github.com/duhbbx/SkylerX/issues/new)
- Dialetos compatíveis (baseados em wire MySQL / PG) podem ser **integrados em 5 minutos**
- Bancos proprietários corporativos podem entrar em contato para parceria: `duhbbx@gmail.com`
