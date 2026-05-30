---
title: Bases de données supportées
description: Liste des 17 dialectes SQL + 3 NoSQL supportés par SkylerX, avec noms de packages de drivers et notes sur les protocoles
---

# Bases de données supportées

SkylerX intègre chaque dialecte via une **couche d'abstraction unifiée de drivers** (`@db-tool/core-driver`). Les dialectes SQL passent par `execute(sql, params)`, les NoSQL par le canal parallèle `executeCommand(payload)`.

Ajouter un nouveau dialecte se résume à :

1. Ajouter une entrée dans l'enum `DbDialect`
2. Implémenter l'interface `DatabaseDriver` dans `dialects/<name>.ts`
3. Enregistrer une ligne dans `dialects/index.ts`

<DatabaseGrid />

## Matrice de compatibilité des protocoles

Beaucoup de "nouveaux" dialectes réutilisent des protocoles existants (MySQL wire / PG wire) ; ils **réutilisent directement le driver correspondant**, pour une intégration quasi gratuite :

### Famille protocole MySQL (via `mysql2`)

- MySQL · MariaDB · OceanBase · TiDB · Doris · StarRocks

### Famille protocole PostgreSQL (via `pg`)

- PostgreSQL · 人大金仓 KingbaseES · openGauss · Greenplum · CockroachDB · H2 (mode PG-server) · Amazon Redshift

### Drivers indépendants

| Dialecte | Package driver | Notes |
|---|---|---|
| Oracle | `oracledb` | Mode thin par défaut, pur JS sans Instant Client ; supporte les rôles SYSDBA / SYSOPER |
| 达梦 DM | `dmdb` | Package officiel, chargement paresseux, fer de lance du 信创 |
| SQL Server | `mssql` | Pur JS, supporte authentification Windows / SQL |
| SQLite | `better-sqlite3` | Fichier local, supporte `.db` / `.sqlite` |
| DuckDB | `@duckdb/node-api` | Fichier local, optimisé OLAP ; conversion automatique BigInt en chaîne pour éviter les pertes de précision |
| ClickHouse | `@clickhouse/client` | Protocole HTTP |
| Snowflake | `snowflake-sdk` | DW cloud, authentification mot de passe / clé privée / OAuth |
| TDengine 涛思 | `@tdengine/websocket` | Protocole WebSocket, scénarios time-series |

### Canal parallèle NoSQL

| Dialecte | Package driver | Canal |
|---|---|---|
| MongoDB | `mongodb` | `executeCommand({ op, args, context })`, supporte find/aggregate/insert/update/delete etc. |
| Redis | `ioredis` | `executeCommand({ op, args })`, échantillonnage SCAN + récupération TYPE complète |
| Elasticsearch | `@elastic/elasticsearch` | REST/HTTP, supporte search/get/bulk/raw etc. |

## Suite complète pour bases de données chinoises (信创)

SkylerX est l'un des rares outils open source à **supporter nativement toutes les bases chinoises majeures** :

| Base de données | Éditeur | Protocole | État |
|---|---|---|---|
| **达梦 DM** | 达梦数据库 | Propriétaire | ✅ Complet |
| **人大金仓 KingbaseES** | 人大金仓 | Compatible PG | ✅ Complet |
| **openGauss** | 华为 / 中国移动 | Compatible PG | ✅ Complet |
| **OceanBase** | 蚂蚁 | Compatible MySQL (et locataires Oracle) | ✅ Complet |
| **TiDB** | PingCAP | Compatible MySQL | ✅ Complet |
| **TDengine** | 涛思 | WebSocket | ✅ Complet |

Fonctionnalités associées :
- 🛡 Outil de chiffrement/déchiffrement **Cryptographie nationale chinoise SM2/SM3/SM4**
- 📋 Panneau de **vérification de Conformité GB17859 (sécurité chinoise niveau 2.0)** (familles MySQL + PG)
- 🔄 **Assistant de migration Oracle → 达梦 DM** (traduction automatique des types + fonctions + DDL)

## Notes de compatibilité

| Scénario | Niveau de support |
|---|---|
| Requêtes SQL standard (SELECT / JOIN / WINDOW / CTE) | ✅ Tous dialectes |
| Éditeur : coloration syntaxique / autocomplétion / formatage | ✅ Tous dialectes SQL |
| Grille de résultats visuelle / éditable | ✅ Tous dialectes SQL |
| Visualisation EXPLAIN | ✅ MySQL / PG / dialectes majeurs |
| Mode transaction manuelle (Manual commit) | ✅ MySQL / PG / Oracle / DM / SQL Server / Snowflake / OceanBase / KingbaseES / Greenplum / openGauss / TiDB / CockroachDB |
| Analyse des slow query logs | ✅ Famille MySQL + famille PG |
| Surveillance du lag de réplication | ✅ Famille MySQL + famille PG + SQL Server AOAG |
| Comparaison de structure / données | ✅ Tous dialectes SQL |
| Sauvegarde / restauration (format SQL, multiplateforme) | ✅ Tous dialectes SQL |
| Assistant IA | ✅ Tous dialectes (traduction SQL inter-dialectes) |

## Votre base de données manque ?

- [Ouvrir une Issue pour demander un nouveau dialecte →](https://github.com/duhbbx/SkylerX/issues/new)
- Les dialectes compatibles (basés sur les wires MySQL / PG) sont **intégrables en 5 minutes**
- Bases internes d'entreprise : contactez-nous pour un partenariat commercial : `duhbbx@gmail.com`
