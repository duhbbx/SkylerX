---
title: Feuille de route
description: Bases de données à venir et fonctionnalités planifiées de SkylerX, actualisées chaque trimestre.
---

# Feuille de route

> Dernière mise à jour : 2026-06-04
> Plan directionnel, sans engagement ferme. La cadence réelle dépend des retours et des ressources.
> Source complète : [ROADMAP.md sur GitHub](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md)

Envie de faire avancer quelque chose ?

- 👍 votez sur l'[issue](https://github.com/duhbbx/SkylerX/issues) correspondante
- Déposez une nouvelle demande : [Feature request](https://github.com/duhbbx/SkylerX/issues/new/choose)
- Discutez de l'architecture : [Discussions](https://github.com/duhbbx/SkylerX/discussions)

## Légende

- ✅ Livré
- 🟢 En cours / ce trimestre
- 🔵 Prochain trimestre
- ⚪ Candidat — la priorité évolue avec les retours
- 🟣 Long terme / nécessite un changement d'architecture

---

## 1. Bases de données

### 1.1 Déjà prises en charge (au 2026-05)

| Catégorie | Pilotes |
|---|---|
| **Relationnel (open source)** | MySQL · MariaDB · PostgreSQL · SQLite · H2 |
| **Relationnel (commercial)** | Oracle · SQL Server |
| **Chinois / 信创** | DM (达梦) · KingbaseES (人大金仓) · OceanBase · TiDB · GBase |
| **Analytique (MPP/OLAP)** | ClickHouse · Snowflake · Amazon Redshift · Apache Doris · StarRocks · DuckDB |
| **Séries temporelles** | TDengine |
| **NoSQL** | MongoDB · Redis · Elasticsearch |

### 1.2 Plan d'intégration

#### 🟢 2026 T3 (juil.–sept.)

| Base de données | Type | Notes |
|---|---|---|
| **PolarDB-PG / -X** | Cloud-native | Réutilise un pilote existant |
| **GaussDB (Huawei)** | 信创 | Mode compatible PG |
| **TimescaleDB** | Séries temporelles (ext. PG) | Hypertables / agrégats continus |
| **Cassandra / ScyllaDB** | NoSQL wide-column | CQL sur le canal SQL |
| **InfluxDB 3.x** | Séries temporelles | FlightSQL |

#### 🔵 2026 T4 (oct.–déc.)

| Base de données | Type | Notes |
|---|---|---|
| **Trino / Presto** | SQL fédéré | API HTTP, l'arbre de catalogues mappe les sous-sources |
| **Apache Hive (HS2)** | SQL big-data | JDBC sur Kerberos / LDAP |
| **Neo4j** | Graphe | Bolt + Cypher, nouveau canal |
| **Couchbase** | NoSQL multi-modèle | N1QL |
| **AWS DynamoDB** | KV / document | PartiQL, canal NoSQL |
| **pgvector / Milvus / Qdrant** | Vectoriel | Visualiseur dédié aux champs vectoriels |

#### ⚪ Candidats 2027 S1

Apache IoTDB · Nebula Graph · SequoiaDB · GreatSQL · Hologres (Aliyun PG) · Lindorm (Aliyun HBase) · TDSQL-C (Tencent) · QuestDB · Apache Druid · Apache Pinot · Flink SQL Gateway · Materialize · RisingWave · Vertica · BigQuery · Athena

#### 🟣 Long terme (selon la demande)

Apache HBase · Impala · DynamoDB Streams · Cassandra CDC · visualiseurs LMDB / RocksDB · Weaviate / Chroma · ArangoDB (multi-modèle)

---

## 2. Fonctionnalités

### 2.1 Éditeur et expérience de requête

| Statut | Fonctionnalité |
|---|---|
| ✅ | Linter SQL + complétion IA en ligne |
| ✅ | Historique de requêtes avec tags + épinglage |
| ✅ | **Mode Notebook** — cellules multiples SQL / Markdown, persistées localement ; à la manière de Jupyter |
| 🟢 | **Visual Query Builder** — jointures par glisser-déposer, auto-JOIN, agrégation graphique |
| 🔵 | **Speech-to-SQL** — Whisper hors ligne → traduction IA |
| 🔵 | **Traducteur de SP entre dialectes** — Oracle PL/SQL ↔ PG PL/pgSQL ↔ DM |
| ✅ | **Éditeur de règles de linter personnalisées** — motifs interdits / règles de style définis par l'utilisateur (correspondance regex + niveau de sévérité) |
| ⚪ | Bibliothèque de snippets + synchronisation multi-appareils |

### 2.2 Grille de résultats

| Statut | Fonctionnalité |
|---|---|
| ✅ | Édition en ligne + validation DML, « Demander à l'IA » sur les erreurs, visualiseur de cellule |
| ✅ | **Diff de résultats de requête** — compare deux jeux de résultats par ligne / cellule, en marquant les éléments ajoutés / supprimés / modifiés |
| ✅ | **Masquage à l'export** — masquage activé, la copie / l'export (CSV/JSON/SQL/…) masque des colonnes entières selon les règles, en cohérence avec la grille — fini le « affiché masqué, exporté en clair » |
| 🟢 | **Vue Form** — éditeur vertical ligne par ligne pour les tables larges |
| 🟢 | **Filtre multi-valeurs (style Excel)** |
| 🔵 | **Liaison Master/Detail** — sélectionner une ligne, charger automatiquement les tables liées |
| 🔵 | **Liste déroulante de lookup FK** lors de l'édition des colonnes FK |
| ⚪ | Expansion de colonnes JOIN en direct · Pivot · Visualiseur arborescent des colonnes JSON |

### 2.3 Schéma et modélisation

| Statut | Fonctionnalité |
|---|---|
| ✅ | Génération de DDL · Diff de schéma · Mock data v1 |
| ✅ | Assistant de migration Oracle → DM |
| ✅ | **Évaluation de migration** — profilage de la source (17 catégories d'objets + métriques de risque) + notation A/B/C/D + conversion IA du PL/SQL + export Word/PDF/Excel ; conception IR en hub-and-spoke |
| ✅ | **Diagramme ER auto-disposé** — rétro-ingénierie depuis le schéma en direct, liaisons FK automatiques (enfant → parent), taille des nœuds selon le nombre de colonnes, tables PK mises en évidence, focalisation sur une table + ses voisins, export PNG / SVG |
| 🔵 | **Ingénierie directe** — éditer le diagramme ER → générer la migration |
| ✅ | **Migration inter-bases v2** — IR en hub-and-spoke : parse MySQL/Oracle/DM/SQL Server → émet PG/Oracle/DM/MySQL avec types / index / vues / FK complets ; migration de données (paramétrée par lots + incrémentale + validation) |
| ✅ | **Graphe de lignage de données** — parse le SQL → lignage au niveau table (niveau colonne sur la feuille de route) |
| ⚪ | Intégration dbt · Lignage au niveau colonne |

### 2.4 DBA / exploitation

| Statut | Fonctionnalité |
|---|---|
| ✅ | Visualiseur EXPLAIN · sparklines de requêtes lentes · Health check v1 |
| ✅ | **Killer de requêtes longues** — liste des process/sessions inter-dialectes (MySQL `information_schema.PROCESSLIST` / PG `pg_stat_activity` / MSSQL `sys.dm_exec_requests` / Oracle `v$session`) ; KILL par ligne avec confirmation `KILL` saisie sur les connexions de prod |
| 🟢 | **Détection d'index morts** + statistiques de taille |
| 🟢 | **Requête lente → réécriture automatique + suggestion d'index** |
| 🔵 | Dashboard de latence de réplication |
| ✅ | **Prédiction de tendance de croissance du stockage** — instantanés des tailles bd/tables, ajustement d'une courbe de capacité à 7/30/90 jours + alerte de plafond |
| ⚪ | Réglage du pool de connexions · Journal d'audit signé · Planificateur de sauvegardes |

### 2.5 IA

| Statut | Fonctionnalité |
|---|---|
| ✅ | Chat IA · Demander à l'IA sur les erreurs · Mock data v1 · Health check v1 |
| 🟢 | **Mock data v2** — sensible aux FK entre tables + champs sémantiques (noms, adresses, téléphones) |
| 🟢 | **Health check v2** — bibliothèque d'anti-patterns étendue à plus de 50 contrôles |
| 🔵 | **Complétion en streaming (style Cursor)** — suggestions au fil de la frappe |
| ✅ | **RAG sur schéma + docs** — schéma (tables / vues / fonctions) + docs découpés → vecteurs (/v1/embeddings compatible OpenAI) + récupération hybride BM25 (fusion RRF) + seuil de pertinence ; n'injecte que les tables pertinentes dans le contexte IA ; repli lexical en douceur en l'absence d'embeddings |
| ⚪ | Règles de masquage suggérées par l'IA · SQL → diagramme ER |

### 2.6 Collaboration / multi-appareils

| Statut | Fonctionnalité |
|---|---|
| ✅ | Multi-fenêtres · i18n en 7 langues |
| 🔵 | **Synchronisation de connexions chiffrée de bout en bout** — multi-appareils, chiffrée au repos |
| 🔵 | **Bibliothèque de requêtes d'équipe** — lecture seule / commentaire / fork |
| ⚪ | Édition web · Visualiseur mobile en lecture seule |
| 🟣 | Requêtes en binôme en temps réel (protocole Yjs) |

### 2.7 Intégrations et export

| Statut | Fonctionnalité |
|---|---|
| ✅ | Export vers CSV / Excel / JSON / SQL / Parquet / Markdown |
| ✅ | **Visualiseur de graphiques (ECharts)** — en un clic depuis la grille de résultats : lignes / barres / camembert / nuage de points ; détection automatique des colonnes numériques pour Y, non numériques pour X ; zoom + multi-séries ; rendu sur le thread principal jusqu'à 5000 lignes |
| 🔵 | **Préréglages de graphiques / dashboards** — enregistrer « cette requête → ce graphique » pour la réutiliser |
| 🔵 | **Export BI** — sources de données Metabase / Superset / PowerBI / Tableau |
| ⚪ | Endpoints mock REST / GraphQL |

### 2.8 Plugins / extensibilité

| Statut | Fonctionnalité |
|---|---|
| 🔵 | **API de plugin de pilotes tiers** |
| ⚪ | Plugins de formats d'export / plugins de thèmes |

### 2.9 Arbre de navigation / navigation de l'espace de travail

L'arbre de navigation est le point d'entrée de 95 % du travail quotidien — une vague de finitions vient d'arriver :

| Statut | Fonctionnalité |
|---|---|
| ✅ | **Multi-sélection + opérations par lot** — Ctrl/⌘+clic / Shift+plage ; DROP / TRUNCATE / déplacer vers un groupe / copier le modèle SELECT / export DDL / tests de connexion en parallèle ; le SQL par lot utilise le multi-cible natif quand c'est possible (PG `DROP TABLE a, b, c`) ou un séquentiel fail-fast ailleurs (Oracle/DM/SQLite). Refs #25 |
| ✅ | **Glisser pour redimensionner la largeur** — 200-600px, double-clic pour réinitialiser, persisté dans les réglages. Refs #17 |
| ✅ | **Filtre de BD/Schémas visibles par connexion** — pastille N/M à la DataGrip à côté du nom de la connexion ; la v2 prend en charge un filtre de schéma par base (scénario PG avec 50 schémas dans une BD). Refs #24 |
| ✅ | **Recherche locale dans l'arbre (Ctrl/⌘+F)** — filtre en direct sur les nœuds chargés, dépliage forcé des branches contenant des correspondances |
| ✅ | **Index d'objets du catalogue complet + recherche inter-arbre** — cache de catalogue plat par connexion (~5 Mo / 100k objets / scan en 10 ms) ; construction silencieuse en arrière-plan à la première recherche ; les correspondances apparaissent au-dessus de l'arbre ; couvre tables / vues / fonctions / procédures / séquences / triggers / index ; filtrage par pastille de type |
| ✅ | **Clic-pour-lier sur clé Redis** — un simple clic sur une clé Redis dans la navigation focalise l'onglet RedisPane correspondant et sélectionne la clé ; n'ouvre pas de nouvel onglet. Refs #19 |
| ✅ | **Complétude des types d'objets entre dialectes** — Oracle/DM (y compris la correction de l'object_type `CLASS` de DM pour les types), Vastbase/openGauss + toute la famille PG (vues matérialisées / procédures / types ; openGauss aussi packages / synonymes), SQL Server (fonctions / procédures / triggers / séquences / types / synonymes) |
| ✅ | **Exclusion en un clic des BD/schémas système** — un clic décoche les BD/schémas système (mysql / pg_catalog / SYS / SYSAUDITOR …) dans la configuration des BD/schémas visibles, les objets utilisateur restent intacts ; les dialectes à niveau unique (MySQL, etc.) n'affichent plus de liste déroulante de schéma inutile |
| ✅ | **Copier les infos de connexion** — clic droit sur une connexion → sous-menu « Copier les infos de connexion » : URL JDBC / JSON / multi-lignes / une ligne (;) — n'inclut jamais le mot de passe |
| ✅ | **Déplacer vers un groupe (liste combinée)** — déplacement par lot vers un groupe : choisir un groupe existant dans la liste déroulante ou saisir un nouveau nom (rogné, créé s'il n'existe pas) ; vide = retirer du groupe |
| 🟢 | **Recherche d'objets globale Cmd+Shift+P** — modale floue inter-connexions, en complément de la recherche dans l'arbre |
| 🔵 | **Persistance de l'index dans IndexedDB** — résultats à froid en millisecondes (avec marqueur d'obsolescence) |
| 🔵 | **revealObject pour tous les types** — révèle actuellement tables/vues dans l'arbre ; à étendre aux fonctions / procédures / séquences |
| ⚪ | **Opérations par lot sur les connexions sélectionnées** — ex. rapport nocturne sur toutes les connexions taguées `prod` |

---

## 3. Plateforme / ingénierie

| Statut | Élément |
|---|---|
| ✅ | Matrice de build multi-arch (macOS arm/x64 · Windows · Linux) |
| ✅ | Miroir Aliyun OSS + sélecteur de canal de mise à jour automatique |
| 🟢 | **Signature de code** — Apple Developer + Windows (via SignPath OSS) |
| 🟢 | **Rapports de crash** — Sentry auto-hébergé avec source maps |
| 🔵 | E2E Playwright + matrice CI |
| 🔵 | Intégration Codecov |
| ⚪ | AppImage / Snap / Flatpak / MS Store / MAS / tap Homebrew |

---

## 4. Docs / communauté

| Statut | Élément |
|---|---|
| ✅ | Site en 7 langues + SEO + Umami auto-hébergé |
| ✅ | Docs DBA / Schéma / NoSQL / Sécurité / IA / Productivité |
| 🟢 | **Tutoriels vidéo** (Bilibili + YouTube, < 3 min par fonctionnalité clé) |
| 🔵 | Études de cas / Site de changelog public |

---

## Jalons

| Date | Temps fort |
|---|---|
| 2026-06 | RAG sur schéma (vecteur + hybride BM25) · diagramme ER + export PNG/SVG · diff de résultats de requête · masquage à l'export · complétude des types d'objets de la navigation entre dialectes · vérification en direct du lecteur inter-dialectes (DM/Oracle/MySQL/Vastbase) |
| 2026-05 | Réglages IA → SQLite chiffré · SEO en 7 langues · Umami auto-hébergé |
| 2026-04 | Vague de pilotes ClickHouse / Snowflake / Doris / StarRocks / Redshift / H2 |
| 2026-03 | Canal NoSQL (MongoDB / Redis / Elasticsearch) · Linter SQL · IA en ligne |
| 2026-02 | Visualiseur EXPLAIN · sparklines de requêtes lentes · assistant Oracle → DM |
| 2026-01 | Première version publique (MySQL / PG / Oracle / SQL Server / DM / KingbaseES) |

---

## Participer

- Consultez [CONTRIBUTING.md](https://github.com/duhbbx/SkylerX/blob/main/CONTRIBUTING.md) pour la configuration, les tests et les règles de PR
- Nouveaux pilotes : copiez n'importe quel `packages/core-driver/src/drivers/*` comme modèle
- La feuille de route elle-même se trouve dans [ROADMAP.md](https://github.com/duhbbx/SkylerX/blob/main/ROADMAP.md) — les PR sont les bienvenues
