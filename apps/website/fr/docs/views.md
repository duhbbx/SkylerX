# Vues alternatives de résultat

L'exécution d'un SQL renvoie un jeu de résultats ; par défaut on voit la grille (voir [Grille de résultats](./grid.md)). Mais souvent la grille n'est pas la meilleure forme — pour cent lignes `(month, revenue)`, un graphique ligne est dix mille fois plus parlant qu'un tableau. SkylerX intègre dans la barre d'outils de résultat un ensemble de **vues alternatives** : les données ne sont pas re-requêtées, elles changent juste de forme en mémoire.

Cette page clarifie : **quand changer de vue, comment chaque vue calcule, quelle forme de données elle attend, ce qui peut être sauvegardé**.

## Quand changer de vue est plus parlant que la grille

| Forme de données | Vue recommandée | Cas typique |
|---|---|---|
| Une colonne catégorie + une numérique | Barres / Camembert / Anneau | Ventes par ville, erreurs par endpoint |
| Une colonne temps + une numérique (continue) | Ligne / Aire | Tendance DAU, charge CPU |
| Deux colonnes numériques (corrélation) | Nuage de points | Activité utilisateur vs rétention |
| Trois colonnes catégorie / numérique | Tableau croisé | Canal × Mois = Revenu |
| `(lat, lng)` | Nuage géographique | Distribution magasins, carte utilisateurs |
| Une colonne temps + une label | Frise chronologique | Événements de déploiement, cycle de vie commande |
| `(id, parent_id, ...)` | Arbre FK auto-référencé | Commentaires imbriqués, organigramme |
| Multiples versions d'une même ligne | Historique de ligne | Audit log retracement |

Déclencheur dans la barre du bas (`packages/ui/src/components/ResultGrid.vue:1202-1215`) :

```vue
<button :disabled="!result?.rows.length" @click="chartOpen = true">📊 Graphique</button>
<div class="menu-box">
  <button @click="showViewMenu = !showViewMenu">📐 Vues</button>
  <!-- Menu déroulant -->
  <button @click="altView = 'pivot'">⊞ Croisé</button>
  <button @click="altView = 'tree'">🌳 Arbre</button>
  <button @click="altView = 'geo'">🗺 Carte</button>
  <button @click="altView = 'timeline'">⏱ Chronologie</button>
</div>
```

Toutes ces vues s'ouvrent en modal, ferment → retour à la grille — elles sont la "loupe" de la grille, pas son remplacement.

## 1. Vue Graphique (barres / ligne / camembert + 4 extensions)

`packages/ui/src/components/ChartDialog.vue`, **630 lignes**, bouton : **📊 Graphique**.

### Choix de conception

Le commentaire du code est franc :

> Pas d'ECharts, on dessine du SVG à la main (barres / ligne + camembert ~ une centaine de lignes chacun), pourquoi :
> - Taille du bundle desktop sensible ; les graphiques sont juste un "petit outil" du result grid, pas la scène principale
> - 3 types couvrent 90% des cas de visualisation ponctuelle ; pour plus fancy, ECharts plus tard
> - SVG facile à exporter en PNG (toDataURL via `<canvas>`)

7 types de graphiques, tous en SVG manuel :

| Type | Convient | Limite | Note |
|---|---|---|---|
| 📊 Barres | Comparaison catégorie / numérique | 50 premières lignes | Limite Y auto-arrondie |
| 📈 Ligne | Tendance / time series | 200 premières lignes | Chemin `M / L` |
| 🥧 Camembert | Proportions | 50 premières lignes | Étiquettes % auto |
| ⛰ Aire | Tendance + magnitude | 200 premières lignes | Ligne fermée vers baseline |
| ·· Nuage de points | Points dispersés | 200 premières lignes | Points ronds |
| ⭕ Anneau | Variante proportions | 50 premières lignes | Externe `r * 1.0`, interne `r * 0.55` |
| 📡 Radar | Multi-dimensions | 50 premières lignes, ≥ 3 points | Un axe par ligne |

### Sélection de colonnes

3 sélecteurs en haut : **Label** (toute colonne, `.toString()`), **Value** (auto-détection numérique, colonnes non-numériques marquées `(?)`), **Type**. `isNumericColumn` prend les 20 premières lignes pour `Number.isFinite(Number(v))`, Y par défaut = première colonne numérique. Au changement de résultat, `watch` réinitialise la sélection.

Règles de données : lignes `Number(v)` → NaN sont skippées, limite atteinte → tronquage (barres / cam. 50, ligne / aire / nuage 200, radar 50).

### Axe Y

Pour des graduations "rondes", la borne sup utilise `Math.ceil(m / 10^floor(log10(m))) * 10^floor(log10(m))`. Format des nombres : `B / M / k` (au-dessus de 1e9 / 1e6 / 1e4).

### Sortie : export PNG

Bouton `⬇ Exporter PNG` en haut à droite → `XMLSerializer` sérialise le SVG → dessin `<canvas>` HiDPI 2× (fond sombre `#1d1e22`) → `canvas.toBlob('image/png')` → `SaveFileDialog` personnalisé. Nom de fichier `chart-{kind}-{ts}.png`, résolution 1440×720, parfait pour Feishu / Slack.

## 2. Tableau croisé (PivotDialog)

`packages/ui/src/components/PivotDialog.vue`, 162 lignes. Déclencheur : **📐 Vues → ⊞ Croisé**.

Rôle : **pivot en mémoire** sur le résultat courant, pas de re-requête. Algorithme simple — lignes groupées par `(rowFields...)` → bucketing par `colField` → agrégation `agg` par bucket.

### 3 axes + 1 fonction d'agrégation

| Contrôle | Action |
|---|---|
| **Lignes** (chips multi) | Groupage par ces colonnes, clé `'\|'` |
| **Colonnes** (dropdown) | Toutes les valeurs distinctes de cette colonne deviennent les en-têtes (ordre lexicographique) |
| **Valeur** + agrégation | Pour chaque (row, col), agrégation sur cette colonne |
| Dropdown agrégation | `COUNT / SUM / AVG / MIN / MAX` |

### Algorithme

Nested `Map<rowKey, Map<colKey, number[]>>` : parcours unique de `result.rows`, `rowKey` = champs `rowFields` joints par `|`, `colKey` = valeur string de `colField`, `Number(row[valueField])` poussé dans le tableau. `NULL` uniformément `'NULL'` (regroupement). COUNT par `length`, autres par agrégation numérique.

### Limites

Le commentaire du code est direct :

> Non supportés : plusieurs value fields, ordre custom des colonnes (lexicographique), filtre ; à compléter prochainement.

Donc : tri par mois "1-12 et non 10, 11, 12, 1, 2..." pas possible pour l'instant — il faut zero-padder en SQL d'abord (`'01' / '02' / ...`).

### Sortie

Juste une vue tableau temporaire, pas d'export direct. Pour persister :

- Fermer le croisé → retour grille → clic droit copier → CSV / Markdown pour coller dans Excel / Notion
- Réécrire la logique pivot en SQL : MySQL `GROUP BY x WITH ROLLUP` / PG `crosstab()`

## 3. Nuage de points géographique (GeoMapDialog)

`packages/ui/src/components/GeoMapDialog.vue`, 138 lignes. Déclencheur : **📐 Vues → 🗺 Carte**.

Pas de leaflet / pas de fond de carte, juste un nuage SVG `(lng, lat)`. Commentaire du code :

> Projection : équidistante équirectangulaire (Mercator faible distorsion visuelle, pour données locales le tracé direct en lat/lng suffit, pas de SR complexe).
> Pas fait : fond de carte (pas de tiles), clustering (points denses se chevauchent mais zoom/pan résout).

### Détection auto des colonnes

```ts
latCol = cols.find(c => /^(lat|latitude|y)$/i.test(c)) ?? cols[0]
lngCol = cols.find(c => /^(lng|lon|long|longitude|x)$/i.test(c)) ?? cols[1]
labelCol = cols.find(c => /^(name|title|label|id)$/i.test(c)) ?? ''
```

Filtre de validité numérique (anti-déchets) :

```ts
if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue
```

### Cadrage auto

Pas de planisphère, le bounds calcule "juste englobant tous les points + 5% de marge" :

```ts
const dx = Math.max(0.001, (maxX - minX) * 0.05)
return { minX: minX - dx, maxX: maxX + dx, ... }
```

Les coordonnées des 4 coins s'affichent sur les bords du SVG, le survol d'un point montre `lat=... lng=...`.

### Sortie

Visuel seul, pas d'export PNG (à venir). Pour visualisation persistante, sortez une colonne catégorie en SQL et utilisez la vue Graphique (Nuage).

### Forme de données attendue

| Noms de colonnes compatibles | Exemple |
|---|---|
| `lat`, `latitude`, `y` | `latitude FLOAT` |
| `lng`, `lon`, `long`, `longitude`, `x` | `lng DECIMAL(9,6)` |
| `name`, `title`, `label`, `id` (label, optionnel) | `store_name VARCHAR` |

Si les noms sont hors standard, sélection manuelle dans le dropdown, tant que les valeurs sont numériques et dans la plage.

## 4. Frise chronologique (TimelineDialog)

`packages/ui/src/components/TimelineDialog.vue`, 171 lignes. Déclencheur : **📐 Vues → ⏱ Chronologie**.

### Détection auto des colonnes

```ts
timeCol = cols.find(c => /at$|_time$|date|time|created|updated/i.test(c)) ?? cols[0]
labelCol = cols.find(c => /^(name|title|label|id|user|action)$/i.test(c)) ?? ''
colorCol = ''   // optionnel : coloration par cette colonne
```

Couvre `created_at / updated_at / event_time / order_date / login_time` etc.

### Parsing temporel (`toMs`)

Quatre formats acceptés :

```ts
function toMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000   // heuristique ms ou s
  const ms = Date.parse(String(v))  // ISO / "YYYY-MM-DD HH:MM:SS"
  return Number.isNaN(ms) ? null : ms
}
```

> Numérique < 1e12 (année 2001) traité comme Unix secondes × 1000 ; au-dessus comme ms. Suffisant pour le métier, rares timestamps pré-1969 mal classés — convertir en chaîne via `to_char(...)` en SQL si nécessaire.

### Rendu

Frise horizontale, points alternés verticalement pour éviter le chevauchement (`i % 2 === 0 ? -16 : +16`), axe X 5 graduations dates.

Si la colonne **color** est spécifiée, palette de 8 couleurs cyclique (`#7c6cff / #4caf50 / #e0a020 / #e04050 / #3aa1ff / #b48cff / #67c23a / #ff9966`), légende en bas. Survol d'un point : barre d'info bas `temps · label`.

### Forme de données attendue

Au moins une colonne temporelle (Date / ISO / Unix s ou ms). Label / Color optionnels.

## 5. Arbre FK auto-référencé (TreeViewDialog)

`packages/ui/src/components/TreeViewDialog.vue`, 130 lignes. Déclencheur : **📐 Vues → 🌳 Arbre**.

Adapté aux **FK auto-référencées** ou hiérarchies : commentaires imbriqués (`comments.parent_id → comments.id`), organigramme (`departments.parent_dept_id → id`), régions (`regions.parent_id`).

### Trois axes

| Sélecteur | Règle de déduction |
|---|---|
| **id** | Priorité `/^id$/i`, sinon première colonne |
| **parent** | Match `/parent[_-]?id\|pid/i`, vide par défaut |
| **label** | Match `/^(name\|title\|label)$/i`, sinon fallback id |

### Algorithme

Deux passes : 1ère pour indexer par id (`byId: Map<id, node>`), 2ème pour rattacher les enfants. Parent id non indexé (NULL inclus) = racine. `parent === self` = racine (anti-`WHERE id=1 AND parent_id=1`).

### Détection de cycle

`walk(n, depth)` DFS avec `Set<string>` des visités ; re-rencontre = `n.cycle = true` + stop. Le nœud affiche un `⚠` jaune, survol = "Cycle". Courant après modification erronée par un opérateur.

### Rendu

Flatten avec indentation `depth * 18px`, chaque nœud `▸ <label> #<id>`. Survol du label : `title="{json}"` pour voir la ligne complète (vérif visuelle rapide).

### Forme de données attendue

Au moins id + parent ; `SELECT id, parent_id, name FROM comments WHERE post_id = 1234` ramène tout l'arbre en une fois, la vue rend la hiérarchie automatiquement.

## 6. Historique de ligne (RowHistoryDialog)

`packages/ui/src/components/RowHistoryDialog.vue`, 123 lignes.

Rôle : **traçabilité d'une ligne** — pour une PK donnée d'une table, trouver toutes les versions dans la table shadow `audit / *_history / *_log`.

### Détection auto de la table shadow

À l'ouverture, `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '{base}_%' OR table_name = 'audit_{base}' OR table_name = '{base}_history'`, candidats dans `<datalist>`, sélection ou saisie manuelle.

### Requête historique

Une fois la shadow choisie, requête par PK : `SELECT * FROM {shadow} WHERE {pk}=... ORDER BY changed_at, updated_at, created_at, version, revision DESC LIMIT 200`. ORDER BY liste 5 candidats, la DB utilise la colonne présente (MySQL tolérant / PG strict, les audit courants ont au moins une).

### Forme de données attendue

Table métier + table shadow `*_history` / `*_audit` / `*_log` (PK + colonnes métier répliquées + `changed_at / version`). Les triggers d'audit courants respectent ce contrat.

> Note d'implémentation : ce dialogue est codé dans le repo (`Workspace.vue` a `rowHistOpen` et le mount modal), mais sans entrée directe depuis la grille pour l'instant — réservé à un futur menu contextuel.

## 7. Data lineage (LineageDialog) — version heuristique

`packages/ui/src/components/LineageDialog.vue`, 98 lignes.

Le commentaire du code est explicite :

> Lineage de colonnes (version heuristique) : pas encore de vrai SQL parser, juste la plus simple heuristique — match « `{table}.{column}` » ou bare `{column}` (sous condition que `{table}` soit dans FROM) dans l'historique SQL.
> Précision limitée : ratés (alias / sous-requêtes), faux positifs (colonnes homonymes). Clairement annoncé "heuristic" en attendant un parser SQL.

### Algorithme

Charge les 500 dernières requêtes SQL de la connexion courante, match `\b{table}\b` + `\b{column}\b` (deux regex word-boundary) sur chaque. Selon le préfixe : `INSERT / UPDATE` → sinks (écriture), `SELECT / WITH` → sources (lecture).

### Rendu

Deux colonnes :

- **← Sinks** — SQL qui **écrit** cette colonne (INSERT / UPDATE)
- **→ Sources** — SQL qui **lit** cette colonne (SELECT / WITH)

Chaque ligne : timestamp + 120 premiers caractères du SQL. Bandeau jaune en haut : "résultat heuristique, ne pas utiliser comme preuve d'audit".

### Forme de données attendue

Dépend de **l'historique de requêtes** (`client.connections.history`). Sans historique pertinent dans SkylerX, la fenêtre affichera "No hits".

> Note d'implémentation : comme RowHistoryDialog, monté dans `Workspace.vue` et déclenché de l'extérieur (`lineageOpen.value = {...}`), sans entrée UI dédiée pour l'instant, API réservée.

## Matrice de support

| Vue | Détection auto | Limite données | Export statique | Re-requête SQL | Convient à |
|---|---|---|---|---|---|
| Graphique (7 types) | Détection numérique | 50 / 200 lignes | PNG (HiDPI 2×) | Non | Magnitude / tendance / proportions |
| Tableau croisé | 1ère/2ème/3ème colonne | Limité par RAM navigateur | Copier en CSV | Non | Agrégation cross 2 axes |
| Nuage géo | Alias `lat / lng / x / y` | Illimité | Non | Non | Tracé direct lat/lng |
| Chronologie | Suffixes `at$ / time / date / created` | Illimité | Non | Non | Flux d'événements + couleurs |
| Arbre | `id / parent_id / name` | Illimité | Non | Non | Hiérarchie FK auto-référencée |
| Hist ligne | Nom table `*_history / *_audit` | 200 lignes (SQL LIMIT) | Non | ✓ (audit table) | Traçabilité d'une ligne |
| Lineage | — | 500 dernières du log | Non | Non | Relation lecture/écriture par colonne (heuristique) |

## Déclencheurs

| Vue | Entrée | Note |
|---|---|---|
| Graphique | Barre `📊 Graphique` | Ouvre directement barres par défaut |
| Croisé / Arbre / Carte / Chronologie | Barre `📐 Vues → menu` | Même modal, état `altView` partagé |
| Hist ligne | Via `rowHistOpen.value = { conn, table, pk }` | Réservé, en attente de menu contextuel |
| Lineage | Via `lineageOpen.value = { conn, table, column }` | Réservé, en attente de menu contextuel |

Toutes les modals ferment et reviennent à la grille originale, sans perte de pagination / tri — elles ne sont qu'une "loupe" sur la grille, sans remplacer le résultat.

## Petit arbre de décision pour choisir une vue

Vous voulez **magnitude / classement / tendance / proportions** ? → Graphique
- Magnitude vs temps → Ligne / Aire
- Classement par catégorie → Barres
- Proportions → Camembert / Anneau
- Multi-dimensions → Radar

**Croisement 2 axes** (ex. "canal × mois") → Croisé

Données contiennent **`(lat, lng)`** → Carte

Données avec **colonne temporelle** :
- Valeurs continues (DAU jour par jour) → Ligne
- Événements discrets (déploiements, alertes) → Chronologie

Données **auto-référencées par FK** → Arbre

Voir **historique de modifications d'une ligne** → Hist ligne

Voir **qui lit / écrit cette colonne** → Lineage (heuristique, à utiliser avec prudence)

Toutes les vues alternatives au niveau résultat sont couvertes. Si votre forme de données n'entre dans aucune, 90% du temps une réécriture SQL la rendra exploitable par une de ces vues — sinon, retour grille et copie vers Excel / Numbers / Notion.

Pour voir l'exécution du SQL lui-même (slow log, Explain, recommandation d'index), voir [Avancé et ingénierie](./advanced.md) ; pour import/export, voir [Migration de données](./databases.md).
