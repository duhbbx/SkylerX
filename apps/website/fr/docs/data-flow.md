# Flux de données : import / export / sauvegarde / migration

SkylerX centralise tous les chemins « les données entrent / sortent de la base » dans un ensemble cohérent de dialogues, le tout passant par un `SaveFileDialog` personnalisé (cohérent multiplateforme, sans dialogue système natif) et un parsing côté renderer (CSV/JSON/Excel traités en mémoire). Ce chapitre suit l'ordre « sortie → entrée → sauvegarde/restauration → migration inter-bases → dictionnaire de données → comparaison de données ».

## 1. Vue d'ensemble : ce que cette zone couvre

| Scénario | Entrée | Dialogue / fonction principal | Formats |
|---|---|---|---|
| Quelques lignes copiées à la volée | Clic droit grille → "Copier en" | `ResultGrid.vue::copyRows` | CSV / TSV / JSON / Markdown / SQL VALUES |
| Téléchargement d'une table / schema entier | NavTree clic droit "Exporter SQL" → `ExportOptionsDialog` | `Workspace.vue::doTableExport` / `doSchemaExport` | SQL (CREATE + INSERT) |
| Déménagement de tout l'espace de travail | Palette `act:export-conns` / `WorkspaceExportDialog` | `WorkspaceExportDialog.vue` | JSON `.skylerxws` |
| Injecter CSV/JSON/Excel dans une table | NavTree clic droit "Importer données" → `ImportDialog` | `ImportDialog.vue` + `io.ts` | CSV / TXT / JSON / NDJSON / XLSX |
| Coller directement Excel/Feishu Sheets | ⌘V dans la zone principale (ou `PasteImportDialog`) | `PasteImportDialog.vue` | TSV / CSV |
| Visualiser un fichier .ndjson | Palette `act:ndjson-viewer` | `NdjsonViewerDialog.vue` | `.ndjson` / `.jsonl` |
| Sauvegarde / restauration de base | Palette `act:backup:<id>` (une par connexion) | `BackupRestoreDialog.vue` | `.sql` / `.ndjson` |
| Copier une table entre connexions | NavTree clic droit "Transfert de données" | `DataTransferDialog.vue` | SELECT par ligne → INSERT par batch |
| Générer un dictionnaire de données | NavTree clic droit schema/db → "Dictionnaire de données" | `Workspace.vue::genDataDict` + `dump.ts` | Markdown / HTML |
| Comparer les données de deux tables | Palette `act:data-diff` | `DataDiffDialog.vue` + `data-diff.ts` | Diff par ligne → SQL de sync |

Les IO fichier passent toutes par `client.files` (implémenté dans le main process : `openText / saveText / listDir / commonDirs / mkdir`). Le web ne dispose pas de `listDir`, fallback vers le download/upload navigateur (formats texte seulement).

## 2. Export

### 2.1 Copie multi-format depuis le résultat

`ResultGrid.vue` clic droit sur cellule / sélection, sous-menu "Copier en" :

| Item | Implémentation | Usage |
|---|---|---|
| CSV | `io.ts::toCSV` | Coller directement dans Excel / Numbers |
| TSV | `io.ts::toTSV` | Excel / Notion / Feishu Sheets (séparateur `\t`) |
| JSON | `io.ts::toJSON` | Pour code `JSON.parse`, `Date` en `toISOString()` |
| Markdown | `io.ts::toMarkdown` | Coller dans documents / descriptions PR (échappe `|` et nouvelles lignes) |
| SQL VALUES | `io.ts::toSqlValuesList` | `(1, 'a'), (2, 'b')`, à coller dans `INSERT...VALUES` / `VALUES (...) AS t` / `ON CONFLICT ... EXCLUDED` |
| SQL INSERT | `io.ts::toInsertSql` | `INSERT INTO tbl (...) VALUES (...)` une par ligne, exécutable |

**Détails de conversion de types** (`io.ts`) :

- `null/undefined` → vide (CSV) / `NULL` (SQL) ;
- `Date` → `toISOString()` ;
- `number` → tel quel, `Infinity/NaN` deviennent `NULL` en SQL ;
- `boolean` → `TRUE/FALSE` en SQL (attention : SQLite reconvertit en `1/0`) ;
- `object/array` → `JSON.stringify`, entouré de guillemets simples en SQL ;
- Le `'` simple est doublé (`a'b` → `'a''b'`), anti-injection.

CSV ajoute des guillemets si la cellule contient `"` / `,` / saut de ligne ; TSV pour `\t` / saut de ligne / `"`. Pas de guillemets systématiques, le collage Excel est plus propre.

### 2.2 ExportOptionsDialog — Export complet table / schema

NavTree clic droit table ou schema → "Exporter SQL", ouvre un mini-dialogue `ExportOptionsDialog` :

- **Structure seulement** → `withData = false`, sort seulement `CREATE TABLE` ;
- **Structure + données** → `withData = true`, suivi de `SELECT * FROM ref` + liste d'`INSERT`.

À la réception de `pick`, `Workspace.vue` lance `doTableExport` / `doSchemaExport` :

1. `client.connections.metadata(... group: 'columns')` extrait les colonnes ;
2. `dump.ts::buildCreateFromColumns` **reconstruit le CREATE TABLE** depuis les métadonnées (v1 inclut PK, sans index ni FK — la syntaxe d'index varie trop entre dialectes, on assure d'abord la stabilité) ;
3. Si `withData`, `SELECT * FROM ref` (sans pagination, pour grandes tables utilisez sauvegarde/migration) ;
4. `buildTableDump` produit :

   ```sql
   -- Structure de la table
   CREATE TABLE `users` (...);

   -- Données (N lignes)
   INSERT INTO `users` (...) VALUES (...);
   ```

5. Nom de fichier par défaut `<nom_objet>.sql`, extension fixe `.sql`, sauvegarde via `client.files.saveText` + `SaveFileDialog` personnalisé.

L'export schema itère sur les tables et ajoute un `-- ws.dumpHeader { label, n }` en en-tête.

### 2.3 Export complet du Workspace (`.skylerxws`)

`WorkspaceExportDialog.vue` couvre les scénarios "changement de machine" et "partage entre collègues". Structure du fichier :

```ts
interface WorkspaceFile {
  version: 1
  exportedAt: number
  source: string                  // 'SkylerX'
  connections?: ConnectionConfig[]
  snippets?: typeof snippets
}
```

Options d'export (cochables indépendamment) :

| Option | Défaut | Description |
|---|---|---|
| Inclure les connexions | ✓ | Via `client.connections.list()`, **anonymisé** par défaut (sans mot de passe) |
| ⚠ Inclure les mots de passe | ✗ | Coché → appel `client.connections.get(id)` ligne par ligne pour récupérer le texte clair. Le fichier devient portable entre machines — sans dépendre du keychain OS, au prix de mots de passe en clair, à utiliser avec précaution |
| Inclure les snippets SQL | ✓ | Copie JSON intégrale, sans modification d'ID |

Nom par défaut `skylerx-workspace-YYYY-MM-DD.skylerxws`, accepte `.skylerxws` et `.json`.

À l'import, décompte "connexions + snippets" → double confirmation → fusion selon la stratégie de conflit :

- **skip** : ignorer si même nom (défaut) ;
- **overwrite** : même `name` → `update` avec l'id du doublon, écrase tous les champs (mots de passe inclus si présents) ;
- **rename** : nouveau avec suffixe `(importé)` au `name`.

### 2.4 Export chiffré `.sql.enc` (AES-256-GCM + PBKDF2)

`export-encrypt.ts` fournit une API en fonctions pures, l'UI l'appelle selon le scénario (typique : exporter un dump SQL contenant des données sensibles pour un partenaire externe). Choix d'algorithmes :

| Élément | Valeur | Compromis |
|---|---|---|
| Magic en-tête | `SKYLERX-ENC-v1` | Identification de version pour upgrade |
| KDF | PBKDF2-HMAC-SHA-256 | Natif dans navigateur/Node, sans dépendance |
| Itérations | `DEFAULT_ITER = 200_000` | OWASP 2023 recommande ≥ 600k, ici compromis pour vieilles machines, augmentable |
| Algorithme | AES-GCM | Tag d'auth 128-bit intégré, mot de passe faux / fichier modifié → `WRONG_PASSWORD` |
| Longueur clé | 256 bit | `deriveKey` produit AES-GCM 256 |
| Salt | 16 octets aléatoires | Regénéré à chaque fois, jamais réutilisé |
| IV | 16 octets aléatoires | Regénéré à chaque fois, jamais réutilisé |
| Sérialisation | JSON une ligne | Lecture/écriture streaming, `.sql.enc` lisible dans un éditeur texte |

Format disque (JSON une ligne) :

```json
{ "magic": "SKYLERX-ENC-v1", "salt": "<b64>", "iv": "<b64>", "iter": 200000, "data": "<b64-cipher+tag>" }
```

Détails d'implémentation :

- Utilise `globalThis.crypto.subtle`, **sans dépendance tierce** ; vieux Node sans subtle → exception directe pour forcer la mise à jour ;
- `Uint8Array` toujours initialisé via `new ArrayBuffer(n)`, contourne l'erreur de typage TS 5.7 + lib.dom qui durcit `BufferSource` sur `ArrayBuffer` ;
- Encodage base64 par blocs de 32 KB, évite `String.fromCharCode(...bytes)` qui explose la pile sur grands fichiers ;
- L'échec de vérification GCM est traduit uniformément en `WRONG_PASSWORD`, **sans révéler** l'`OperationError` brut, anti side-channel.

## 3. Import

### 3.1 ImportDialog — Assistant 3 étapes universel CSV / JSON / NDJSON / Excel

NavTree clic droit table → "Importer données", `ImportDialog.vue` est un assistant en 3 étapes (`step: 'pick' | 'map' | 'run'`) :

#### Étape 1 : Choisir le fichier

- Bouton principal "Sélectionner un fichier" → `client.files.openText`, filtre `csv / txt / json` (JSON détecté par `\.json$/i` ou premier caractère `[`/`{`, passe par `parseJSON`).
- Bouton secondaire "Excel…" → `<input type=file>` côté renderer, lit l'`ArrayBuffer` puis **import dynamique à la demande** de `xlsx` (SheetJS). Ne lit que la première feuille, `raw: false` (valeurs affichées Excel, dates non converties en nombres), `defval: ''`. Le binaire ne passe pas par le canal texte, pas de blocage IPC sur gros fichiers.
- Après parsing, aperçu des 5 premières lignes, case "Première ligne = en-têtes" ajustable manuellement.

`io.ts::parseCSV` est un state machine à la main : BOM, échappement `""`, CRLF / LF, virgules / sauts de ligne dans les guillemets. Filtre les lignes "vides" à champ unique.

`io.ts::parseJSON` accepte trois formes :

- **Tableau d'objets** : union des clés en en-tête (ordre d'apparition) ;
- **Tableau de tableaux** : première ligne = en-tête ;
- **Objet unique** : traité comme 1 ligne.

#### Étape 2 : Mappage des champs + inférence de type

`autoMap()` apparie source/cible par "égalité exacte après minuscule". Chaque colonne a un dropdown manuel, "Ignorer" = `-1`.

Inférence de type `inferType(srcIdx)` échantillonne **les 50 premières valeurs non vides** de la colonne :

| Inférence | Regex |
|---|---|
| `number` | `/^-?\d+(\.\d+)?$/` |
| `date` | `/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?Z?$/i` |
| `boolean` | `/^(true|false|t|f|y|n)$/i` |
| `string` | Fallback |

Présence de chaînes vides → marquage `nullable`, badge UI `·∅`. **Note** : l'inférence est juste indicative, l'exécution insère en chaîne, le cast réel se fait côté DB selon la définition de colonne — tolère les différences de dialecte (MySQL `'2024-01-01'` → DATE auto, SQLite → TEXT).

#### Étape 3 : Options + exécution

| Option | Défaut | Comportement |
|---|---|---|
| TRUNCATE avant import | ✗ | Insère un `TRUNCATE TABLE <ref>` avant les `INSERT` ; à utiliser avec prudence, **non annulable** (TRUNCATE est DDL en MySQL/PG) |
| Lignes par batch | 200 (min 1, max 2000) | Contrôle le nombre de lignes par `INSERT INTO t (...) VALUES (...), (...), ...`, évite la troncature de très longues instructions par le driver |

Exécution via `client.connections.executeBatch`, les chaînes vides (`''`) sont traitées comme `NULL` (`io.ts::buildInsertStatements` : `s == null || s === '' ? 'NULL' : ...`), donc **l'import ne distingue pas "vraie chaîne vide" et "absence de valeur"**. Pour les cas stricts, passez par l'éditeur SQL manuellement.

### 3.2 PasteImportDialog — Insertion directe depuis le presse-papier

`PasteImportDialog.vue` est l'alternative légère à ImportDialog : à l'ouverture, `navigator.clipboard.readText()`, sans choix de fichier.

| Entrée | Chemin de parsing |
|---|---|
| Contient `\t` | TSV (format de copie par défaut d'Excel / Feishu Sheets) split par `\t` |
| Sans `\t` | Parsing CSV manuel simple (échappement `""`, mais **pas les guillemets imbriqués complexes** — basculez sur ImportDialog dans ces cas) |

Les colonnes de la table cible viennent de `information_schema.columns` en direct (MySQL / MariaDB / OB / TiDB / Doris / StarRocks : `table_schema + table_name` ; PG / autres : `table_name + table_catalog`). Mappage auto par normalisation (`toLowerCase + retrait _-espaces`), le reste manuel, vide = ignorer.

Taille de batch fixe `BATCH = 500`, chaque batch une instruction `INSERT INTO ... VALUES (...), (...)` ; `sqlLiteral` simplifié : vide → `NULL`, numérique tel quel, le reste entre guillemets simples (`'` doublé). **Redis / bases documents non SQL exclus** (n'affiche que les connexions `dialectKind === DbKind.Sql`).

Cas d'usage : copier quelques dizaines à milliers de lignes depuis Feishu / Excel et coller. Pour plus, ImportDialog (`executeBatch`) ou DataTransferDialog (paginé).

## 4. Visualiseur NDJSON (`NdjsonViewerDialog`)

Palette `act:ndjson-viewer` → choisir `.ndjson` / `.jsonl` → visualisation tableau, **sans connexion DB**.

Règles de parsing (`parse()`) :

- Split par ligne, lignes vides / erreurs de parsing → comptées dans `skipped` (sans bloquer) ;
- Reconnaît le format dbgate Archives `{ __table, data }` → ligne assignée à `__table`, données dans `data` ;
- Reconnaît `{ __error: "..." }` → compteur `skipped++` ;
- Autres lignes : JSON ordinaire, `table = ''`.

Fonctionnalités UI :

- **Onglets inter-tables** : en haut, un onglet par `__table` rencontré, click pour ne voir que cette table ;
- **Union des colonnes** : union des `Object.keys` des lignes visibles comme en-têtes (lignes avec champs manquants affichent `null`) ;
- **Détail de ligne** : double-clic à droite / en bas développe le JSON complet ;
- **Copier intégral / Enregistrer sous** : fichier entier dans le presse-papier, ou `saveText` sous (nom original conservé par défaut) ;
- **V1 lecture seule** : pas d'édition ni de réimport en base, à venir.

## 5. Sauvegarde / restauration (`BackupRestoreDialog`)

Palette `act:backup:<connId>` → `BackupRestoreDialog`. **MVP en SQL pur** : pas d'appel externe à `mysqldump` / `pg_dump` (détection de chemin cross-platform fastidieuse, peut être absent) ; à venir si besoin DDL complet (trigger / view / ordre FK) via IPC `child_process.spawn`.

#### Formats de sauvegarde

| Format | Implémentation | Caractéristiques |
|---|---|---|
| **SQL** | Renvoie au NavTree clic droit "Exporter SQL" (réutilise `doSchemaExport`) | Chemin traditionnel, directement consommable par `mysql/psql` |
| **NDJSON** | `doBackupNdjson()` natif | Format dbgate Archives, import/export cross-connexion facile |

Flux NDJSON :

1. `metadata({ group: 'tables', path: [database] })` extrait toutes les base tables ;
2. Pour chaque table `SELECT * FROM <sqlName>`, écrit `{"__table":"t","data":{...}}\n` par ligne ;
3. Échec d'une table : **ne s'arrête pas**, écrit `{"__table":"t","__error":"..."}` (visible à la restauration) ;
4. `saveText` vers `skylerx-<nom_connexion>-<timestamp>.ndjson`, filtre `.ndjson / .jsonl` ;
5. Barre de progression (`done / total · phase`) + bouton "⏹ Arrêter" (`stopRequested` vérifié avant chaque table).

Limite connue : `BLOB / Buffer` via `JSON.stringify` deviennent `{ type: 'Buffer', data: [...] }`, **ne se reconvertissent pas en binaire à la restauration** ; pour cas strict, utilisez le chemin SQL.

#### Flux de restauration

| Chemin | Flux |
|---|---|
| SQL | `client.files.openText` → `splitStatements(content)` par `;` → double confirmation → `execute` séquentiel, **échec d'une instruction n'interrompt pas**, erreur dans `restoreProgress.errors[]` (200 premiers caractères) |
| NDJSON | Bucket par `__table` → **un gros `INSERT` par bucket**, internement chunks de `chunkSize = 100` (évite `max_allowed_packet`) → collecte d'erreurs idem |

UI : barre de progression temps réel + liste d'erreurs (tronquée + wrap) + toast 3 états `restoreOk / restoreWithErrors / restoreStopped`.

## 6. Migration entre connexions (`DataTransferDialog`)

NavTree clic droit table → "Transfert de données". Plus ciblé que sauvegarde/restauration : **une table vers une table**, on choisit la source et c'est parti, adapté à dev→staging.

| Champ | Défaut | Description |
|---|---|---|
| Connexion cible | Connexion courante | Liste de toutes les connexions, suffixe `(courante)` |
| Database cible | Ctx source | Sémantique varie par dialecte ; PG = catalog, MySQL = base |
| Schema cible | Ctx source | PG/KB obligatoire (défaut `public`), MySQL vide |
| Nom de table cible | Nom source | Inexistant = échec d'insertion ; pas de création auto |
| Lignes par batch | 500 | Contrôle `SELECT ... LIMIT ? OFFSET ?` côté source |
| TRUNCATE cible d'abord | ✗ | Exécute en fait `DELETE FROM <ref>` (pas `TRUNCATE`, transactable) |

Boucle d'exécution :

```ts
for (let page = 0; page < 100000; page++) {
  const res = await execute(srcId, `SELECT * FROM ${srcRef}`, [],
    { ..., limit: size, offset: page * size })
  if (!res.rows.length) break
  await executeBatch(tgtId, rowInserts(tgt.dialect, dstRef, cols, res.rows), dstOpts)
  if (res.rows.length < size) break    // arrêt anticipé
}
```

- Max 100 000 pages = garde-fou anti-boucle infinie ;
- Les noms de colonnes viennent du `metadata` source, donc **la table cible doit avoir les mêmes noms de colonnes** (l'ordre est libre, `rowInserts` les liste explicitement) ;
- Conversion de types confiée à JS → SQL literal (`io.ts::sqlLiteral`) + cast implicite DB cible. Pour types complexes (Postgres `jsonb`, MySQL `BIT(1)`), risque de perte ; faire un spot-check après migration.

## 7. Export du dictionnaire de données (Markdown / HTML)

NavTree clic droit schema (ou db) → "Dictionnaire de données → Markdown / HTML". `Workspace.vue::genDataDict` appelle `dump.ts::buildDataDictMarkdown / buildDataDictHtml`.

Une section par table, colonnes fixes :

| Champ | Type | Nullable | PK | Défaut | Commentaire |
|---|---|---|---|---|---|
| `id` | `bigint unsigned` | N | 🔑 | | Clé primaire utilisateur |
| `email` | `varchar(255)` | Y | | `NULL` | Email |

Source : `metadata({ group: 'columns' })` retourne `MetadataNode.detail.{dataType, nullable, primaryKey, defaultValue, comment}`.

#### Différences Markdown vs HTML

| Dimension | Markdown | HTML |
|---|---|---|
| Échappement | `|` → `\|`, sauts de ligne → espaces | Entités `&<>` |
| TOC | Aucune (utilisez l'outline IDE) | TOC 3 colonnes, ancres `#t-<urlencoded>` |
| Mise en forme | Markdown pur | `<style>` inline, sans-serif fixe, tableaux bordés, lignes paires/impaires, `@media print` anti coupure |
| Usage | Inclusion documents / Wiki / GitLab | Ouverture navigateur pour impression PDF |

Nom du fichier `<schema-or-db>-data-dict.md|html`. **Entièrement offline** — le dictionnaire est un besoin fréquent en audit conformité, possible en environnement sans réseau.

## 8. Comparaison de données (`DataDiffDialog`)

Palette `act:data-diff`. **Deux connexions × deux tables → diff par ligne → SQL de sync**.

Algorithme cœur dans `data-diff.ts::diffRows` (fonction pure, testable) :

```ts
diff = {
  inserts: Row[],            // Présent en source / absent en cible
  updates: RowUpdate[],      // Même PK, colonnes non-clé différentes
  deletes: Row[]             // Présent en cible / absent en source
}
```

Clés d'appariement (`keyCols`) :

- Par défaut, **clé primaire** depuis `information_schema.table_constraints + key_column_usage` (SQL commun MySQL / PG) ;
- L'utilisateur peut saisir / modifier `keyColsInput` (virgules) pour surcharger.

Comparaison de valeurs `same(a, b)` via **normalisation chaîne** : `null/undefined` = vide, sinon `String(a) === String(b)` — tolère les différences de driver (`MySQL2` retourne `BigInt`, `pg` retourne `Number`, SQLite retourne `string`).

Matrice de support : **familles MySQL (MySQL / MariaDB / OB) + PostgreSQL (PG / KingbaseES)** seulement ; autres dialectes (SQLite / Oracle / SQL Server / Redis etc.) : UI affiche "MyPg seulement", bouton désactivé.

Résultats d'exécution :

| Indicateur | Sens |
|---|---|
| `inserts` | Compléter la cible avec la source |
| `updates` | Aligner la cible sur la source (SET uniquement les colonnes différentes) |
| `deletes` | Lignes superflues sur cible, **fin de script + commenté** "Présent uniquement en cible ; à valider avant exécution", anti-suppression accidentelle |

Final : `generateDataSync` produit un SQL lisible, à "Copier" ou "Ouvrir en requête", à exécuter sur la cible — donne une fenêtre de dry-run / human-review.

`LIMIT` (défaut 2000) anti-OOM, en cas de grosses différences de PK il faut restreindre d'abord.

## 9. Sécurité (résumé)

Détails dans [Modèle de sécurité](./troubleshooting.md). Points clés de ce chapitre :

- **Workspace export sans mot de passe par défaut** ; coché → JSON nu, UI affiche un "⚠" rouge explicite ;
- **`.sql.enc` chiffré** en AES-256-GCM, mot de passe faux et fichier modifié donnent la même erreur, pas de side-channel ;
- NDJSON backup **ne masque pas** ; le vrai masquage : générer avec PII Scanner ou écrire `SELECT replace(...)` manuellement ;
- Les données temporaires d'import/export sont **uniquement en mémoire**, pas de fichier intermédiaire, libérées à la fermeture du dialogue.

## 10. Matrice de compatibilité

| Capacité | Famille MySQL | Famille PG | SQLite | Oracle | SQL Server | DM / KingbaseES | Redis | MongoDB |
|---|---|---|---|---|---|---|---|---|
| Copier en CSV/TSV/JSON/MD | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Copier en SQL VALUES/INSERT | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Export SQL table/schema | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Export `.skylerxws` complet | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Export chiffré `.sql.enc` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ImportDialog (CSV/JSON/Excel) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Via RedisImportExport | Via NDJSON |
| Import presse-papier | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Visualiseur NDJSON | Sans dépendance DB | Sans dépendance DB | — | — | — | — | — | — |
| Sauvegarde/restauration SQL | ✓ | ✓ | ✓ | Partiel | ✓ | ✓ | — | — |
| Sauvegarde/restauration NDJSON | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Migration inter-connexion | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Dictionnaire de données (MD/HTML) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Comparaison ligne + SQL sync | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ (KB) | — | — |

"✗" = explicitement désactivé ; "—" = sans sens pour ce dialecte (KV / docs via `RedisImportExportDialog` dédié).

## Aide-mémoire de déclenchement

| Action | Barre d'outils | Clic droit | Palette ⌘K | Raccourci |
|---|---|---|---|---|
| Copier résultat en CSV / TSV / ... | — | Grille → Copier en → ... | — | — |
| Exporter table SQL | — | NavTree table → Exporter SQL | — | — |
| Exporter Schema SQL | — | NavTree schema → Exporter SQL | — | — |
| Exporter Workspace | Engrenage haut → Exporter | — | `Exporter Workspace` (`act:export-conns`) | — |
| Importer Workspace | Engrenage haut → Importer | — | `Importer Workspace` (`act:import-conns`) | — |
| Importer données (CSV/JSON/Excel) | — | NavTree table → Importer données | — | — |
| Import presse-papier | — | — | `PasteImport` (menu haut) | — |
| Visualiser NDJSON | — | — | `Visualiseur NDJSON` (`act:ndjson-viewer`) | — |
| Sauvegarde / restauration | — | — | `Backup/Restore · <connexion>` (`act:backup:<id>`) | — |
| Transfert de données | — | NavTree table → Transfert de données | — | — |
| Dictionnaire de données | — | NavTree schema/db → Dictionnaire → MD / HTML | — | — |
| Comparaison de données | — | — | `Comparaison de données` (`act:data-diff`) | — |

Note : toute action "Enregistrer sous" passe par le même `SaveFileDialog` personnalisé (`packages/ui/src/components/SaveFileDialog.vue`) — cohérent macOS / Windows / Linux, **sans dialogue natif** ; supporte favoris, répertoires récents, ↑↓ pour parcourir, Enter pour valider, ⌘L pour focus barre d'adresse.
