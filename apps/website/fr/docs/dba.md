# DBA et monitoring

SkylerX intègre les "vues temps réel" courantes en triage DBA : liste des processus / transactions longues / verrouillages / lag de réplication / Top N requêtes lentes / métriques serveur / topologie cluster / privilèges.

Tous ces panneaux **exécutent directement du SQL sur la connexion cible** (pas d'agent intermédiaire), aucun collecteur supplémentaire, aucune modification de configuration de la base. Le SQL et le routage par dialecte de chaque panneau sont vérifiables dans `packages/ui/src/components/*Dialog.vue`.

## Vue d'ensemble des entrées

Les fonctionnalités DBA n'ont pas de menu dédié, toutes via la **palette de commandes** : `⌘K` / `Ctrl+K`, puis recherche par nom. Pour les fonctions liées à une connexion (Activité serveur, Slow query, Replication lag, OB topology), une entrée par connexion enregistrée est générée.

| Panneau | Mot-clé palette | ID entrée |
|---|---|---|
| Activité serveur | `Activité serveur / Server activity` | `act:activity:<connId>` |
| Lag de réplication | `Lag de réplication / Replication lag` | `act:repl:<connId>` |
| Analyse slow query log | `Slow query / Requêtes lentes` | `act:slowq:<connId>` |
| Journal d'opérations | `Journal d'opérations / Operation log` | `act:oplog` |
| Monitoring serveur | `Monitoring serveur / Server monitor` | `act:monitor` |
| Topologie cluster OceanBase | `OceanBase` | `act:obtopo:<connId>` |
| Utilisateurs et privilèges | `Utilisateurs et privilèges / Users & privileges` | `act:privileges` |

Le raccourci de la palette est `DEFAULT_KEY_BINDINGS.palette = 'CmdOrCtrl+K'`, modifiable dans « Settings → Raccourcis personnalisés ».

---

## Activité serveur

`ServerActivityDialog.vue` — titre `Activité serveur · {conn}`. 3 onglets, bouton « Rafraîchir » + auto-refresh (2s / 5s / 10s / off).

### Trois panneaux

#### Liste des processus (`tabProcesses`)

| Famille | SQL |
|---|---|
| MySQL | `information_schema.PROCESSLIST WHERE COMMAND <> 'Sleep' ORDER BY TIME DESC` |
| PostgreSQL | `pg_stat_activity WHERE state IS NOT NULL AND pid <> pg_backend_pid()` |
| SQL Server | `sys.dm_exec_sessions` JOIN `sys.dm_exec_requests` + `OUTER APPLY sys.dm_exec_sql_text(r.sql_handle)` |

Normalisation des colonnes au niveau SQL (`id / user / host / db / time / state / info`), en-têtes unifiés.

#### Transactions longues (`tabLongTx`)

| Famille | SQL |
|---|---|
| MySQL | `information_schema.INNODB_TRX ORDER BY trx_started ASC` (retourne `rows_locked / rows_modified`) |
| PostgreSQL | `pg_stat_activity WHERE xact_start IS NOT NULL` |
| SQL Server | `sys.dm_tran_active_transactions` JOIN `sys.dm_tran_session_transactions` |

#### Verrouillages (`tabLocks`)

| Famille | SQL |
|---|---|
| MySQL | `performance_schema.data_lock_waits` |
| PostgreSQL | `pg_locks` JOIN `pg_stat_activity` auto-jointure « bloqué / bloquant » |
| SQL Server | `sys.dm_tran_locks WHERE request_status = 'WAIT'` |

### Action KILL

Sur Processus / Long Tx, chaque ligne a un bouton `✗ KILL` à droite ; clic → popup « Terminer session / transaction » → confirmation → exécution selon dialecte :

| Famille | Instruction KILL |
|---|---|
| MySQL | `KILL <id>` |
| PostgreSQL | `SELECT pg_terminate_backend(<pid>)` |
| SQL Server | `KILL <spid>` |

Pas de KILL sur Verrouillages (le blocker est dans la liste de processus, c'est lui qu'il faut killer).

### Règles d'adaptation par dialecte

Entrée via `familyOfConn()` : `dialectKind` NoSQL → refus direct (`'Dialecte NoSQL inadapté à ce panneau'`) ; sinon `ddl.familyOf(dialect)` :

- **Famille MySQL** directe → MariaDB / TiDB / OceanBase / Doris / StarRocks
- **Famille PG** réutilise PG → CockroachDB / Greenplum / OpenGauss / KingbaseES / H2 (`ddl.ts` met H2 en PG)
- **SQL Server** → branche mssql
- Autres : `Ce dialecte n'est pas supporté par ce panneau`

---

## Monitoring du lag de réplication

`ReplicationLagDialog.vue` — titre `Lag réplication maître/esclave · {conn}`.

En haut : **badge dialecte + rôle + auto-refresh (défaut 5s, options off / 2s / 5s / 10s)**. Quatre rôles, déterminés au niveau SQL, couleur UI :

| Rôle | Détection | Couleur |
|---|---|---|
| Source (`source`) | MySQL : `SHOW REPLICAS` / `SHOW SLAVE HOSTS` / `SHOW BINARY LOG STATUS` retourne des lignes ; PG : `pg_stat_replication` non vide ; MSSQL : `role_desc = 'PRIMARY'` local | Vert |
| Réplica (`replica`) | MySQL : `SHOW REPLICA STATUS` / `SHOW SLAVE STATUS` non vide ; PG : `pg_is_in_recovery() = true` ; MSSQL : `role_desc = 'SECONDARY'` local | Bleu |
| Standalone | Toutes les sondes vides | Gris |
| Inconnu | Dialecte non supporté | Gris |

### Détails de routage par dialecte

#### Famille MySQL

Fallback en 4 étapes, arrêt dès qu'une retourne :

1. `SHOW REPLICA STATUS` (nouveau nom MySQL 8.0.22+)
2. `SHOW SLAVE STATUS` (ancien, compat 5.7 / 8.0 < 22 / MariaDB)
3. Vides → `SHOW REPLICAS` pour lister les répliques en aval
4. Fallback `SHOW BINARY LOG STATUS` / `SHOW MASTER STATUS`

Colonnes projetées avec "clés en premier" : `Channel_Name / Source_Host / Replica_IO_Running / Seconds_Behind_Source / Last_Error` etc., reste après.

#### Famille PostgreSQL

```sql
-- 1) Détecte standby
SELECT pg_is_in_recovery() AS is_replica
-- 2a) Vue réplique
SELECT
  EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::int AS lag_seconds,
  pg_last_wal_receive_lsn()::text,
  pg_last_wal_replay_lsn()::text
-- 2b) Vue maître
SELECT pid, application_name, state, sync_state,
  EXTRACT(EPOCH FROM write_lag)  AS write_lag_seconds,
  EXTRACT(EPOCH FROM flush_lag)  AS flush_lag_seconds,
  EXTRACT(EPOCH FROM replay_lag) AS replay_lag_seconds,
  sent_lsn, write_lsn, flush_lsn, replay_lsn
FROM pg_stat_replication
```

#### SQL Server (AOAG)

`sys.dm_hadr_database_replica_states` JOIN `sys.availability_replicas` + `sys.dm_hadr_availability_replica_states`, avec `synchronization_state_desc / synchronization_health_desc / log_send_queue_size / redo_queue_size / DATEDIFF(SECOND, last_commit_time, GETDATE()) AS lag_seconds`.

Sans config AOAG = standalone.

### Seuils de coloration

Constantes :

```ts
const LAG_WARN   = 5    // jaune
const LAG_DANGER = 30   // rouge
```

Coloration uniquement sur colonnes type "lag secondes" : `lag_seconds / Seconds_Behind_Source / Seconds_Behind_Master / replay_lag_seconds / write_lag_seconds / flush_lag_seconds`.

### Tolérance d'erreurs

`looksLikeNoReplication()` convertit les erreurs contenant `not configured / not a slave / not a replica / no such / access denied / permission denied / privilege / does not exist` en avertissement gris « réplication non activée », évite la page rouge sur manque de privilèges.

`Last_Error / Last_IO_Error / Last_SQL_Error` non vide → bandeau rouge en haut, surligné.

---

## Analyse des requêtes lentes

`SlowQueryDialog.vue` + `slowQuery.ts` — titre `Analyse des slow query logs`.

L'outil est en lecture seule : **ne SET aucune variable**. Activation, rétention, seuil d'échantillonnage sont des décisions DBA, SkylerX lit seulement les digests existants.

### Source

| Famille (`slowFamilyOf`) | Dialectes | Source |
|---|---|---|
| `mysql` | MySQL / MariaDB / TiDB / OceanBase / Doris / StarRocks | `performance_schema.events_statements_summary_by_digest` |
| `pg` | PostgreSQL / CockroachDB / Greenplum / OpenGauss / KingbaseES / Redshift | Extension `pg_stat_statements` |
| `other` | Autres | Affiche `slowq.unsupported` |

> `slowFamilyOf()` ne réutilise pas `ddl.familyOf()` — ce dernier met H2 en pg, omet Redshift, frontières différentes.

### Templates de requête

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

`*_TIMER_WAIT` en picosecondes (10⁻¹² s), converti en ms par `/1e9`. Le paramètre `schema` est rempli auto depuis `connection.database`.

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

### Tri, Top N, message si désactivé

- Dropdown « Trier » en haut : total / moyen / appels, **changement déclenche un nouveau `ORDER BY` côté DB**, pas de tri front
- LIMIT 50 par défaut, code `Math.max(1, Math.min(500, limit))` plafonne à 500
- Détection d'activation : MySQL `SHOW VARIABLES LIKE 'slow_query_log'`, PG `SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements'`
- Échec de détection → liste remplacée par « Désactivé » + SQL d'activation copiable (MySQL : `SET GLOBAL slow_query_log = ON; SET GLOBAL long_query_time = 1; …` ; PG : `CREATE EXTENSION IF NOT EXISTS pg_stat_statements; …`)

### Actions sur ligne dépliée

Clic sur une ligne déplie le SQL complet, 4 boutons :

| Bouton | Action |
|---|---|
| Copier | `navigator.clipboard.writeText(sql)` |
| Ouvrir en requête | emit `openSql` → nouvelle page de requête |
| Exécuter EXPLAIN | Lance `EXPLAIN <sql>` (sans `;` final), résultat inline. **Pas d'ANALYZE**, anti-écriture accidentelle |
| Optimiser par IA | emit `optimizeWithAi` → envoi au Toolbox IA tâche « Optimiser SQL » |

---

## Journal d'opérations

`OperationLogDialog.vue` — titre `Journal d'opérations`. **Audit local SkylerX**, pas l'audit log de la DB.

À l'entrée, charge toutes les connexions enregistrées, prend les 200 dernières `connections.history` de chacune, fusion triée `executedAt` descendant. Chaque ligne : statut succès/échec, heure d'exécution, nom connexion, durée (ms), texte SQL one-line.

### Filtrage

| Dimension | Options |
|---|---|
| Statut | Tous / Succès / Échec |
| Connexion | Toutes / une spécifique |
| Mot-clé | Match `includes` insensible à la casse sur le texte SQL |

### Export

« Exporter CSV » exporte le résultat filtré courant, nom `skylerx-operation-log.csv`, colonnes : `time,connection,status,duration_ms,sql`.

Clic sur une ligne → emit `openSql(connId, sql)` envoie ce SQL à la page de requête (ferme le dialogue).

---

## Topologie cluster

### ClusterTopologyDialog générique (TiDB / OceanBase)

`ClusterTopologyDialog.vue` — 2 onglets : **Nœuds** / **TiKV Stores | Region/Tablet** (label selon dialecte).

| Dialecte | Onglet Nœuds | Onglet Regions |
|---|---|---|
| TiDB | `information_schema.cluster_info` (tidb / tikv / pd / tiflash) | `information_schema.tikv_store_status` (`store_id, address, store_state_name, capacity, available, leader_count, region_count`) |
| OceanBase | `oceanbase.DBA_OB_SERVERS` | `oceanbase.GV$OB_TABLET_TO_LS LIMIT 200`, fallback `oceanbase.DBA_OB_UNITS` |
| Autres | `'Ce dialecte ne supporte pas la vue topologie cluster'` | Idem |

Colonnes octets (`capacity / available / size$`) formatées en KB / MB / GB / TB (base 1024) côté front.

### Topologie OceanBase dédiée

`OceanBaseTopologyDialog.vue` — titre `Topologie cluster OceanBase`, entrée visible uniquement pour les connexions OceanBase.

En haut : 4 cartes compteurs (Zones / Observers / Tenants / Units) + arbre Zone → Observer à gauche + liste Tenant → Unit à droite (dépliable). 4 vues **requêtées en parallèle**, échec → bandeau d'avertissement, données précédentes conservées.

| Vue | SQL |
|---|---|
| Zones | `SELECT zone, status, idc, region FROM oceanbase.DBA_OB_ZONES ORDER BY zone` |
| Observers | `SELECT svr_ip, svr_port, zone, status, with_rootserver, build_version, start_service_time FROM oceanbase.DBA_OB_SERVERS ORDER BY zone, svr_ip` |
| Tenants | `SELECT tenant_id, tenant_name, tenant_type, primary_zone, compatibility_mode, status, locked, locality FROM oceanbase.DBA_OB_TENANTS ORDER BY tenant_id` |
| Units | `SELECT unit_id, resource_pool_id, unit_group_id, tenant_id, zone, svr_ip, svr_port, status FROM oceanbase.DBA_OB_UNITS ORDER BY tenant_id, zone, svr_ip` |

Coloration des statuts : `ACTIVE / NORMAL` vert, `INACTIVE / OFFLINE / DELETING` rouge, autres jaune. tenant_type avec emoji : 👑 SYS / ⚙ META / 🏢 USER. Clic sur l'adresse observer copie `svr_ip:svr_port`.

Auto-refresh : off / 5s / 10s / 30s (off par défaut).

---

## Monitoring serveur

`ServerMonitorDialog.vue` — titre `Monitoring serveur`.

Dropdown pour basculer entre connexions enregistrées (uniquement dialectes supportés), démarrage → **polling setInterval 2s**, sparkline 60 points en mémoire.

### Support par dialecte

```ts
function fam(d) {
  if ([MySQL, MariaDB, OceanBase].includes(d)) return 'mysql'
  if ([PostgreSQL, KingbaseES].includes(d)) return 'pg'
  return 'other'
}
```

### Métriques MySQL (`SHOW GLOBAL STATUS` + `SHOW VARIABLES LIKE 'max_connections'`)

| Carte | Source |
|---|---|
| Uptime | `Uptime` (formaté `Xd Yh Zm`) |
| QPS | Delta de `Queries`/`Questions` ÷ delta de temps |
| Connexions | `Threads_connected / max_connections` |
| Running | `Threads_running` |
| Slow queries | `Slow_queries` |
| Connexions refusées | `Aborted_connects` |

### Métriques PostgreSQL (une seule SQL agrégée)

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

Cartes : Uptime / TPS (delta de xacts) / Connexions / Running / Lock waiting / Buffer hit ratio `hit / (hit + rd) * 100%`.

Le titre de la sparkline en bas affiche `QPS` ou `TPS` selon dialecte.

---

## Utilisateurs et privilèges

`PrivilegesDialog.vue` + `privileges.ts` — titre `Utilisateurs et privilèges`.

Colonne gauche : liste utilisateurs/rôles ; colonne droite : « Privilèges existants » / « Constructeur GRANT ».

### Support par dialecte

| Famille | Lister utilisateurs | Voir privilèges |
|---|---|---|
| MySQL (MariaDB / OceanBase) | `SELECT User, Host FROM mysql.user` | `SHOW GRANTS FOR 'usr'@'host'` |
| PostgreSQL (KingbaseES) | `SELECT rolname FROM pg_roles WHERE rolcanlogin` | `information_schema.role_table_grants` |
| Oracle (DM) | `SELECT username FROM all_users WHERE oracle_maintained = 'N'` (12c+) | `dba_sys_privs ∪ dba_role_privs ∪ dba_tab_privs` |
| SQL Server | `sys.database_principals WHERE type IN ('S','U','G')` | `sys.database_permissions` JOIN `sys.database_principals` |
| Autres | Affiche `priv.unsupported` | Non supporté |

> Privilèges Oracle via vues `dba_*` ; sans rôle DBA → ORA-00942, l'UI capture et affiche l'erreur à la place des privilèges.

### Constructeur GRANT

Cochez privilèges + cible + `WITH GRANT OPTION` optionnel → prévisualisation en direct, exemple :

```sql
GRANT SELECT, INSERT ON sales.orders TO 'app'@'%' WITH GRANT OPTION;
```

Privilèges présélectionnés `COMMON_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL PRIVILEGES']`.

Formatage du grantee par dialecte :

| Dialecte | Format |
|---|---|
| MySQL | `'user'@'host'` (host vide = `%`) |
| SQL Server | `[user]` (`]` échappé en `]]`) |
| Oracle | `"USER"` (majuscules, `"` échappé en `""`) |
| Autres | `"user"` |

### Pas de modification directe

**SkylerX n'exécute pas GRANT / REVOKE à votre place**. Deux boutons :

- Copier → vers presse-papier
- Ouvrir en requête → vers la page de requête, exécution manuelle (passe par le canal SQL SkylerX, avec [protection production](/fr/docs/connections#protection-production) sur les connexions prod)

`buildRevoke()` est aussi exporté dans `privileges.ts`, mais sans formulaire REVOKE actuellement ; modifiez l'aperçu GRANT manuellement si besoin.

---

## Matrice de compatibilité

| Fonction | Famille MySQL | Famille PG | SQL Server | Oracle / DM | OceanBase | TiDB | NoSQL |
|---|---|---|---|---|---|---|---|
| Activité serveur : processus | `information_schema.PROCESSLIST` | `pg_stat_activity` | `dm_exec_sessions` | — | Branche MySQL | Branche MySQL | N/A |
| Activité serveur : long Tx | `INNODB_TRX` | `pg_stat_activity` | `dm_tran_active_transactions` | — | Branche MySQL | Branche MySQL | — |
| Activité serveur : locks | `data_lock_waits` | `pg_locks` | `dm_tran_locks` | — | Branche MySQL | Branche MySQL | — |
| KILL | `KILL <id>` | `pg_terminate_backend` | `KILL <spid>` | — | ✓ | ✓ | — |
| Lag réplication | `SHOW REPLICA STATUS` etc. | `pg_stat_replication` / `pg_last_xact_replay_timestamp` | AOAG `dm_hadr_database_replica_states` | — | Branche MySQL | Branche MySQL | — |
| Slow queries | `events_statements_summary_by_digest` | `pg_stat_statements` | — | — | ✓ | ✓ | — |
| Monitoring serveur | `SHOW GLOBAL STATUS` | `pg_stat_*` agrégé | — | — | Branche MySQL (KingbaseES seul en pg) | — | — |
| Topologie cluster | — | — | — | — | `DBA_OB_*` | `cluster_info / tikv_store_status` | — |
| Topologie OB (dédiée) | — | — | — | — | ✓ | — | — |
| Utilisateurs et privilèges | `mysql.user` | `pg_roles` | `database_principals` | `all_users` + `dba_*` | Branche MySQL | Branche MySQL | — |
| Journal d'opérations (local) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

> **« Branche X »** = le dialecte est classé par `ddl.familyOf()` (ou `slowFamilyOf` / `fam()`) dans la famille X, réutilise le même SQL, sans garantie que les noms de colonnes des dictionnaires soient strictement identiques selon les versions. Doris / StarRocks compatibles MySQL, leur FE expose souvent `events_statements_summary_by_digest`, sinon retour au message « Désactivé ».

> **NoSQL (Redis / MongoDB / Elasticsearch)** : sur Activité serveur, court-circuités par `dialectKind(NoSql)` — pas de SQL envoyé, message « Utilisez ⚙ Serveur → Clients / Slowlog ». Le monitoring temps réel Redis est dans `RedisMonitorDialog` dédié, hors de cette page.
