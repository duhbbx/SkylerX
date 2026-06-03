# Gestion de structure

Une base de données ne se résume pas à « insérer des données » ; on passe surtout du temps à dessiner des tables, modifier des tables, réconcilier, migrer. SkylerX regroupe les capacités liées à la structure en un ensemble d'outils orientés base / table / schema, du simple visionnage en lecture seule à l'alignement de deux bases.

Cette page suit un ordre du plus léger au plus lourd : **visualiser → concevoir → éditer → diagramme → snapshot → comparaison inter-bases → dérive → création de base et de schema → assistance IA**.

## Vue d'ensemble

| Outil | Déclencheur | Objectif | Génère du SQL | Applique directement |
|---|---|---|---|---|
| Structure de table (TableStructure) | Arborescence : nœud table → double-clic par défaut | Vue lecture seule des colonnes/index/clés/DDL | — | Non |
| Designer de table (TableDesigner) | Clic droit arbre → Nouvelle table / Designer | Création visuelle + ALTER diff-aware | ✓ (aperçu) | ✓ (après confirmation) |
| Éditeur DDL (DdlEditor) | Clic droit arbre → Nouveau / Modifier vue, fonction, procédure, trigger | Écriture / modification directe du DDL d'objet | ✓ (éditeur) | ✓ |
| Diagramme ER (ErdView) | Clic droit schema → diagramme ER | Vue visuelle de la base + glisser-déposer pour créer table / ajouter FK | ✓ (export .sql) | ✓ (application à la base) |
| Snapshots de structure (SchemaSnapshots) | Palette de commandes `act:snapshots:{connId}` | Sauvegarder tous les DDL actuels dans localStorage pour comparaison ultérieure | — | Non |
| Comparaison de structure (SchemaDiff) | Palette de commandes `act:schema-diff` | Comparaison horizontale de deux schemas + script d'alignement | ✓ (ouvrable en requête) | Non |
| Détection de dérive (SchemaDrift) | Palette de commandes `act:drift` | Détection profonde inter-connexions même dialecte (colonnes/index/FK) | ✓ (script d'alignement) | ✓ (après confirmation) |
| Nouvelle base (NewDatabase) | Clic droit nœud connexion → Nouvelle base | Génère `CREATE DATABASE` selon le dialecte | ✓ (aperçu éditable) | ✓ |
| Nouveau Schema (NewSchema) | Clic droit nœud base → Nouveau Schema | PG / SQL Server / Oracle etc. | ✓ | ✓ |
| Création IA (SchemaArchitect) | Palette → Assistant IA création de tables | Description métier → DDL multi-tables | ✓ | ✓ |
| Reverse IA (SchemaReverse) | Palette → Inférence IA reverse | Données d'exemple → CREATE TABLE | ✓ | ✓ |

Détails ci-dessous.

## 1. Visualisation de la structure de table (TableStructure)

Le plus simple : « voir à quoi ressemble cette table ». Cliquer sur un nœud table ouvre un onglet en lecture seule. Code source : `packages/ui/src/components/TableStructure.vue`.

L'interface a 4 onglets, le suffixe indique la quantité :

- **Champs** — nom / type / nullable / clé primaire / défaut / commentaire
- **Index** — liste des noms d'index (uniquement les noms, détails dans le designer)
- **Clés** — noms des clés primaires / étrangères / uniques
- **DDL** — le `CREATE TABLE` complet de la table

La stratégie de récupération du DDL diffère selon le dialecte :

```ts
if (isMysql) {
  // Famille MySQL : SHOW CREATE TABLE direct, le plus fiable
  const r = await client.connections.execute(connId, `SHOW CREATE TABLE ${ref}`)
  // Prend row['Create Table']
}
// Non MySQL : buildCreateFromColumns(...) reconstruit un DDL simplifié à partir des colonnes
```

Autrement dit : **MySQL / MariaDB / OceanBase** affichent le DDL natif tel que la base le retourne ; PostgreSQL / Oracle / SQL Server affichent une version approchée reconstituée des colonnes — suffisant mais sans les constructions complexes type GENERATED / EXTENDS.

Le bouton de rafraîchissement `⟳` en haut à droite relance la récupération (`Promise.all([meta('columns'), meta('indexes'), meta('keys')])`), pratique pour confirmer après modification.

## 2. Designer de table visuel (TableDesigner)

`packages/ui/src/components/TableDesigner.vue`, **880 lignes**, c'est la force principale de la gestion structurelle. Deux modes :

- `mode: 'create'` — Nouvelle table (départ vierge)
- `mode: 'alter'` — Modifier une table (chargement des colonnes + index + FK existants)

### Barre d'outils

| Bouton | Action |
|---|---|
| Nouvelle / Réinitialiser | `resetTable()` vide tout pour revenir à l'état initial |
| Enregistrer | Mode création → `CREATE TABLE` ; mode alter → séquence d'`ALTER TABLE` diff |
| Enregistrer sous | `prompt` nouveau nom → `CREATE TABLE` avec la structure courante (équivaut à « copier la structure ») |
| ➕ Champ / Insérer / Supprimer / Clé primaire / ⬆⬇ | Splice direct dans le tableau columns |
| Champ nom de table | Lecture seule en mode alter (renommer passe par RENAME, hors du périmètre du designer) |

### Onglets internes (affichés selon dialecte)

Le tableau `INNER` définit 10 onglets fixes : `fields / indexes / fk / unique / check / trigger / options / storage / comment / sql`. Chaque onglet est un sous-formulaire réactif, les modifs se reflètent immédiatement dans l'aperçu SQL.

**Tableau des champs** (édition inline) :

| Colonne | Mode d'édition |
|---|---|
| Nom du champ | input simple |
| Type | input + datalist (`type-list`), candidats par dialecte (`typeOptions(dialect)`) |
| Longueur / précision | input numérique |
| NULL / PK | cases à cocher |
| Défaut / commentaire | input |

Sous la ligne sélectionnée, une zone « Propriétés du champ » : pour la famille MySQL seulement `UNSIGNED / ZEROFILL / AUTO_INCREMENT / ON UPDATE CURRENT_TIMESTAMP / CHARSET / COLLATION`, pour tous les dialectes l'expression `GENERATED`.

**Index** : type dropdown selon dialecte : famille MySQL `BTREE / HASH / FULLTEXT / SPATIAL`, famille PG `btree / hash / gin / gist`. PG ajoute aussi `WHERE` (index partiel) et `CONC` (`CREATE INDEX CONCURRENTLY`, sans verrouillage de table).

**Foreign keys** : même logique selon dialecte ; `ON DELETE / ON UPDATE` candidats codés en dur `CASCADE / SET NULL / RESTRICT / NO ACTION` ; PG ajoute `MATCH FULL/PARTIAL/SIMPLE` et `DEFERRABLE`.

**Options** :

- Famille MySQL : Engine / Charset / Collation / Row Format (`DYNAMIC / COMPRESSED / COMPACT / REDUNDANT`) / valeur de départ Auto-increment
- Famille PG : `TABLESPACE / FILLFACTOR / INHERITS`
- Autres : message vide

### ALTER diff-aware (cœur du mode alter)

En entrant en mode alter, `loadExisting()` appelle `client.connections.metadata` pour mapper les infos colonnes en `ColumnDef[]`, puis `loadIndexes()` / `loadForeignKeys()` extraient les index/FK existants via `information_schema`, **tout étant snapshooté en `original.value / originalIndexes.value / originalForeignKeys.value`** comme baseline du diff.

Ensuite `alterStmts` est `computed(() => buildAlterTable(dialect, tableRef, original.value, spec, { indexes: originalIndexes.value, foreignKeys: originalForeignKeys.value }))`.

`buildAlterTable` est un diff champ par champ source vs courant :

- Changement de nom de colonne (si `originalName` existe) → `ALTER TABLE ... RENAME COLUMN / CHANGE COLUMN`
- Suppression de ligne → `DROP COLUMN`
- Nouvelle ligne → `ADD COLUMN`
- Type / NULL / défaut / commentaire changés → `MODIFY COLUMN` (MySQL) ou `ALTER COLUMN` (PG/MSSQL)
- Index / FK comparés à `originalIndexes.value` → ajout/suppression

L'aperçu SQL (`inner === 'sql'`) affiche la liste des ALTER générés ; rien à changer = placeholder `designer.noChanges`. **Enregistrer** exécute chaque ALTER individuellement via `client.connections.execute`, en cas d'échec s'arrête et bascule le focus sur l'onglet SQL, sans rollback de ce qui a réussi (acceptable pour les modifs de table, le message d'erreur s'affiche).

### Vérification dirty + transition création vers alter

La vérification dirty utilise `JSON.stringify({ tableName, spec })` contre la baseline ; à la fermeture d'onglet le composant parent appelle `isDirty()` pour décider d'une popup « Non sauvegardé ». Après enregistrement réussi / reset, la baseline se synchronise, donc un nouvel onglet n'est pas marqué dirty à tort.

Après création réussie, le composant bascule `runtimeMode` à `alter` et marque les colonnes créées comme `originalName` ; les enregistrements suivants passent en ALTER diff. Effet : cliquer enregistrer crée la table, l'onglet reste, et on peut continuer à ajouter des champs / changer des types — c'est l'optimisation du workflow « construction itérative ».

## 3. Éditeur DDL (vues / fonctions / procédures / triggers)

`packages/ui/src/components/DdlEditor.vue`. Pour les objets schema hors designer, on écrit le SQL directement ; ce composant est un wrapper Monaco avec reconnaissance de dialecte.

- **mode: 'create'** — `objectTemplate(dialect, kind, ctx)` fournit un squelette minimal (ex. `CREATE VIEW v AS SELECT 1;`)
- **mode: 'edit'** — `objectDdlQuery(dialect, kind, ref, node)` extrait la définition existante

`objectDdlQuery` renvoie l'un de trois modes :

| mode | Convient pour | Récupération |
|---|---|---|
| `showCreate` | Famille MySQL | `SHOW CREATE VIEW / PROCEDURE / FUNCTION / TRIGGER`, on prend le champ commençant par `^create` |
| `viewdef` | Vues PG | `pg_get_viewdef(...)`, le composant ajoute le `prefix` (`CREATE OR REPLACE VIEW ... AS\n`) |
| `funcdef` / `oracle-ddl` | Fonctions PG / Oracle DBMS_METADATA | Lecture directe de `row.ddl` |

Barre d'outils :

- **Enregistrer / Exécuter** (label selon le mode) — tout le bloc comme une seule instruction (les corps de fonction / procédure contiennent des `;`, on ne peut pas splitter)
- **Formater** — `sql-formatter` par dialecte : famille `mysql` → mysql, famille `pg` → postgresql, `sqlserver` → transactsql, `oracle/dm` → plsql. Échec d'analyse → on garde le texte d'origine sans bloquer la saisie.
- **Annuler** — ferme directement l'onglet

La barre d'erreur affiche l'erreur brute du backend ; pour triggers / procédures stockées c'est typiquement un souci de `;` / DELIMITER.

## 4. Diagramme ER (ErdView)

`packages/ui/src/components/ErdView.vue`, canvas SVG dessiné à la main. Ouverture : clic droit sur un nœud base / Schema → diagramme ER, ouvre un nouvel onglet `kind: 'erd'`.

### Mode visualisation (par défaut)

- Récupère toutes les tables (`loadErd`, utilise `information_schema` / `pg_constraint` etc.) → grille automatique
- Molette = zoom, drag espace = panning
- Chaque table déplaçable individuellement (y compris coordonnées négatives, canvas non clippé)
- En haut : `－ / + / 1:1 / ⟳ / Modifier` zoom et rafraîchissement

### Mode édition (cliquer « Modifier »)

Trois modifications simultanées possibles, appliquées ensemble à la soumission :

1. **Nouvelle table** — `addTable()` affiche une fenêtre, ajout colonnes, type, clé primaire
2. **Nouvelle FK** — sur le port à droite d'une colonne, drag → drop sur une colonne d'une autre table → `newFks.push(...)` ; visuellement une ligne pointillée violette
3. **ALTER ajout colonne** (D1) — bouton « + ALTER ajouter colonne... » de table existante → deux prompts (nom / type) → entre dans `alterAddCols[tableName]`, surligné violet avec préfixe `+`

### Sorties

`generateDdl()` appelle `client.files.saveText`, génère un fichier `.sql` :

```sql
CREATE TABLE "t1" (
  "id" int,
  ...
);

ALTER TABLE "orders" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "users" ADD COLUMN "phone" varchar(64);
```

`applyChanges()` prend `buildDdl(true)` (uniquement les ajouts), splitte par `;\n`, `executeBatch` envoie tout à la connexion courante, succès → `load()` recharge et retour au mode visualisation. Échec → alert, la structure reste intacte.

## 5. Snapshots de structure (SchemaSnapshotsDialog)

`packages/ui/src/components/SchemaSnapshotsDialog.vue`. Palette `act:snapshots:{connId}`.

Positionnement : comparaison DDL **même connexion, à différents moments**. Sans recouvrement avec SchemaDiff (deux connexions), SchemaDrift (dérive profonde).

### Prendre un snapshot

Cliquez « 📸 Snapshot » → récupère le DDL de toutes les tables de la première database/schema. MySQL utilise `SHOW CREATE TABLE`, PG construit un DDL simplifié (colonnes + type + NULL + DEFAULT). À la fin, un prompt demande un commentaire (« Avant release / Après refonte ordres / ... »), stocké dans `localStorage['skylerx.schema-snapshots']`, chaque connexion conserve au max `MAX_PER_CONN = 20` snapshots, éviction LRU du plus ancien.

### Comparaison

Cochez deux snapshots (au-delà, le plus ancien est éjecté) → « ⟷ Comparer ». Algorithme direct :

- Présent en A seulement → `added` (vert)
- Présent en B seulement → `removed` (rouge)
- Dans les deux mais contenu différent → `changed` (jaune)
- Identique → `same` (caché par défaut)

Cliquez une ligne diff → DDL en deux colonnes à droite, comparaison visuelle directe.

> Limites : ne regarde que la première database/schema ; pour multi-bases, prendre un snapshot par base. Stockage `localStorage` car SQLite ne devrait pas être pollué par ce type de données « log » ; quota 5 Mo suffit pour des dizaines de tables × 20 snapshots.

## 6. Comparaison de structure (SchemaDiffDialog) — deux connexions + SQL d'alignement

`packages/ui/src/components/SchemaDiffDialog.vue`. Palette `act:schema-diff`.

### Conditions de déclenchement

- Choisir connexion source + schema source, connexion cible + schema cible
- Doit être **même famille** (MySQL ↔ MySQL / PG ↔ PG), la syntaxe SQL cross-famille ne correspond pas, l'UI affiche « Supporte uniquement MySQL ↔ MySQL / PG ↔ PG »

Après changement de connexion, `onPickSrc / onPickTgt` remplit le schema par défaut : PG → `public`, MySQL → `database` de la connexion.

### Récupération + comparaison

Une requête `information_schema.COLUMNS` parallèle des deux côtés (`TABLE_NAME / COLUMN_NAME / type / NULL / PK / défaut`) → `TableSnapshot[]` → `diffSchemas` donne trois catégories : `added / changed / removed`. Chaque ligne changed embarque les `columnChanges` (`add / drop / modify`) au niveau colonne.

### Sortie

`generateMigration` produit du SQL d'alignement selon le dialecte cible, avec un résumé en tête (nombres d'ajouts, modifs, suppressions). Deux boutons :

- **Copier** — vers le presse-papier
- **Ouvrir en requête sur la connexion cible** — `emit('openSql', tgtId, migration)`, Workspace ouvre un nouvel onglet de requête avec le SQL pré-rempli, à vérifier avant de Run. Cela garantit **aucune application automatique**.

## 7. Détection de dérive de structure (SchemaDriftDialog)

`packages/ui/src/components/SchemaDriftDialog.vue`, **925 lignes**, plus profond que SchemaDiff. Palette `act:drift`.

Différence : SchemaDiff ne regarde que les colonnes, DriftDialog regarde aussi **index** et **FK**, et le script d'alignement généré peut être **exécuté directement dans SkylerX**.

### TableProfile

Chaque table est normalisée en un `TableProfile` : `columns: Map<name, {type, nullable, default, pk}>` + `indexes: Map<name, {unique, columns[]}>` + `fks: Map<name, "(c1,c2) → other(c1,c2)">`, plus un DDL brut pour comparaison visuelle.

Sources de récupération selon dialecte : MySQL utilise `SHOW CREATE TABLE` + `information_schema.COLUMNS / STATISTICS / KEY_COLUMN_USAGE` ; PG utilise `information_schema.columns` + `pg_indexes` (extraction unique et colonnes par regex sur `indexdef`) + `information_schema.constraint_column_usage`.

### Rapport

Trois colonnes : **Source uniquement / Cible uniquement / Contenu différent**. La 3e colonne, chaque table déploie les changements de colonnes (`+ name / − name / ~ name`), index (`+ idx_x`), FK (`~ fk_x`). Cliquez sur une ligne pour déplier le diff DDL en deux colonnes.

### Script d'alignement (sortie clé)

Bouton « + Aligner » sur chaque ligne, **ajoute** le SQL correctif de la table à la zone d'aperçu en bas :

| État | Instruction générée |
|---|---|
| Source uniquement | Copie directe du DDL source (`CREATE TABLE`) |
| Cible uniquement | `-- DROP TABLE \`x\`; -- Commenté, à décommenter manuellement` |
| Colonne ajoutée | `ALTER TABLE \`t\` ADD COLUMN \`c\` {srcType};` |
| Colonne supprimée | `-- ALTER TABLE ... DROP COLUMN ...` commenté (protection) |
| Colonne modifiée | MySQL : `MODIFY COLUMN` ; PG : `ALTER COLUMN ... TYPE` |
| Diff index / FK | Indication par commentaire `-- INDEX +xx` / `-- FK -xx` uniquement, **non généré auto** (syntaxe complexe, à faire manuellement) |

Exécution : `▶ Exécuter le script` → confirmation à risque → splitte par `;\s*\n` en sautant les `--` commentés → `executeBatch`.

> Compromis de conception : suppression de tables / colonnes commentées par défaut, ajout de colonnes / modif de type directement exécutables. « Le destructif en commentaire, le réparateur autorisé » — le plus sûr en exploitation.

## 8. Nouvelle base de données (NewDatabaseDialog)

`packages/ui/src/components/NewDatabaseDialog.vue`. Clic droit nœud connexion → Nouvelle base.

Dans la popup : **Nom (obligatoire)** + « Options avancées » (jeu de caractères / collation / commentaire) en accordéon + **Aperçu SQL (éditable)**. C'est l'aperçu qui est exécuté, pas le formulaire — vous pouvez ajouter `IF NOT EXISTS` manuellement.

### Matrice des dialectes

| Dialecte | Supporté | Notes |
|---|---|---|
| MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks | ✓ | `CREATE DATABASE \`n\` [DEFAULT CHARACTER SET ...] [DEFAULT COLLATE ...]` (sans COMMENT) |
| PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift | ✓ | `CREATE DATABASE "n" [ENCODING '...']` + `COMMENT ON DATABASE` séparé |
| SQL Server | ✓ | `CREATE DATABASE [n]` (sans jeu de caractères) |
| ClickHouse | ✓ | `CREATE DATABASE \`n\` COMMENT '...'` |
| Snowflake | ✓ | `CREATE DATABASE "n" COMMENT = '...'` |
| TDengine | ✓ | `CREATE DATABASE n` (sans guillemets) |
| **Oracle / DM** | ✗ | Base = niveau instance, nécessite DBCA. Suggère « créer un schema (user) à la place » |
| SQLite / DuckDB | ✗ | Type fichier, base = fichier, on crée via une nouvelle connexion en sélectionnant un fichier |
| H2 | ✗ | Décidé par les paramètres de démarrage, pas de création SQL à la volée |
| MongoDB / Redis / Elasticsearch | ✗ | Mécanismes collection / index / db0-15, pas de CREATE DATABASE |

Dialectes non supportés : affichage rouge direct, impossible de soumettre.

### Options de jeu de caractères

Recommandations par dialecte :

- Famille MySQL : `utf8mb4 / utf8 / latin1 / gbk`, collation `utf8mb4_general_ci / unicode_ci / 0900_ai_ci / bin`
- Famille PG : `UTF8 / SQL_ASCII / LATIN1 / GBK`

À la soumission, splitte par `;\s*\n` et exécute chaque instruction.

## 9. Nouveau Schema (NewSchemaDialog, traitement spécial Oracle)

`packages/ui/src/components/NewSchemaDialog.vue`. Clic droit nœud base → Nouveau Schema.

### Matrice des dialectes

| supportInfo | Dialectes | Syntaxe |
|---|---|---|
| `pg` | PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift | `CREATE SCHEMA "n" [AUTHORIZATION "owner"]` + `COMMENT ON SCHEMA` optionnel |
| `sqlserver` | SQL Server | `CREATE SCHEMA [n] [AUTHORIZATION owner]` |
| `snowflake` | Snowflake | `CREATE SCHEMA "n" [COMMENT = '...']` |
| `oracle` | Oracle / DM | **Schema = User**, passe par CREATE USER + GRANT (voir ci-dessous) |
| `null` | MySQL / SQLite / ClickHouse / TDengine / NoSQL | Pas de notion de Schema, affiche « Ce dialecte n'a pas de Schema » |

### Traitement spécial Oracle / DM

Dans Oracle, « schema » est synonyme de « user ». Ce dialogue applique des valeurs par défaut sensées pour le développement :

```sql
CREATE USER :name IDENTIFIED BY :password
  DEFAULT TABLESPACE USERS
  TEMPORARY TABLESPACE TEMP
  QUOTA UNLIMITED ON USERS;

GRANT CONNECT, RESOURCE, UNLIMITED TABLESPACE,
      CREATE VIEW, CREATE SYNONYM, CREATE SEQUENCE,
      CREATE PROCEDURE, CREATE TRIGGER, CREATE TYPE,
      CREATE MATERIALIZED VIEW, CREATE DATABASE LINK
   TO :name;
```

(Placeholders `:name` / `:password` représentent les valeurs saisies.)

Justification des choix, comme expliqué dans les commentaires du code :

- `QUOTA UNLIMITED ON USERS` — sans ça, première insertion → `ORA-01950: insufficient quota on tablespace USERS`
- Oracle 12c+ `RESOURCE` ne contient plus `CREATE VIEW / SEQUENCE` etc., il faut compléter explicitement pour le dev courant
- Pas de `SELECT ANY TABLE / DBA / SYSDBA` — garde l'utilisateur dans « son seul schema »
- Nom / mot de passe **sans guillemets** par défaut : identifiants unquoted légaux passent en majuscules auto Oracle (évite « guillemets minuscules → ALTER USER suivant introuvable »). Pour minuscules ou caractères spéciaux, ajoutez les guillemets dans l'aperçu SQL

Si le mot de passe est vide, placeholder `CHANGE_ME_123`, pour rappeler à l'utilisateur de le changer.

### Soumission

`execute` avec le contexte `database` (famille PG : schema dépend de la base, USE puis CREATE). Le toast d'erreur en cas d'échec inclut un lien `askAi` qui envoie SQL + erreur à l'IA pour explication (courant sur Oracle pour tablespace inexistant / permissions insuffisantes).

## 10. Assistance IA : Schema Architect + Schema Reverse

Deux outils conversationnels qui laissent toujours l'utilisateur valider le SQL final avant exécution.

### Schema Architect (description métier → DDL multi-tables)

`packages/ui/src/components/AiSchemaArchitectDialog.vue`. Conversationnel, itérations multi-tours.

System Prompt en substance :

> You are a senior database architect. The user describes a business domain.
> 1. Design **multiple related tables** with PK, FK, indexes for the **`{dialect}`** dialect.
> 2. Output a single ```sql code block containing the COMPLETE CREATE TABLE statements.
> 3. Explain key design decisions in 2-4 bullets.
> 4. When user asks to revise, output the FULL updated SQL again (not a diff).

Workflow :

1. Décrire le métier (« Un système e-commerce : users, products, orders, order_items, support coupons »)
2. L'IA renvoie un markdown : explication conception + bloc SQL complet
3. Continuez la conversation (« Ajouter un champ status » / « Convertir order_items en table partitionnée »), l'IA renvoie la **version complète** mise à jour
4. Bouton en haut `▶ Exécuter la dernière version` — prend `latestSql` (le SQL de la dernière réponse), splitte par `;\s*(?:\n|$)` → `execute` chaque instruction

`latestSql` prend toujours le dernier tour — si vous avez itéré cinq fois, c'est la cinquième version qui s'exécute, sans contamination des précédentes.

### Schema Reverse (données d'exemple → CREATE TABLE)

`packages/ui/src/components/AiSchemaReverseDialog.vue`. Mono-tour non conversationnel, adapté à « J'ai un CSV, créez-moi la table correspondante ».

Entrée : **format** (CSV / TSV / JSON) + **nom de table** + **données d'exemple** (quelques lignes suffisent, avec en-têtes pour la précision) + option « générer aussi INSERT ».

Le prompt force 4 sections en sortie : **Explication de l'inférence** (colonne → type → raison), **CREATE TABLE** (bloc `sql`), **INSERT (données)** (optionnel, bloc `sql`), **Recommandations d'index** (bullet list).

Après réponse de l'IA, `extractSql(text)` extrait le premier bloc SQL et l'injecte dans la zone éditable en bas, modifiable avant `▶ Exécuter`.

> Note sur les recommandations d'index : dans Schema Reverse, l'IA ne donne que des « suggestions » (par expérience), sans créer d'index. Pour recommander des index basés sur l'historique SQL réel + index existants → voir [Avancé et ingénierie → Recommandeur d'index](./advanced.md).

## 11. Évaluation de migration (MigrationAssessWizard)

Transforme une base source Oracle / DM en un rapport de faisabilité pour migrer vers une base nationale à noyau openGauss (Vastbase / openGauss) ou DM. Conçu pour les avant-ventes / DBA de projets de-Oracle (« 去O ») : voir combien, quelle taille et quelle difficulté présente la source *avant* de s'engager dans l'effort.

**Accès** : palette de commandes `act:mig-assess` (cherchez « Évaluation de migration »), ou clic droit sur une connexion Oracle / DM → `🧭 Évaluation de migration… ` (la pré-remplit comme source). Code dans `packages/ui/src/components/MigrationAssessWizard.vue` ; toute la logique est dans `packages/ui/src/migrate/`.

### Assistant en 5 étapes

| Étape | Rôle |
|---|---|
| 1 Connexion | Choisir la source (dialecte profilable) + la cible (dialecte avec chemin de conversion) |
| 2 Profilage | Lister bases / schémas (système filtré), cocher ceux à migrer, obtenir un inventaire complet d'objets + métriques de risque |
| 3 Évaluation | Récupérer les objets des schémas choisis, noter chacun A/B/C/D + un score global de « préparation » |
| 4 Conversion IA | Confier les objets de niveau C (corps PL/SQL / SQL complexe) à l'IA pour les traduire vers le dialecte cible (lecture seule) |
| 5 Rapport | Agréger et exporter en Excel / Word / PDF / Markdown |

### Architecture hub-and-spoke

Plutôt que des traducteurs source→cible par paires (une explosion N×M), un modèle logique intermédiaire (Logical IR) se place au centre :

```
source ──parse──▶ Logical IR ──emit──▶ cible
```

Chaque dialecte n'a besoin que d'un parser ou d'un emitter ; ajouter une base est donc N+M, pas N×M. Code : `migrate/ir.ts` (modèle), `migrate/convert.ts` (orchestration), `migrate/dialects/{oracle,postgres,dameng}.ts`. **Frontière** : les objets structurels (tables / colonnes / types / contraintes) passent par l'IR déterministe ; les objets procéduraux (procédures / fonctions / packages / triggers / vues) conservent leur DDL d'origine et sont traduits par l'IA (`migrate/aiConvert.ts`), là où la traduction par regex ne peut pas faire de réécriture sémantique.

### Profilage de la source

`migrate/profile.ts` + `migrate/profilers/{oracle,postgres}.ts`, un jeu de requêtes catalogue par famille source. Il inventorie 17 catégories d'objets, et **les objets non pris en charge s'affichent en `—` (null), pas en faux 0** :

> tables · vues · vues matérialisées · tables partitionnées · index · clés primaires · clés étrangères · contraintes uniques · contraintes check · séquences · fonctions · procédures · packages · triggers · types · synonymes · db links

Plus des métriques de risque : **tables sans PK** (l'écueil n°1 du CDC), **colonnes LOB** (l'essentiel du temps de migration des données), **tables avec triggers**, **tables avec commentaires** ; plus les tranches de lignes (≥1M / ≥10M / ≥100M), la taille de tablespace et les plus grosses tables. Les comptes de lignes utilisent les estimations du catalogue (`reltuples` / `num_rows`), sans `COUNT(*)` exact, donc même des tables de milliards de lignes répondent en quelques secondes. Quand `dba_segments` est illisible (sans privilège DBA), dégradation propre (taille 0 + avis).

### Export de documents

Quatre boutons sur la page du rapport, tous réutilisant des dépendances existantes (`xlsx` / `marked`), sans nouvelle librairie :

| Format | Comment |
|---|---|
| Excel `.xlsx` | Multi-feuilles : aperçu / inventaire / grandes tables / détail d'évaluation / conversions IA |
| Word `.doc` | Markdown rendu en HTML stylé, s'ouvre nativement dans Word |
| PDF | Le même HTML dans une fenêtre qui s'imprime seule → « Enregistrer en PDF » de Chromium |
| Markdown `.md` | Rapport en texte brut |

> Notation : **A Auto** (déterministe, tel quel) · **B Assisté** (différences de type / sémantique, à vérifier) · **C Manuel** (corps PL/SQL ou syntaxe propriétaire, nécessite IA + humain) · **D Bloqué** (sans équivalent — spatial / packages externes — nécessite une revue d'architecture). Préparation = moyenne pondérée des niveaux d'objet (A=100 / B=80 / C=40 / D=0).

## Matrice de compatibilité

Tableau récapitulatif des dialectes supportés par outil. `▣` = support complet, `◐` = support partiel, `-` = non applicable / sauté.

| Outil | Famille MySQL | Famille PG | SQL Server | Oracle / DM | SQLite | ClickHouse | NoSQL |
|---|---|---|---|---|---|---|---|
| TableStructure | ▣ (`SHOW CREATE TABLE` natif) | ◐ (reconstitué) | ◐ (reconstitué) | ◐ (reconstitué) | ◐ | ◐ | - |
| TableDesigner — CREATE | ▣ | ▣ | ▣ | ▣ | ◐ (types / options limités) | ◐ | - |
| TableDesigner — ALTER diff | ▣ | ▣ | ◐ | ◐ | ◐ | ◐ | - |
| DdlEditor | ▣ (SHOW CREATE) | ▣ (`pg_get_viewdef` / `funcdef`) | ◐ | ▣ (DBMS_METADATA) | ◐ | ◐ | - |
| ErdView | ▣ | ▣ | ◐ | ◐ | ◐ | - | - |
| SchemaSnapshots | ▣ | ◐ (DDL simplifié) | - | - | - | - | - |
| SchemaDiff | ▣ | ▣ | - | - | - | - | - |
| SchemaDrift | ▣ | ▣ | - | - | - | - | - |
| NewDatabase | ▣ | ▣ | ▣ | - (utilisez NewSchema) | - (type fichier) | ▣ | - (commandes dédiées) |
| NewSchema | - (pas de notion) | ▣ | ▣ | ▣ (=User) | - | - | - |
| AI Architect / Reverse | ▣ | ▣ | ▣ | ▣ | ▣ | ▣ | ◐ |

« Famille MySQL » inclut MySQL / MariaDB / OceanBase / TiDB / Doris / StarRocks. « Famille PG » inclut PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift / H2 (compatible PG).

## Workflows courants combinés

**Bâtir une base métier from scratch** :
1. Clic droit connexion → Nouvelle base → aperçu SQL OK → exécuter
2. Palette → Assistant IA création tables → description métier → DDL complet → exécuter sur la nouvelle base
3. Clic droit schema → diagramme ER → vérifier les relations / ajuster
4. Modifier des champs : clic droit table → Designer (mode alter) → modif + enregistrer (ALTER diff)

**Aligner deux bases** :
1. Palette `act:schema-diff` → choisir connexions dev / prod → SQL de migration → « Ouvrir en requête sur la connexion cible » → vérifier → Run
2. Soupçon de modification manuelle sur prod : `act:drift` → choisir baseline / prod → rapport 3 colonnes → « + Aligner » sur les tables concernées → aperçu script → exécuter

**Revoir l'historique** :
1. Avant déploiement `act:snapshots:{connId}` → snapshot → commentaire « Avant v2.0 »
2. Trois mois plus tard : ouvrir le dialogue snapshots → cocher « Avant v2.0 » + un nouveau snapshot → comparer → voir quelles tables ont changé

Les capacités de la couche structure sont couvertes. Pour continuer sur les plans de requête runtime, slow logs, recommandation d'index, voir [Avancé et ingénierie](./advanced.md) ; pour les outils de migration inter-dialectes, voir [Support des bases de données](./databases.md).
