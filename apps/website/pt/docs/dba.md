# DBA e monitoramento

O SkylerX traz painéis "ao vivo" que DBA usa em troubleshooting: lista de processos / transações longas / esperas de lock / atraso de replicação / Top N slow queries / métricas do servidor / topologia de cluster / privilégios.

Todos **executam SQL direto na conexão alvo** (sem agente intermediário), sem coletor adicional, sem alterar configuração do banco. As SQLs de coleta e o roteamento por dialeto podem ser conferidos linha a linha em `packages/ui/src/components/*Dialog.vue`.

## Entradas

Funções de DBA não têm menu próprio; vão pela **paleta de comandos**: `⌘K` / `Ctrl+K` → busca pelo nome. Recursos por conexão ("Atividade do servidor", "Slow query", "Replicação", "Topologia OB") aparecem como uma entrada por conexão registrada.

| Painel | Chave na paleta | id |
|---|---|---|
| Atividade do servidor | `Atividade / Server activity` | `act:activity:<connId>` |
| Atraso de replicação | `Replicação / Replication lag` | `act:repl:<connId>` |
| Análise de slow query | `Slow query` | `act:slowq:<connId>` |
| Log de operações | `Log de operações / Operation log` | `act:oplog` |
| Monitor do servidor | `Server monitor` | `act:monitor` |
| Topologia OceanBase | `OceanBase` | `act:obtopo:<connId>` |
| Usuários e privilégios | `Users & privileges` | `act:privileges` |

Atalho da paleta: `DEFAULT_KEY_BINDINGS.palette = 'CmdOrCtrl+K'`, customizável em "Settings → Atalhos".

---

## Atividade do servidor

`ServerActivityDialog.vue` — título `Atividade do servidor · {conn}`. 3 abas, botão "Refresh" + auto-refresh (2s / 5s / 10s / off).

### Três painéis

#### Lista de processos (`tabProcesses`)

| Família | SQL |
|---|---|
| MySQL | `information_schema.PROCESSLIST WHERE COMMAND <> 'Sleep' ORDER BY TIME DESC` |
| PostgreSQL | `pg_stat_activity WHERE state IS NOT NULL AND pid <> pg_backend_pid()` |
| SQL Server | `sys.dm_exec_sessions` JOIN `sys.dm_exec_requests` + `OUTER APPLY sys.dm_exec_sql_text(r.sql_handle)` |

Os nomes de coluna são normalizados (`id / user / host / db / time / state / info`) — header igual nas três famílias.

#### Transações longas (`tabLongTx`)

| Família | SQL |
|---|---|
| MySQL | `information_schema.INNODB_TRX ORDER BY trx_started ASC` (`rows_locked / rows_modified`) |
| PostgreSQL | `pg_stat_activity WHERE xact_start IS NOT NULL` |
| SQL Server | `sys.dm_tran_active_transactions` JOIN `sys.dm_tran_session_transactions` |

#### Esperas de lock (`tabLocks`)

| Família | SQL |
|---|---|
| MySQL | `performance_schema.data_lock_waits` |
| PostgreSQL | `pg_locks` JOIN `pg_stat_activity` para blocked/blocking |
| SQL Server | `sys.dm_tran_locks WHERE request_status = 'WAIT'` |

### KILL

Nas abas processo / transação, cada linha tem `✗ KILL` à direita; confirma e executa por dialeto:

| Família | KILL |
|---|---|
| MySQL | `KILL <id>` |
| PostgreSQL | `SELECT pg_terminate_backend(<pid>)` |
| SQL Server | `KILL <spid>` |

Aba de locks não tem KILL (locks são causados por blockers; vá na lista de processos matar o blocker).

### Adaptação por dialeto

`familyOfConn()`: primeiro `dialectKind` para NoSQL → rejeita (`'NoSQL não se aplica a este painel'`); senão `ddl.familyOf(dialect)`:

- **Família MySQL** → MariaDB / TiDB / OceanBase / Doris / StarRocks
- **Família PG** → CockroachDB / Greenplum / OpenGauss / KingbaseES / H2 (em `ddl.ts`, H2 vai como pg)
- **SQL Server**
- Demais → `Dialeto não suportado neste painel`

---

## Monitoramento de replicação

`ReplicationLagDialog.vue` — título `Replicação master/replica · {conn}`.

Topo exibe **badge do dialeto + papel + auto-refresh (default 5s, opções off / 2s / 5s / 10s)**. Quatro papéis, identificados no SQL e coloridos:

| Papel | Critério | Cor |
|---|---|---|
| Master (`source`) | MySQL: `SHOW REPLICAS` / `SHOW SLAVE HOSTS` / `SHOW BINARY LOG STATUS` com linhas; PG: `pg_stat_replication` com linhas; MSSQL: replica local `role_desc = 'PRIMARY'` | verde |
| Replica (`replica`) | MySQL: `SHOW REPLICA STATUS` / `SHOW SLAVE STATUS` com linhas; PG: `pg_is_in_recovery() = true`; MSSQL: local `role_desc = 'SECONDARY'` | azul |
| Standalone | Tudo vazio | cinza |
| Unknown | Dialeto não suportado | cinza |

### Roteamento por dialeto

#### Família MySQL

Quatro etapas, para na primeira com linhas:

1. `SHOW REPLICA STATUS` (MySQL 8.0.22+)
2. `SHOW SLAVE STATUS` (legado, 5.7 / 8.0 <22 / MariaDB)
3. `SHOW REPLICAS` (listar downstreams)
4. `SHOW BINARY LOG STATUS` / `SHOW MASTER STATUS`

Projeção: `Channel_Name / Source_Host / Replica_IO_Running / Seconds_Behind_Source / Last_Error` na frente.

#### Família PostgreSQL

```sql
-- 1) standby?
SELECT pg_is_in_recovery() AS is_replica
-- 2a) visão da replica
SELECT
  EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::int AS lag_seconds,
  pg_last_wal_receive_lsn()::text,
  pg_last_wal_replay_lsn()::text
-- 2b) visão do master
SELECT pid, application_name, state, sync_state,
  EXTRACT(EPOCH FROM write_lag)  AS write_lag_seconds,
  EXTRACT(EPOCH FROM flush_lag)  AS flush_lag_seconds,
  EXTRACT(EPOCH FROM replay_lag) AS replay_lag_seconds,
  sent_lsn, write_lsn, flush_lsn, replay_lsn
FROM pg_stat_replication
```

#### SQL Server (AOAG)

`sys.dm_hadr_database_replica_states` JOIN `sys.availability_replicas` + `sys.dm_hadr_availability_replica_states`, campos como `synchronization_state_desc / synchronization_health_desc / log_send_queue_size / redo_queue_size / DATEDIFF(SECOND, last_commit_time, GETDATE()) AS lag_seconds`.

Sem AOAG → standalone.

### Limiares de cor

```ts
const LAG_WARN   = 5    // amarelo
const LAG_DANGER = 30   // vermelho
```

Aplica em colunas "lag segundos": `lag_seconds / Seconds_Behind_Source / Seconds_Behind_Master / replay_lag_seconds / write_lag_seconds / flush_lag_seconds`.

### Tolerância

`looksLikeNoReplication()` converte erros com `not configured / not a slave / not a replica / no such / access denied / permission denied / privilege / does not exist` em dica cinza "replicação não configurada", evitando página vermelha por falta de permissão.

`Last_Error / Last_IO_Error / Last_SQL_Error` não vazios → banner vermelho destacado.

---

## Análise de slow query

`SlowQueryDialog.vue` + `slowQuery.ts` — título `Análise de slow query`.

Apenas leitura: **não altera variáveis SET**. Habilitação, retenção e threshold são decisões do DBA; o SkylerX só lê o que já existe.

### Origem

| Família (`slowFamilyOf`) | Dialetos | Fonte |
|---|---|---|
| `mysql` | MySQL / MariaDB / TiDB / OceanBase / Doris / StarRocks | `performance_schema.events_statements_summary_by_digest` |
| `pg` | PostgreSQL / CockroachDB / Greenplum / OpenGauss / KingbaseES / Redshift | extensão `pg_stat_statements` |
| `other` | demais | `slowq.unsupported` |

> `slowFamilyOf()` não reusa `ddl.familyOf()` — esta coloca H2 em pg e não tem Redshift, fronteiras diferentes deste módulo.

### Templates

#### MySQL — `events_statements_summary_by_digest`

```sql
SELECT
  DIGEST_TEXT AS sql_text,
  COUNT_STAR  AS exec_count,
  ROUND(AVG_TIMER_WAIT/1e9, 2) AS avg_ms,
  ROUND(SUM_TIMER_WAIT/1e9, 2) AS total_ms,
  ROUND(MAX_TIMER_WAIT/1e9, 2) AS max_ms,
  SUM_ROWS_EXAMINED AS rows_examined,
  SUM_ROWS_SENT     AS rows_sent,
  SUM_NO_INDEX_USED AS no_index_count,
  FIRST_SEEN, LAST_SEEN
FROM performance_schema.events_statements_summary_by_digest
WHERE (? IS NULL OR SCHEMA_NAME = ?)
ORDER BY <SUM_TIMER_WAIT | AVG_TIMER_WAIT | COUNT_STAR> DESC
LIMIT 50
```

`*_TIMER_WAIT` em picosegundos (10⁻¹² s); `/1e9` para ms. Parâmetro `schema` preenchido com connection.database.

#### PostgreSQL — `pg_stat_statements`

```sql
SELECT
  query AS sql_text,
  calls AS exec_count,
  ROUND(mean_exec_time::numeric, 2)  AS avg_ms,
  ROUND(total_exec_time::numeric, 2) AS total_ms,
  ROUND(max_exec_time::numeric, 2)   AS max_ms,
  rows AS rows_sent,
  shared_blks_hit, shared_blks_read
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY <total_exec_time | mean_exec_time | calls> DESC NULLS LAST
LIMIT 50
```

### Ordenação, Top N, aviso de não-habilitação

- Dropdown de ordenação: tempo total / médio / chamadas — **re-roda com novo ORDER BY**
- Limite default 50; código `Math.max(1, Math.min(500, limit))` cap em 500
- Detecção: MySQL `SHOW VARIABLES LIKE 'slow_query_log'`; PG `SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements'`
- Falha → "não habilitado" com **SQL de habilitação pronto para colar** (MySQL: `SET GLOBAL slow_query_log = ON; SET GLOBAL long_query_time = 1; …`; PG: `CREATE EXTENSION IF NOT EXISTS pg_stat_statements; …`)

### Ações em cada linha expandida

| Botão | Ação |
|---|---|
| Copiar | `navigator.clipboard.writeText(sql)` |
| Abrir como consulta | `openSql` → nova aba |
| EXPLAIN | `EXPLAIN <sql>` (sem `;` final); resultado inline. **Sem ANALYZE** para evitar writes |
| Otimizar com IA | `optimizeWithAi` → AI Toolbox "otimizar SQL" |

---

## Log de operações

`OperationLogDialog.vue` — título `Log de operações`. **Auditoria local do SkylerX**, não o audit log do banco.

Ao abrir, busca todas as conexões registradas e cada `connections.history` (últimos 200), combinando por `executedAt`. Cada linha: ✓/✗, tempo, conexão, duração (ms), SQL em uma linha.

### Filtros

| Dimensão | Opções |
|---|---|
| Status | tudo / sucesso / falha |
| Conexão | tudo / uma específica |
| Keyword | substring case-insensitive no SQL |

### Exportar

"Exportar CSV" exporta o filtrado: `skylerx-operation-log.csv`, colunas `time,connection,status,duration_ms,sql`.

Clique em linha → `openSql(connId, sql)` → consulta (fecha o diálogo).

---

## Topologia de cluster

### ClusterTopologyDialog genérico (TiDB / OceanBase)

`ClusterTopologyDialog.vue` — duas abas: **Nodes** / **TiKV Stores | Region/Tablet** (nome muda por dialeto).

| Dialeto | Nodes | Regions |
|---|---|---|
| TiDB | `information_schema.cluster_info` (tidb / tikv / pd / tiflash) | `information_schema.tikv_store_status` (`store_id, address, store_state_name, capacity, available, leader_count, region_count`) |
| OceanBase | `oceanbase.DBA_OB_SERVERS` | `oceanbase.GV$OB_TABLET_TO_LS LIMIT 200`, fallback `oceanbase.DBA_OB_UNITS` |
| Outros | `'topologia de cluster não suportada para este dialeto'` | — |

Colunas em bytes (`capacity / available / size$`) formatadas em KB / MB / GB / TB.

### Topologia dedicada do OceanBase

`OceanBaseTopologyDialog.vue` — título `Topologia OceanBase`, só visível em conexões OB.

Topo: 4 contadores (Zones / Observers / Tenants / Units) + árvore Zone → Observer à esquerda + lista Tenant → Units à direita (clicável). 4 views **em paralelo**; falhas exibem banner, mantendo o último resultado.

| View | SQL |
|---|---|
| Zones | `SELECT zone, status, idc, region FROM oceanbase.DBA_OB_ZONES ORDER BY zone` |
| Observers | `SELECT svr_ip, svr_port, zone, status, with_rootserver, build_version, start_service_time FROM oceanbase.DBA_OB_SERVERS ORDER BY zone, svr_ip` |
| Tenants | `SELECT tenant_id, tenant_name, tenant_type, primary_zone, compatibility_mode, status, locked, locality FROM oceanbase.DBA_OB_TENANTS ORDER BY tenant_id` |
| Units | `SELECT unit_id, resource_pool_id, unit_group_id, tenant_id, zone, svr_ip, svr_port, status FROM oceanbase.DBA_OB_UNITS ORDER BY tenant_id, zone, svr_ip` |

Cores: `ACTIVE / NORMAL` verde, `INACTIVE / OFFLINE / DELETING` vermelho, demais amarelo. tenant_type emojis: 👑 SYS / ⚙ META / 🏢 USER. Clique no endereço do observer copia `svr_ip:svr_port`.

Auto-refresh: off / 5s / 10s / 30s (default off).

---

## Monitor do servidor

`ServerMonitorDialog.vue` — título `Monitor do servidor`.

Dropdown muda entre conexões registradas (suportadas), `setInterval` a cada 2s polling, mantém até 60 amostras em memória para sparkline.

### Suporte

```ts
function fam(d) {
  if ([MySQL, MariaDB, OceanBase].includes(d)) return 'mysql'
  if ([PostgreSQL, KingbaseES].includes(d)) return 'pg'
  return 'other'
}
```

### Métricas MySQL (via `SHOW GLOBAL STATUS` + `SHOW VARIABLES LIKE 'max_connections'`)

| Card | Origem |
|---|---|
| Uptime | `Uptime` (`Xd Yh Zm`) |
| QPS | (`Queries`/`Questions` delta) / delta de tempo |
| Conexões | `Threads_connected / max_connections` |
| Em execução | `Threads_running` |
| Slow | `Slow_queries` |
| Conn recusadas | `Aborted_connects` |

### Métricas PostgreSQL (uma SQL agregada)

```sql
SELECT
  (SELECT count(*) FROM pg_stat_activity) AS conns,
  (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') AS active,
  (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock') AS waiting,
  (SELECT sum(xact_commit + xact_rollback) FROM pg_stat_database) AS xacts,
  (SELECT sum(blks_hit) FROM pg_stat_database) AS hit,
  (SELECT sum(blks_read) FROM pg_stat_database) AS rd,
  extract(epoch FROM (now() - pg_postmaster_start_time()))::bigint AS uptime
```

Cards: uptime / TPS (delta de xacts) / conexões / em execução / esperando lock / hit ratio `hit / (hit + rd) * 100%`.

Título da sparkline alterna entre `QPS` ou `TPS` por dialeto.

---

## Usuários e privilégios

`PrivilegesDialog.vue` + `privileges.ts` — título `Usuários e privilégios`.

Coluna esquerda: lista de usuários/roles. Direita: "grants existentes" + "construtor de GRANT".

### Suporte

| Família | Lista usuários | Lista grants |
|---|---|---|
| MySQL (inclui MariaDB / OB) | `SELECT User, Host FROM mysql.user` | `SHOW GRANTS FOR 'usr'@'host'` |
| PostgreSQL (inclui KingbaseES) | `SELECT rolname FROM pg_roles WHERE rolcanlogin` | `information_schema.role_table_grants` |
| Oracle (inclui DM) | `SELECT username FROM all_users WHERE oracle_maintained = 'N'` (12c+) | `dba_sys_privs ∪ dba_role_privs ∪ dba_tab_privs` |
| SQL Server | `sys.database_principals WHERE type IN ('S','U','G')` | `sys.database_permissions` JOIN `sys.database_principals` |
| Outros | `priv.unsupported` | — |

> Para Oracle, usa `dba_*`. Sem DBA, `ORA-00942`; UI captura e exibe na coluna de grants.

### Construtor de GRANT

Marque privilégios + alvo + `WITH GRANT OPTION` → preview ao vivo, ex.:

```sql
GRANT SELECT, INSERT ON sales.orders TO 'app'@'%' WITH GRANT OPTION;
```

`COMMON_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL PRIVILEGES']` pré-marcados.

Grantee formatado por dialeto:

| Dialeto | Formato |
|---|---|
| MySQL | `'user'@'host'` (host vazio = `%`) |
| SQL Server | `[user]` (`]` escapa para `]]`) |
| Oracle | `"USER"` (maiúsculo, `"` escapa para `""`) |
| Outros | `"user"` |

### Não aplica direto

**SkylerX não executa GRANT / REVOKE em seu nome**. Dois botões:

- Copiar → clipboard
- Abrir como consulta → vai para a aba de query; você executa (passa pelo canal SQL do SkylerX, com [proteção de produção](/pt/docs/connections#proteção-de-produção))

`buildRevoke()` existe em `privileges.ts`, mas a UI não tem formulário; ajuste manual no preview funciona.

---

## Matriz de compatibilidade

| Recurso | Família MySQL | Família PG | SQL Server | Oracle / DM | OceanBase | TiDB | NoSQL |
|---|---|---|---|---|---|---|---|
| Atividade: processos | `information_schema.PROCESSLIST` | `pg_stat_activity` | `dm_exec_sessions` | — | via MySQL | via MySQL | n/a |
| Atividade: transações longas | `INNODB_TRX` | `pg_stat_activity` | `dm_tran_active_transactions` | — | via MySQL | via MySQL | — |
| Atividade: locks | `data_lock_waits` | `pg_locks` | `dm_tran_locks` | — | via MySQL | via MySQL | — |
| KILL | `KILL <id>` | `pg_terminate_backend` | `KILL <spid>` | — | ✓ | ✓ | — |
| Replicação | `SHOW REPLICA STATUS` etc. | `pg_stat_replication` / `pg_last_xact_replay_timestamp` | AOAG `dm_hadr_database_replica_states` | — | via MySQL | via MySQL | — |
| Slow query | `events_statements_summary_by_digest` | `pg_stat_statements` | — | — | ✓ | ✓ | — |
| Monitor | `SHOW GLOBAL STATUS` | `pg_stat_*` agregado | — | — | via MySQL (apenas KingbaseES em pg) | — | — |
| Topologia | — | — | — | — | `DBA_OB_*` | `cluster_info / tikv_store_status` | — |
| OB dedicado | — | — | — | — | ✓ | — | — |
| Privilégios | `mysql.user` | `pg_roles` | `database_principals` | `all_users` + `dba_*` | via MySQL | via MySQL | — |
| Log de operações (local) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

> **"via X"** = `ddl.familyOf()` (ou `slowFamilyOf` / `fam()`) coloca o dialeto na família X, reusa o mesmo SQL; nem todas as versões têm exatamente as mesmas colunas. Doris / StarRocks compatíveis com MySQL geralmente expõem `events_statements_summary_by_digest`; versões sem expor caem no aviso "não habilitado".

> **NoSQL (Redis / MongoDB / Elasticsearch)** é curto-circuitado no painel de atividade (`dialectKind(NoSql)`); exibe "use ⚙ Server → Clientes / Slow log". Monitor Redis em tempo real está em `RedisMonitorDialog` (escopo separado).
