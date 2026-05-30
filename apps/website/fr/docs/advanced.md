# Fonctionnalités avancées

Cette page rassemble les capacités avancées pour les **utilisateurs intensifs (DBA / data engineers / développeurs backend)**. Cachées dans les menus contextuels, la palette `⌘K` ou des niveaux profonds de la barre d'outils, peu utiles au quotidien, mais énormément de temps gagné dans ces scénarios :

- Voir si EXPLAIN passe par un index, quel nœud est le plus lent
- Déduire quels index créer à partir de l'historique SQL
- Voir la distribution / taux de NULL / dimensionnement d'une colonne
- Nettoyer les doublons / remplir les NULL historiques / restaurer depuis soft-delete
- Chercher dans toute la base où une valeur apparaît
- Construire des requêtes visuellement plutôt qu'à la main
- Gérer les partitions Doris/StarRocks / parts ClickHouse / binlog MySQL / extensions PG
- Migrer une base Oracle vers 达梦 (DM)

L'ordre suit "voir → modifier → chercher → construire → migrer".

## 1. EXPLAIN visualisé — PlanPanel

Tout le monde a vu EXPLAIN, mais le texte brut est peu lisible. SkylerX attache un **panneau Plan** à côté de QueryPane qui rend EXPLAIN en arbre + résumé.

### Déclencheurs

| Entrée | Action |
|---|---|
| Barre QueryPane `📊 Plan` | EXPLAIN du SQL courant (sans exécution) |
| `⌘⇧E` / Ctrl+Shift+E | Idem |
| `▶ Analyze` à côté de `📊 Plan` | EXPLAIN ANALYZE (**exécution réelle**, prudence avec DML) |

Sous le capot, `plan.ts → planQuery(dialect, sql, { analyze })` :

| Dialecte | Instruction générée |
|---|---|
| PostgreSQL / Kingbase | `EXPLAIN (FORMAT JSON) <sql>` / `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <sql>` |
| MySQL / MariaDB / OceanBase | `EXPLAIN FORMAT=TREE <sql>` / `EXPLAIN ANALYZE <sql>` (MySQL 8.0.18+) |
| Autres | Fallback EXPLAIN tabulaire (rendu pre brut) |

### Rendu en arbre de nœuds

Le JSON Plan PG est parsé par `parsePgPlan` en arbre `PlanNode`, puis aplati par `flattenPlan` en liste `{node, depth}`. Chaque nœud affiche :

- **Label** : `Seq Scan` / `Index Scan` / `Hash Join` …
- **Détails** : `on users` / `using users_pk` / `inner join`
- **Barre de coût** : largeur = `cost / maxCost * 60px`, dégradé vert → rouge
- **Chiffres** : `cost 1234.56 · est 1000 · act 1234 · 12.3ms` (act / ms uniquement en ANALYZE)

### Coloration des opérateurs lents

PlanPanel marque automatiquement le tiers le plus coûteux en rouge :

```ts
function isSlow(node) {
  return node.cost >= maxCost.value * 0.33 && maxCost.value > 0
}
```

Fond rouge + label rouge, **on voit immédiatement où optimiser**, sans comparer les coûts un à un.

### Écart estimé vs réel

`estimateSkew(node)` calcule `max(est, act) / min(est, act)`. ≥ 10× = **statistiques d'optimiseur obsolètes** (signal typique), bordure jaune à gauche + badge `⚠ 24×` à la fin. La barre de résumé pointe aussi le nœud le plus déviant :

```ts
let skewWorst = null
for (const r of arr) {
  const sk = estimateSkew(r.node)
  if (sk == null) continue
  if (!skewWorst || sk > skewWorst.skew) skewWorst = { node: r.node, skew: sk }
}
```

Voir ce badge = il faut faire `ANALYZE table` ou rafraîchir `pg_statistic`.

### Barre de résumé

En haut du panneau :

| Champ | Sens |
|---|---|
| `Total Cost` | Cost du nœud le plus lourd (cumul racine) |
| `Actual ms` | Sommation des temps réels en ANALYZE |
| `Heaviest` | Nœud au plus haut cost |
| `Skew` | Nœud avec l'écart estimé vs réel le plus fort + multiplicateur |

---

## 2. Recommandation d'index — IndexRecommender

`⌘K → Recommander des index` ou clic droit nœud base NavTree `🔧 Recommander des index`.

### Entrée et sortie

| Entrée | Source |
|---|---|
| Patterns SQL historiques | `client.connections.history(connId, 1000)` 1000 dernières |
| Index existants | MySQL `information_schema.STATISTICS` / PG `pg_index + pg_class` |

Sortie : `IndexHint[]`, chacune avec table, colonnes, score global, raison déduite, DDL `CREATE INDEX` exécutable.

### Algorithme (`index-recommender.ts`)

Pas de SQL parser (coûteux et différences entre dialectes), **heuristique par regex** pour extraire WHERE / JOIN / ORDER BY / GROUP BY :

1. **Agrégation historique** : SQL identique = ligne unique, cumul `count` + `totalMs`
2. **Filtre** : ne garde que `SELECT` / `WITH`, ignore DML/DDL
3. **Parse alias** : `parseTableAliases(sql)` extrait `tbl [AS] alias` après `FROM`/`JOIN`
4. **Scan des 4 types de clauses**, score pondéré :

| Clause | Score de base | Justification |
|---|---|---|
| `WHERE col = ?` / `LIKE` / `IN` / `IS NULL` / `BETWEEN` | 5 | Signal fort |
| `JOIN ON a.col = b.col` | 3 | Les deux côtés scorent |
| `ORDER BY col` | 2 | Tri demande un index ordonné |
| `GROUP BY col` | 2 | Idem pour groupage |

5. **Poids temporel** : chaque SQL `count × min(perMs/avgMs, MAX_TIME_MULTIPLIER=5)`, évite qu'un seul SQL lent noie la table
6. **SQL multi-tables** doivent avoir des alias pour reconnaître les colonnes nues ; **SQL mono-table** acceptent les noms nus
7. **Filtre des index existants** : `isCovered(table, cols, known)` selon "préfixe d'index couvre exactement les colonnes proposées" ; match = saut
8. **Suggestions composites** : pour chaque table, les 3 premières colonnes high-score sont appariées pour des index 2-colonnes

### Génération DDL

```ts
function buildDdl(table, columns, dialect) {
  const idxName = `idx_${sanitize(table)}_${cols.map(sanitize).join('_')}`.slice(0, 60)
  return `CREATE INDEX ${quoteIdent(idxName)} ON ${quoteIdent(table)}(${cols.map(quoteIdent).join(', ')});`
}
```

MySQL : backticks `` ` ``, PG : guillemets doubles `"`.

### Flux UI

À l'ouverture, `run()` auto : scan → liste candidate (tri `scoreEstimate` desc). Chaque ligne :

- Bouton `[Adopter]` → `emit('runSql', h.ddl)` envoie le DDL à QueryPane (l'utilisateur exécute après vérif)
- `[Tout copier]` copie tous les DDL dans le presse-papier
- `[Re-scanner]` relance

Support : familles MySQL / PG uniquement, autres dialectes : "Non supporté pour l'instant".

---

## 3. Inspecteur de données — DataInspector

Clic droit table `🔬 Inspecter`. Un dialogue à 5 onglets pour "santé des données + maintenance en un clic" — cœur du triage DBA. **Pas de requêtes SQL en parallèle** (anti-pression prod) : ne charge qu'à l'ouverture de l'onglet.

### Onglet 1 : Échantillonnage de colonne (A3)

Choisissez une colonne, un seul SQL pour toutes les stats :

```sql
SELECT
  COUNT(*) AS total,
  COUNT(col) AS non_null,
  COUNT(DISTINCT col) AS distinct_cnt,
  MIN(col) AS min_val,
  MAX(col) AS max_val
FROM <table>
```

Puis un top-10 :

```sql
SELECT col AS value, COUNT(*) AS cnt
FROM <table> GROUP BY col ORDER BY cnt DESC LIMIT 10
```

Cartes pour les stats + tableau top-N. Taux de NULL élevé / distinct très bas (peut être un code de statut) / extrêmes anormaux se voient immédiatement.

### Onglet 2 : Profilage de table (B6)

Un gros SELECT calcule pour chaque colonne `COUNT(col)` + `COUNT(DISTINCT col)` :

```sql
SELECT COUNT(*) AS total,
       COUNT(`a`) AS nn_a, COUNT(DISTINCT `a`) AS dc_a,
       COUNT(`b`) AS nn_b, COUNT(DISTINCT `b`) AS dc_b,
       ...
FROM <table>
```

Tableau de sortie : `Colonne | Type | NULL% | DISTINCT/total`. NULL% > 50 marqué jaune, "cette colonne n'est peut-être pas utilisée".

### Onglet 3 : Scan des contraintes (B5)

Liste les colonnes `IS_NULLABLE = 'NO'`, puis pour chacune `SELECT COUNT(*) WHERE col IS NULL`. Résultat > 0 = **violation de contrainte** (souvent NOT NULL ajouté tardivement sans nettoyage des données legacy).

### Onglet 4 : Suggestions de type (B9)

Stratégie par catégorie de type :

| Type actuel | Vérification | Suggestion |
|---|---|---|
| `VARCHAR(255)` | `MAX(CHAR_LENGTH(col))` réel | `VARCHAR(max(32, ceil(maxlen*1.5)))` si déclaré > maxlen*4 et écart > 50 |
| `BIGINT` | `MAX(ABS(col))` | < 2³¹-1 → `INT` |
| `INT` | Idem | < 32767 → `SMALLINT` |

Chaque suggestion explique : `longueur max réelle 20, déclaré 255, gaspille 235 octets`.

### Onglet 5 : Maintenance de table (B10)

4 boutons selon dialecte :

| Famille | Boutons |
|---|---|
| MySQL | `ANALYZE TABLE` / `OPTIMIZE TABLE` / `CHECK TABLE` |
| PG | `ANALYZE` / `VACUUM FULL` / `VACUUM` / `REINDEX TABLE` |

Chaque exécution avec double confirmation (VACUUM FULL verrouille).

---

## 4. Réparation de données — DataFixup

Clic droit table `🩹 Réparer`. 3 onglets, squelette commun "saisir conditions → générer SQL → revue utilisateur → exécuter". **Pas de commit direct**, le SQL est envoyé à QueryPane en pending pour vérification.

### Onglet 1 : Détection de doublons (B3)

Cochez quelques colonnes comme **clé métier** (`email + tenant_id`), un GROUP BY voit lesquels sont dupliqués :

```sql
SELECT col1, col2, COUNT(*) AS cnt
FROM <table>
GROUP BY col1, col2 HAVING COUNT(*) > 1
ORDER BY cnt DESC LIMIT 100
```

Confirmation des doublons → `Générer SQL de nettoyage` → instruction avec `ROW_NUMBER()` (version PG), commentaire avec version MySQL self-join en alternative :

```sql
-- Garde le ROW_NUMBER() = 1, supprime le reste
DELETE FROM <table>
WHERE (col1, col2, ctid) IN (
  SELECT col1, col2, ctid FROM (
    SELECT col1, col2, ctid,
           ROW_NUMBER() OVER (PARTITION BY col1, col2 ORDER BY ctid) AS rn
    FROM <table>
  ) sub WHERE sub.rn > 1
);
```

### Onglet 2 : Remplissage des NULL (B4)

Choisissez une colonne + stratégie :

| Stratégie | Expression SET générée |
|---|---|
| `literal` | `'<valeur utilisateur>'` |
| `avg` | `(SELECT AVG(col) FROM <table>)` |
| `min` / `max` | `(SELECT MIN/MAX(col) FROM <table>)` |
| `most_common` | `(SELECT col GROUP BY col ORDER BY COUNT(*) DESC LIMIT 1)` |

Génère `UPDATE <table> SET col = <expr> WHERE col IS NULL;`, commentaire "lancez d'abord un SELECT COUNT pour vérifier l'impact".

### Onglet 3 : Restauration de soft-delete (B8)

Détection heuristique des colonnes soft-delete (`deleted_at` / `is_deleted` / `deleted`). Selon le type, génère la requête :

| Nom de colonne | Génération |
|---|---|
| `is_deleted` / `*_flag` | `UPDATE ... SET col = FALSE WHERE col = TRUE` |
| `deleted_at` / autre timestamp | `UPDATE ... SET col = NULL WHERE col IS NOT NULL` |

Filtre WHERE supplémentaire optionnel (`AND user_id = 42`), évite de tout restaurer.

---

## 5. Recherche de valeur inter-tables — SearchValueDialog

`⌘K → Rechercher inter-tables` ou clic droit cellule `🔎 Où apparaît cette valeur` (pré-rempli).

### Workflow

1. **Charge toutes les colonnes "cherchables"** (`information_schema.columns`) :
   - MySQL : `varchar / char / text / tinytext / mediumtext / longtext / json`
   - PG : `character varying / character / text / json / jsonb`
2. **Groupe par table** : chaque table → `SELECT * FROM t WHERE col1 LIKE :v OR col2 LIKE :v ... LIMIT 50`
3. **Exécution parallèle** (max 6 simultanées, anti-saturation pool)
4. **Barre de progression** + liste des résultats

### Limites de performance

Bases avec milliers de colonnes : filtrez par `table_prefix` (`user_*`). `matchMode` : `contains` / `exact` :

- `contains` → `LIKE '%v%'` (lent mais complet)
- `exact` → `= 'v'` (rapide, idéal pour ID)

`maxPerTable` limite à 50 hits par table, évite l'OOM sur une grosse table large.

### Exemple

Diagnostic prod "pourquoi l'utilisateur `alice@x.com` reçoit cette notification" :

1. ⌘K → Rechercher inter-tables
2. Valeur `alice@x.com`, mode `exact`
3. Scan toutes les bases, voit `users(email)` + `subscription(email)` + `mail_logs(to_addr)` → flux de données identifié

---

## 6. Historique de ligne — RowHistoryDialog

Clic droit ligne dans le résultat → `⏱ Voir les versions historiques`.

### Détection heuristique de table shadow

Pour une PK donnée (`{id: 42}`), scan auto de `information_schema.tables` :

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name LIKE '<base>_%'
   OR table_name = 'audit_<base>'
   OR table_name = '<base>_history'
```

Sélection dans le dropdown (`<datalist>`) ou saisie manuelle.

### Charger l'historique

Filtre par PK, tri par `changed_at / updated_at / created_at / version / revision` desc :

```sql
SELECT * FROM <shadowTable>
WHERE id = 42
ORDER BY changed_at, updated_at, created_at, version, revision DESC
LIMIT 200
```

Chaque ligne = une version, colonnes = celles de la shadow, chaînes tronquées à 80 caractères.

---

## 7. Constructeur de requête visuel — VisualQueryDialog

`⌘K → Requête visuelle` ou clic droit nœud base `🎨 Constructeur visuel`.

**MVP sans canvas drag-and-drop** — plus stable en "liste + cartes", vraiment utilisable et pas juste une démo.

### Layout

| Zone | Contenu |
|---|---|
| Gauche | Toutes les tables de la base + recherche + cases |
| Centre | Tables cochées en cartes, case par colonne (cochées → SELECT, non cochées affichées) |
| Haut | Inputs WHERE / ORDER BY + numéro `LIMIT` |
| Bas | SQL généré en temps réel + bouton `Ouvrir comme nouvel onglet` |

### Auto JOIN

À la sélection de deux tables, détection des colonnes type FK, génération `INNER JOIN` :

```ts
// inferConventionalFks
const m = /^(.+?)_id$|^(.+?)Id$/.exec(col.name)
// user_id → users.id  /  category_id → categories.id
```

Candidats : `<base>` brut + pluriel simple (`user → users`, `category → categories`). Sans match → fallback `CROSS JOIN` (avertissement visuel sur efficacité).

### Génération SQL

```sql
SELECT users.id AS users_id, users.name AS users_name,
       orders.id AS orders_id, orders.amount AS orders_amount
FROM users
  INNER JOIN orders ON users.id = orders.user_id
WHERE amount > 100
ORDER BY users.id DESC
LIMIT 200
```

Alias `<table>_<col>` pour éviter les collisions multi-tables.

---

## 8. Gestion de partitions MPP — MppPartitionDialog

Pour Doris / StarRocks (protocole MySQL). Clic droit nœud base `🗂 Gérer partitions`.

### Champs

Appelle `SHOW PARTITIONS FROM <db>.<tbl>`, affiche :

| Champ | Sens |
|---|---|
| `PartitionId` / `PartitionName` | Métainfo partition |
| `State` | NORMAL etc. |
| `PartitionKey` / `Range` | Colonnes et plages de partition |
| `DistributionKey` / `Buckets` | Clé et nombre de buckets |
| `ReplicationNum` | Nombre de réplicas |
| `StorageMedium` | HDD / SSD |
| `CooldownTime` | Temps de refroidissement (rétrogradation HDD) |
| `DataSize` | Volume (format KB/MB/GB auto) |

### Actions

| Bouton | Action |
|---|---|
| `+ Nouvelle partition` | Popup pour clause `ADD PARTITION ...`, préfixe `ALTER TABLE <db>.<tbl>` ajouté auto |
| `DROP` par ligne | Double confirmation → `ALTER TABLE <db>.<tbl> DROP PARTITION <name>` |
| `🔄 Rafraîchir` | Relance SHOW PARTITIONS |

---

## 9. Avancé par dialecte

### 9.1 MysqlAdvancedDialog

Adapté à MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks. 3 onglets :

| Onglet | SQL utilisé |
|---|---|
| **Binlog** | `SHOW MASTER STATUS` + `SHOW BINARY LOGS` + après sélection `SHOW BINLOG EVENTS IN '<file>' LIMIT N` |
| **Statut maître/esclave** | `SHOW REPLICA STATUS` (8.0+) puis fallback `SHOW SLAVE STATUS` (MariaDB / vieux) |
| **Variables / Statut** | `SHOW GLOBAL VARIABLES` / `SHOW GLOBAL STATUS` avec filtre ; Variables : `SET GLOBAL k = v` pour modifier runtime |

### 9.2 PgAdvancedDialog

Adapté à PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift. 3 onglets :

| Onglet | Source |
|---|---|
| **Extensions** | `pg_available_extensions` ; `CREATE EXTENSION IF NOT EXISTS "<name>" WITH SCHEMA "<schema>"` / `DROP EXTENSION` en un clic |
| **Publications / Subscriptions** | `pg_publication` + `pg_publication_tables` + `pg_subscription` (gestion logical replication) |
| **Slots** | `pg_replication_slots` (slot_name / plugin / slot_type / active / restart_lsn / confirmed_flush_lsn / wal_status) ; `DROP_REPLICATION_SLOT` |

### 9.3 ClickHouseAdvancedDialog

4 onglets, lecture seule sur `system.*` :

| Onglet | Source | Usage |
|---|---|---|
| **Parts** | `system.parts` (filtre active) | Voir `rows / bytes_on_disk / data_compressed_bytes / marks / min_date / max_date / level` ; `DROP / DETACH / ATTACH PARTITION` |
| **Mutation** | `system.mutations` | Voir `is_done / command / parts_to_do / latest_failed_part / latest_fail_reason` |
| **Réplicas** | `system.replicas` | Voir `is_leader / queue_size / inserts_in_queue / merges_in_queue / total_replicas / active_replicas / zookeeper_path` |
| **Metadata** | `system.tables` | Voir `engine / total_rows / total_bytes / partition_key / sorting_key / primary_key / sampling_key / storage_policy` |

Filtre `database / table` en haut de chaque onglet, indispensable pour grands clusters.

---

## 10. Assistant de migration Oracle → DM (达梦)

Scénario fréquent en 信创 externalisé : migrer toute la base Oracle d'un client vers 达梦. `⌘K → Migration Oracle → DM`.

### Flux en 5 étapes

| Étape | Action |
|---|---|
| 1. **Choix connexions** | Parmi les connexions configurées, filtre `dialect == Oracle` / `dialect == DM`, une à gauche, une à droite |
| 2. **Choix objets** | Charge `tables / views / sequences / procedures` source, tout coché par défaut, cochables par groupe / par entrée |
| 3. **Aperçu** | Pour chaque objet `DBMS_METADATA.GET_DDL` → `translateDdl()` traduit → affiche warnings + édition possible |
| 4. **Exécution** | `client.connections.execute(dstConnId, ddl)` par objet, erreurs collectées sans arrêt |
| 5. **Rapport** | Récap Markdown succès/échecs + warnings, copier / saveText |

### Règles de traduction (`oracleToDm.ts`)

**Mapping de types** (`TYPE_MAP`) :

| Oracle | DM | Note |
|---|---|---|
| `VARCHAR2` | `VARCHAR` | — |
| `NVARCHAR2` | `NVARCHAR` | — |
| `NUMBER` | `NUMERIC` | DM accepte aussi NUMBER, mais NUMERIC plus standard |
| `CLOB` / `NCLOB` / `BLOB` | Identique | — |
| `DATE` | `DATE` | ⚠ Oracle inclut h:m:s, DM non |
| `TIMESTAMP` | `TIMESTAMP` | — |
| `RAW` / `LONG RAW` | `VARBINARY` | — |
| `LONG` | `CLOB` | Déprécié Oracle |
| `BINARY_FLOAT` / `BINARY_DOUBLE` | `FLOAT` / `DOUBLE` | — |
| `ROWID` / `UROWID` | `VARCHAR(18)` / `VARCHAR(4000)` | Sans équivalent DM, downgrade |
| `XMLTYPE` | `XML` | XPath/XQuery à réécrire possiblement |

**Implémentation** : tri "clé longue en premier" (`LONG RAW` avant `LONG` pour pas être volé) ; `NUMBER` nu sans longueur non complété ; `NUMBER(p,s)` chiffres copiés ; ajout du warning `TYPE_NOTES` après match.

**Mapping fonctions / mots-clés** (`FN_MAP`) :

| Oracle | DM | Note |
|---|---|---|
| `SYSDATE` / `SYSTIMESTAMP` | `CURRENT_TIMESTAMP` | DM accepte SYSDATE aussi, fonctions standards plus sûres |
| `NVL(a, b)` | `COALESCE(a, b)` | DM compatible NVL, COALESCE plus portable |
| `NVL2(...)` | Conservé | Si non supporté : `CASE WHEN expr IS NOT NULL THEN a ELSE b END` |
| `MINUS` | `EXCEPT` | DM compatible MINUS, EXCEPT plus standard |
| `DUAL` / `ROWNUM` | Conservé | Supporté DM |

**Warnings de syntaxe complexe** (`HARD_WARNINGS`, SQL inchangé, juste warning `[review]`) :

| Pattern | Contenu warning |
|---|---|
| `DECODE(...)` | Encore utilisable, mais `CASE WHEN` recommandé pour lisibilité |
| `CONNECT BY` | Compatible essentiellement ; `NOCYCLE` / `SYS_CONNECT_BY_PATH` etc. à revoir |
| `MERGE INTO` | Branches complexes (`DELETE WHERE` / `UPDATE` multi-source) peuvent différer |
| `INSTEAD OF (INSERT/UPDATE/DELETE) TRIGGER` | Sémantique trigger DM diffère, corps à migrer manuellement |
| `SDO_GEOMETRY` / `MDSYS.*` | Oracle Spatial sans équivalent, utilisez DMGeo ou tiers |
| `DBMS_*` | Simulation partielle (`DBMS_OUTPUT`/`DBMS_LOB`), packages métier à réécrire |
| `UTL_*` (`UTL_HTTP`/`UTL_FILE` etc.) | Généralement non supporté, scripts externes en remplacement |
| `INTERVAL YEAR/DAY TO ...` | Certaines versions n'ont que la forme simplifiée, vérifier la version |
| `PIVOT(...)` / `UNPIVOT(...)` | DM 8.x supporte partiellement, anciennes versions réécrire en `CASE WHEN` |
| `BULK COLLECT` / `FORALL` | Opérations bulk PL/SQL, syntaxe DMSQL légèrement différente |

### Ce qui n'est volontairement pas fait

- **Pas de traduction sémantique PL/SQL** — procédures stockées : seul le squelette CREATE, corps manuel
- **Pas de traduction du corps de trigger** — idem
- **Pas de résolution des dépendances de contraintes** — ordre alphabétique, relancer si échec
- **Pas d'atomicité transactionnelle** — chaque objet indépendant, échec → rouge

### Migration de données (expérimental)

Étape 4 cochez "Inclure données (100 lignes/table en exemple)" :

```sql
-- Source
SELECT * FROM "<table>"  -- limité 100 lignes

-- Cible
INSERT INTO "<table>" (col1, col2, ...) VALUES (v1, v2, ...)  -- ligne par ligne
```

C'est un **squelette** — une vraie migration nécessite pagination + conversion + bulk insert, à venir. Pour la production complète, utilisez DTS / `expdp + impdp` ou autre outil spécialisé.

### Rapport

À la fin de Step 4, passage à Step 5. Exemple Markdown :

```markdown
# Rapport migration Oracle → DM

- Connexion source : `prod-oracle`
- Connexion cible : `dm-test`
- Heure : 2026-05-30 10:23:11
- Objets total : 142, réussis 138, échoués 4

## Objets réussis
- [tables] ORDERS (124ms)
- [tables] USERS (89ms)
...

## Objets échoués
- [procedures] CALC_BONUS
  - Erreur : ORA-00942 table ou vue inexistante

## Warnings de traduction (review humain)
- (ORDERS) [type] DATE : Oracle DATE inclut h:m:s, DM DATE non ; si la colonne dépend de l'heure, utilisez TIMESTAMP
- (ORDERS_REPORT) [review] PIVOT/UNPIVOT : DM 8.x partiellement, anciennes versions à réécrire en CASE WHEN
```

`Copier` ou `Enregistrer` en `.md` pour archives.

---

## 11. Quel outil utiliser ?

Tableau "symptôme → outil" :

| Je veux… | Utiliser |
|---|---|
| Voir où un SQL lent bloque | **PlanPanel** + ANALYZE |
| Ne sais pas quel index créer | **IndexRecommender** |
| Évaluer la santé d'une table inconnue | **DataInspector** profilage + suggestions de type |
| Nettoyer doublons / données sales | **DataFixup** |
| Trouver où une valeur apparaît | **SearchValueDialog** |
| Voir l'historique de modifications d'une ligne | **RowHistoryDialog** |
| Faire une démo de requête à un non-tech | **VisualQueryDialog** |
| Gérer partitions Doris | **MppPartitionDialog** |
| Voir binlog MySQL / lag réplication | **MysqlAdvancedDialog** |
| Installer extension PG / config logical replication | **PgAdvancedDialog** |
| Voir parts CH / état Mutation | **ClickHouseAdvancedDialog** |
| Migrer Oracle vers 达梦 | **OracleToDmWizard** |

Combiné avec [Assistant IA](./ai), la puissance double — sur PlanPanel demandez à l'IA, sur IndexRecommender demandez l'explication, sur DataInspector demandez à l'IA d'évaluer les risques.
