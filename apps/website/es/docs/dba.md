# DBA y monitorización

SkylerX integra como paneles las "vistas en tiempo real" más usadas en el día a día del DBA: lista de procesos / transacciones largas / esperas por bloqueo / lag de replicación / Top N de slow queries / métricas del servidor / topología de clúster / privilegios.

Todos los paneles **lanzan SQL directamente contra la conexión objetivo** (sin agente intermedio), sin colectores adicionales y sin modificar la configuración del servidor. Las sentencias y el enrutado por dialecto de cada panel se pueden verificar línea a línea en el código `packages/ui/src/components/*Dialog.vue`.

## Resumen de entradas

Las funciones DBA no tienen menú propio; se acceden por la **paleta de comandos**: `⌘K` / `Ctrl+K` y buscas el nombre. Las que dependen de la conexión (como "Actividad del servidor", "Slow query", "Lag de replicación" y "Topología OB") generan un comando por cada conexión registrada; la elegida define a qué base te conectas.

| Panel | Palabra clave | id de entrada |
|---|---|---|
| Actividad del servidor | `服务器活动 / Server activity` | `act:activity:<connId>` |
| Lag de replicación | `复制延迟 / Replication lag` | `act:repl:<connId>` |
| Análisis del slow query log | `慢查询 / Slow query` | `act:slowq:<connId>` |
| Log de operaciones | `操作日志 / Operation log` | `act:oplog` |
| Monitor del servidor | `服务器监控 / Server monitor` | `act:monitor` |
| Topología de clúster OceanBase | `OceanBase` | `act:obtopo:<connId>` |
| Usuarios y privilegios | `用户与权限 / Users & privileges` | `act:privileges` |

El atajo de la paleta lo define `DEFAULT_KEY_BINDINGS.palette = 'CmdOrCtrl+K'`; se puede cambiar en "Ajustes → Atajos personalizados".

---

## Actividad del servidor

`ServerActivityDialog.vue` — título `Actividad del servidor · {conn}`. Tres pestañas, con botón de refresco arriba + desplegable de auto-refresh (2s / 5s / 10s / off).

### Tres paneles

#### Lista de procesos (`tabProcesses`)

| Familia | SQL |
|---|---|
| MySQL | `information_schema.PROCESSLIST WHERE COMMAND <> 'Sleep' ORDER BY TIME DESC` |
| PostgreSQL | `pg_stat_activity WHERE state IS NOT NULL AND pid <> pg_backend_pid()` |
| SQL Server | `sys.dm_exec_sessions` JOIN `sys.dm_exec_requests` + `OUTER APPLY sys.dm_exec_sql_text(r.sql_handle)` |

Los nombres de columna se normalizan en SQL (`id / user / host / db / time / state / info`) para que la cabecera sea idéntica en los tres dialectos.

#### Transacciones largas (`tabLongTx`)

| Familia | SQL |
|---|---|
| MySQL | `information_schema.INNODB_TRX ORDER BY trx_started ASC` (devuelve `rows_locked / rows_modified`) |
| PostgreSQL | `pg_stat_activity WHERE xact_start IS NOT NULL` |
| SQL Server | `sys.dm_tran_active_transactions` JOIN `sys.dm_tran_session_transactions` |

#### Esperas por bloqueo (`tabLocks`)

| Familia | SQL |
|---|---|
| MySQL | `performance_schema.data_lock_waits` |
| PostgreSQL | `pg_locks` JOIN `pg_stat_activity` con autojoin "blocked / blocking" |
| SQL Server | `sys.dm_tran_locks WHERE request_status = 'WAIT'` |

### Operación KILL

En las pestañas de procesos y transacciones largas, cada fila tiene a la derecha el botón `✗ KILL`; al pulsarlo aparece un diálogo de "Terminar sesión / transacción"; al confirmar se ejecuta según dialecto:

| Familia | Sentencia KILL |
|---|---|
| MySQL | `KILL <id>` |
| PostgreSQL | `SELECT pg_terminate_backend(<pid>)` |
| SQL Server | `KILL <spid>` |

La pestaña de bloqueos no ofrece KILL (en los bloqueos lo normal es matar al blocker en la lista de procesos).

### Reglas de adaptación por dialecto

La entrada usa `familyOfConn()`: primero `dialectKind` para NoSQL → rechaza (`'NoSQL no aplica a este panel'`); en otro caso `ddl.familyOf(dialect)`:

- **Familia MySQL** directa → MariaDB / TiDB / OceanBase / Doris / StarRocks
- **Familia PG** reutiliza la rama PG → CockroachDB / Greenplum / OpenGauss / KingbaseES / H2 (`ddl.ts` clasifica H2 en pg)
- **SQL Server** → rama mssql
- Otros: `El dialecto actual no soporta este panel`

---

## Monitor de replicación (lag)

`ReplicationLagDialog.vue` — título `Lag de replicación primaria/secundaria · {conn}`.

En la parte superior se muestran el **badge del dialecto + rol + opciones de auto-refresh (por defecto 5s; valores off / 2s / 5s / 10s)**. Hay cuatro roles, detectados en SQL y diferenciados por color:

| Rol | Detección | Color |
|---|---|---|
| Primario (`source`) | MySQL: alguna de `SHOW REPLICAS` / `SHOW SLAVE HOSTS` / `SHOW BINARY LOG STATUS` devuelve filas; PG: `pg_stat_replication` con filas; MSSQL: replica local con `role_desc = 'PRIMARY'` | Verde |
| Secundario (`replica`) | MySQL: `SHOW REPLICA STATUS` / `SHOW SLAVE STATUS` con filas; PG: `pg_is_in_recovery() = true`; MSSQL: local `role_desc = 'SECONDARY'` | Azul |
| Independiente (`standalone`) | Todas las pruebas vacías | Gris |
| Desconocido (`unknown`) | Dialecto no soportado | Gris |

### Detalle del enrutado por dialecto

#### Familia MySQL

Cuatro fallbacks; al primero que devuelva filas se para:

1. `SHOW REPLICA STATUS` (nombre nuevo en MySQL 8.0.22+)
2. `SHOW SLAVE STATUS` (nombre antiguo, compatible con 5.7 / 8.0 < 22 / MariaDB)
3. Si los anteriores están vacíos → `SHOW REPLICAS` para listar las réplicas downstream
4. Fallback a `SHOW BINARY LOG STATUS` / `SHOW MASTER STATUS`

Las columnas devueltas se proyectan con los campos clave al principio: `Channel_Name / Source_Host / Replica_IO_Running / Seconds_Behind_Source / Last_Error`, etc.

#### Familia PostgreSQL

```sql
-- 1) 先判 standby
SELECT pg_is_in_recovery() AS is_replica
-- 2a) 从库视角
SELECT
  EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::int AS lag_seconds,
  pg_last_wal_receive_lsn()::text,
  pg_last_wal_replay_lsn()::text
-- 2b) 主库视角
SELECT pid, application_name, state, sync_state,
  EXTRACT(EPOCH FROM write_lag)  AS write_lag_seconds,
  EXTRACT(EPOCH FROM flush_lag)  AS flush_lag_seconds,
  EXTRACT(EPOCH FROM replay_lag) AS replay_lag_seconds,
  sent_lsn, write_lsn, flush_lsn, replay_lsn
FROM pg_stat_replication
```

#### SQL Server (AOAG)

`sys.dm_hadr_database_replica_states` JOIN `sys.availability_replicas` + `sys.dm_hadr_availability_replica_states`, con columnas como `synchronization_state_desc / synchronization_health_desc / log_send_queue_size / redo_queue_size / DATEDIFF(SECOND, last_commit_time, GETDATE()) AS lag_seconds`.

Sin AOAG → standalone.

### Umbrales de color

Constantes del código:

```ts
const LAG_WARN   = 5    // 黄
const LAG_DANGER = 30   // 红
```

Solo aplican a columnas "lag en segundos"; nombres candidatos: `lag_seconds / Seconds_Behind_Source / Seconds_Behind_Master / replay_lag_seconds / write_lag_seconds / flush_lag_seconds`.

### Tolerancia a fallos

`looksLikeNoReplication()` mapea errores que contengan `not configured / not a slave / not a replica / no such / access denied / permission denied / privilege / does not exist` a un aviso gris "réplica no configurada", para que un permiso insuficiente no llene la página de rojo.

Si alguno de `Last_Error / Last_IO_Error / Last_SQL_Error` no es vacío → banner rojo destacado arriba.

---

## Análisis de slow queries

`SlowQueryDialog.vue` + `slowQuery.ts` — título `Análisis del slow query log`.

Herramienta solo lectura: **no aplica ningún SET por ti**. Activar el log, retención y umbrales son decisiones del DBA; SkylerX solo lee la tabla de digest existente.

### Fuentes

| Familia (`slowFamilyOf`) | Dialectos | Fuente |
|---|---|---|
| `mysql` | MySQL / MariaDB / TiDB / OceanBase / Doris / StarRocks | `performance_schema.events_statements_summary_by_digest` |
| `pg` | PostgreSQL / CockroachDB / Greenplum / OpenGauss / KingbaseES / Redshift | Extensión `pg_stat_statements` |
| `other` | Resto | Muestra `slowq.unsupported` |

> `slowFamilyOf()` no reutiliza `ddl.familyOf()`: este último incluye H2 en pg y no contempla Redshift, son fronteras distintas para este módulo.

### Plantillas

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

Las unidades `*_TIMER_WAIT` son picosegundos (10⁻¹² s); se convierten a ms dividiendo entre `1e9`. El parámetro `schema` lo rellena automáticamente `connection.database`.

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

### Orden, Top N, aviso de no habilitado

- Desplegable superior "Ordenar": tiempo total / tiempo medio / número de llamadas; al cambiar **se vuelve a ejecutar con un nuevo `ORDER BY`**, no se reordena en frontend
- LIMIT por defecto 50; el código aplica `Math.max(1, Math.min(500, limit))`, tope 500
- Detección de activación: MySQL `SHOW VARIABLES LIKE 'slow_query_log'`; PG `SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements'`
- Si falla la detección → la lista se sustituye por un aviso "no habilitado" con **SQL pegable para activarlo** (MySQL: `SET GLOBAL slow_query_log = ON; SET GLOBAL long_query_time = 1; …`; PG: `CREATE EXTENSION IF NOT EXISTS pg_stat_statements; …`)

### Acciones tras desplegar una fila

Al expandir aparece el SQL completo y 4 botones:

| Botón | Acción |
|---|---|
| Copiar | `navigator.clipboard.writeText(sql)` |
| Abrir como consulta | emit `openSql` → el contenedor padre abre una nueva pestaña |
| Ejecutar EXPLAIN | Lanza `EXPLAIN <sql>` (sin el `;` final); el resultado se renderiza inline. **No usa ANALYZE** para no ejecutar accidentalmente operaciones de escritura |
| Optimizar con IA | emit `optimizeWithAi` → manda el SQL al Toolbox "Optimizar SQL" |

---

## Log de operaciones

`OperationLogDialog.vue` — título `Log de operaciones`. **Auditoría local de SkylerX**; no es el audit log del servidor.

Al abrir, lee todas las conexiones registradas; de cada una toma los últimos 200 `connections.history`, los fusiona y los muestra en orden descendente por `executedAt`. Por fila: marca éxito/fallo, hora de ejecución, conexión, duración (ms), SQL en una sola línea.

### Filtros

| Dimensión | Opciones |
|---|---|
| Estado | Todos / éxito / fallo |
| Conexión | Todas / una específica |
| Texto | Coincidencia case-insensitive `includes` en el SQL |

### Exportar

"Exportar CSV" exporta el resultado filtrado actual; nombre `skylerx-operation-log.csv`, columnas: `time,connection,status,duration_ms,sql`.

Al pulsar una fila → `emit openSql(connId, sql)` envía la sentencia al editor (y cierra el diálogo).

---

## Topología de clúster

### ClusterTopologyDialog general (TiDB / OceanBase)

`ClusterTopologyDialog.vue` — dos pestañas: **Nodos** / **TiKV Stores | Region/Tablet** (el nombre cambia por dialecto).

| Dialecto | Pestaña Nodos | Pestaña Regions |
|---|---|---|
| TiDB | `information_schema.cluster_info` (tidb / tikv / pd / tiflash) | `information_schema.tikv_store_status` (`store_id, address, store_state_name, capacity, available, leader_count, region_count`) |
| OceanBase | `oceanbase.DBA_OB_SERVERS` | Primero `oceanbase.GV$OB_TABLET_TO_LS LIMIT 200`; si falla, fallback a `oceanbase.DBA_OB_UNITS` |
| Otros | `'Este dialecto no soporta topología de clúster'` | Igual a la columna izquierda |

Las columnas de bytes (`capacity / available / size$`) se formatean en KB / MB / GB / TB con base 1024 en el frontend.

### Topología específica de OceanBase

`OceanBaseTopologyDialog.vue` — título `Topología de clúster OceanBase`; entrada visible solo cuando el dialecto es OceanBase.

Cuatro tarjetas de conteo en la parte superior (Zones / Observers / Tenants / Units) + árbol Zone → Observer a la izquierda + lista Tenant → Unit a la derecha (expandible). Las cuatro vistas se **consultan en paralelo**; si alguna falla, banner con aviso pero se mantienen los datos anteriores correctos.

| Vista | SQL |
|---|---|
| Zones | `SELECT zone, status, idc, region FROM oceanbase.DBA_OB_ZONES ORDER BY zone` |
| Observers | `SELECT svr_ip, svr_port, zone, status, with_rootserver, build_version, start_service_time FROM oceanbase.DBA_OB_SERVERS ORDER BY zone, svr_ip` |
| Tenants | `SELECT tenant_id, tenant_name, tenant_type, primary_zone, compatibility_mode, status, locked, locality FROM oceanbase.DBA_OB_TENANTS ORDER BY tenant_id` |
| Units | `SELECT unit_id, resource_pool_id, unit_group_id, tenant_id, zone, svr_ip, svr_port, status FROM oceanbase.DBA_OB_UNITS ORDER BY tenant_id, zone, svr_ip` |

Coloreado: `ACTIVE / NORMAL` verde, `INACTIVE / OFFLINE / DELETING` rojo, otros amarillos. El `tenant_type` usa emoji: 👑 SYS / ⚙ META / 🏢 USER. Click en la IP del observer copia `svr_ip:svr_port`.

Auto-refresh: off / 5s / 10s / 30s (por defecto off).

---

## Monitor del servidor

`ServerMonitorDialog.vue` — título `Monitor del servidor`.

El desplegable cambia entre conexiones registradas (solo activable en dialectos soportados); al arrancar, hace polling **cada 2 segundos con setInterval** y mantiene en memoria hasta 60 puntos de muestreo para los sparklines.

### Soporte de dialecto

```ts
function fam(d) {
  if ([MySQL, MariaDB, OceanBase].includes(d)) return 'mysql'
  if ([PostgreSQL, KingbaseES].includes(d)) return 'pg'
  return 'other'
}
```

### Métricas MySQL (vía `SHOW GLOBAL STATUS` + `SHOW VARIABLES LIKE 'max_connections'`)

| Tarjeta | Fuente |
|---|---|
| Uptime | `Uptime` (formato `Xd Yh Zm`) |
| QPS | Diferencia de (`Queries`/`Questions`) entre intervalos |
| Conexiones | `Threads_connected / max_connections` |
| En ejecución | `Threads_running` |
| Slow queries | `Slow_queries` |
| Conexiones rechazadas | `Aborted_connects` |

### Métricas PostgreSQL (SQL agregado)

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

Tarjetas: uptime / TPS (diferencias de xacts) / conexiones / en ejecución / esperando lock / hit ratio de buffer `hit / (hit + rd) * 100%`.

El título del sparkline al pie muestra `QPS` o `TPS` según el dialecto.

---

## Usuarios y privilegios

`PrivilegesDialog.vue` + `privileges.ts` — título `Usuarios y privilegios`.

Columna izquierda con usuarios/roles + columna derecha con "permisos existentes" / "constructor de GRANT".

### Soporte de dialecto

| Familia | SQL para listar usuarios | SQL para ver permisos |
|---|---|---|
| MySQL (incluye MariaDB / OceanBase) | `SELECT User, Host FROM mysql.user` | `SHOW GRANTS FOR 'usr'@'host'` |
| PostgreSQL (incluye KingbaseES) | `SELECT rolname FROM pg_roles WHERE rolcanlogin` | `information_schema.role_table_grants` |
| Oracle (incluye DM) | `SELECT username FROM all_users WHERE oracle_maintained = 'N'` (12c+) | `dba_sys_privs ∪ dba_role_privs ∪ dba_tab_privs` |
| SQL Server | `sys.database_principals WHERE type IN ('S','U','G')` | `sys.database_permissions` JOIN `sys.database_principals` |
| Otros | Muestra `priv.unsupported` | No soportado |

> Oracle consulta los permisos vía vistas `dba_*`; si el usuario de conexión no tiene rol DBA, devuelve ORA-00942; la UI lo captura y lo muestra en el panel "Permisos existentes".

### Constructor de GRANT

Marca permisos + rellena el objetivo + opcional `WITH GRANT OPTION` → genera el preview en tiempo real, por ejemplo:

```sql
GRANT SELECT, INSERT ON sales.orders TO 'app'@'%' WITH GRANT OPTION;
```

Los permisos preseleccionados son `COMMON_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL PRIVILEGES']`.

El grantee se formatea por dialecto:

| Dialecto | Formato |
|---|---|
| MySQL | `'user'@'host'` (host vacío → `%`) |
| SQL Server | `[user]` (`]` se escapa como `]]`) |
| Oracle | `"USER"` (mayúsculas; `"` escapa a `""`) |
| Otros | `"user"` |

### No aplica directamente

**SkylerX no ejecuta GRANT / REVOKE por ti**. Dos botones:

- Copiar → al portapapeles
- Abrir como consulta → manda al editor; lo ejecutas tú (pasando por el canal SQL de SkylerX, donde la [protección de producción](/es/docs/connections#proteccion-de-produccion) bloquea las marcadas como prod)

`buildRevoke()` también está exportado en `privileges.ts`, pero la UI no tiene formulario REVOKE; si te hace falta, edita el preview del GRANT.

---

## Matriz de compatibilidad

| Función | Familia MySQL | Familia PG | SQL Server | Oracle / DM | OceanBase | TiDB | NoSQL |
|---|---|---|---|---|---|---|---|
| Actividad: procesos | `information_schema.PROCESSLIST` | `pg_stat_activity` | `dm_exec_sessions` | — | Rama MySQL | Rama MySQL | No aplica |
| Actividad: transacciones largas | `INNODB_TRX` | `pg_stat_activity` | `dm_tran_active_transactions` | — | Rama MySQL | Rama MySQL | — |
| Actividad: esperas por bloqueo | `data_lock_waits` | `pg_locks` | `dm_tran_locks` | — | Rama MySQL | Rama MySQL | — |
| KILL | `KILL <id>` | `pg_terminate_backend` | `KILL <spid>` | — | ✓ | ✓ | — |
| Lag de replicación | `SHOW REPLICA STATUS`, etc. | `pg_stat_replication` / `pg_last_xact_replay_timestamp` | AOAG `dm_hadr_database_replica_states` | — | Rama MySQL | Rama MySQL | — |
| Slow queries | `events_statements_summary_by_digest` | `pg_stat_statements` | — | — | ✓ | ✓ | — |
| Monitor del servidor | `SHOW GLOBAL STATUS` | Agregado `pg_stat_*` | — | — | Rama MySQL (solo KingbaseES por pg) | — | — |
| Topología de clúster | — | — | — | — | `DBA_OB_*` | `cluster_info / tikv_store_status` | — |
| Topología OB (específica) | — | — | — | — | ✓ | — | — |
| Usuarios y privilegios | `mysql.user` | `pg_roles` | `database_principals` | `all_users` + `dba_*` | Rama MySQL | Rama MySQL | — |
| Log de operaciones (local) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

> **"Rama X"** significa que `ddl.familyOf()` (o `slowFamilyOf` / `fam()`) clasifica ese dialecto en X, reutilizando el mismo SQL; no garantiza coincidencia exacta de nombres de columna entre versiones. Doris / StarRocks son compatibles con MySQL y suelen exponer `events_statements_summary_by_digest` en su FE; alguna versión que no lo exponga caerá en el aviso amigable "no habilitado".

> **NoSQL (Redis / MongoDB / Elasticsearch)** se cortocircuitan en el panel de actividad mediante `dialectKind(NoSql)`; no se envía SQL, se sugiere "usa ⚙ Server → cliente / slow log". La monitorización en vivo de Redis está en el `RedisMonitorDialog`, fuera del alcance de esta página.
