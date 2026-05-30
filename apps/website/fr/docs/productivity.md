# Outils de productivité

SkylerX raccroche toutes les "actions DBA / backend de fréquence 30 s à 30 min" aux trois grands axes **clavier / palette de commandes / notifications**, dans le but de réduire les clics et les changements de fenêtre. Cette page liste les outils par "ce qu'on utilise le plus", chacun documenté avec faits de code et fichiers sources.

## 1. Vue d'ensemble

| Outil | Entrée | Problème résolu |
|---|---|---|
| Palette de commandes ⌘K | Global / `Settings → Raccourcis` | Tout est cherchable d'ici → on saute la navigation menu |
| Recherche globale d'objets ⌘⇧O | Global | Recherche fuzzy table / vue / colonne cross-bases → un clic vers l'arborescence |
| Bibliothèque de snippets SQL | Tiroir à droite de l'éditeur / `★` | Réutiliser les requêtes, templates `{{var}}` |
| Historique des requêtes | Tiroir à droite de l'éditeur | Tri par temps / durée, slow query en rouge |
| Favoris | ⌘K → "Favoris" / Barre d'outils | Accès rapide table / vue / requête |
| Raccourcis personnalisés | `Settings → Raccourcis` | 12 commandes rebindables + détection de conflit |
| Dashboard | ⌘K → "Dashboard" | Multiples SQL / cartes "tableau du jour" |
| Notifications webhook | `Settings → Notifications` | DingTalk / Feishu / Slack / générique, slow query + erreur |
| Multi-fenêtres ⌘⇧N | Fichier → Nouvelle fenêtre | Une seule app, deux sessions indépendantes (local↔local / local↔remote) |

---

## 2. Palette de commandes ⌘K

Code : `packages/ui/src/components/CommandPalette.vue` + `packages/ui/src/Workspace.vue` (projet source / routage)

Appuyez ⌘K (mac) / Ctrl+K (Win/Linux) → barre de recherche flottante → mot-clé → ↑↓ → Enter. Esc pour fermer.

### Mécanisme de recherche

```ts
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q
    ? props.items.filter((it) => `${it.label} ${it.hint ?? ''}`.toLowerCase().includes(q))
    : props.items
})
```

- Match label + hint (le hint d'une connexion est le dialecte), pure substring includes, **pas de pinyin / ordre flou** (la vitesse de frappe prime sur le flou)
- Max 50 entrées affichées (anti-lag)

### Liste des commandes intégrées

Voici l'intégralité du computed `paletteItems` de `Workspace.vue` (actions + actions par connexion + entrées de connexion) :

| ID global | Label | Chemin équivalent |
|---|---|---|
| `act:new-conn` | Nouvelle connexion | Barre + |
| `act:object-search` | Recherche globale d'objets | ⌘⇧O |
| `act:schema-diff` | Schema diff | Outils → Schema diff |
| `act:data-diff` | Data diff | Outils → Data diff |
| `act:privileges` | Privilèges | Clic droit connexion → Privilèges |
| `act:settings` | Settings | ⌘, |
| `act:export-conns` / `act:import-conns` | Importer / exporter connexions | Menu fichier |
| `act:refresh` | Rafraîchir l'arbre | F5 |
| `act:favorites` | Favoris | Barre ⭐ |
| `act:oplog` | Journal d'opérations | Barre |
| `act:monitor` | Monitoring | Barre |
| `act:dashboard` | Dashboard | Outils → Dashboard |
| `act:ndjson-viewer` | Visualiseur NDJSON | Barre |
| `act:contracts` | Data contracts | Outils → Data contracts |
| `act:o2dm` | Assistant Oracle → DM | Barre |
| `act:translate` | Traduction SQL (inter-dialectes) | Barre |
| `act:notif` | Notifications webhook | `Settings → Notifications` |
| `act:keybind` | Raccourcis personnalisés | `Settings → Raccourcis` |
| `act:drift` | Détection de dérive | Barre |
| `act:ai-chat` / `act:ai` / `act:ai-toolbox` | AI chat / AI assistant / AI toolbox | ⌘⇧L |
| `act:about` / `act:shortcuts` | À propos / Référence raccourcis | Menu Aide |
| `act:new-window` | Nouvelle fenêtre (desktop seul) | ⌘⇧N |

### Actions par connexion

Les actions suivantes s'éclatent en une ligne par connexion existante, suffixe `· nom_connexion · dialecte` :

| Préfixe ID | Sens |
|---|---|
| `act:activity:` | Activité serveur (processlist / pg_stat_activity) |
| `act:obtopo:` | Topologie cluster OceanBase (visible si OB) |
| `act:snapshots:` / `act:backup:` | Snapshots schema / sauvegarde restauration |
| `act:health:` / `act:vqd:` | Health Check IA / constructeur visuel de requête |
| `act:slowq:` / `act:idxrec:` / `act:repl:` | Slow query / recommandation d'index / lag de réplication |
| `act:compliance:` / `act:search-value:` | Conformité / recherche inter-tables |
| `act:aicmt:` | Commentaires IA |
| Préfixe `conn:` | Ouvrir directement la connexion (groupe "Connexions") |

> Workspace de 5 connexions → 80+ commandes dans la palette ; tag group + substring includes, 3-4 caractères suffisent.

### Extensibilité

Le code est centralisé dans `paletteItems`. Pour ajouter : 1) un `{ id, label, group }` au tableau, 2) `else if (item.id === ...)` dans `onPaletteSelect()`. Pour "éclater par connexion", voir `act:compliance:` : `.map(c => ({ id: \`act:xxx:${c.id}\`, ... }))`, parse via `item.id.startsWith()`.

---

## 3. Recherche globale d'objets ⌘⇧O

Code : `packages/ui/src/components/ObjectSearchDialog.vue`

⌘⇧O (mac) / Ctrl+Shift+O (Win/Linux) ouvre un dialogue, **recherche fuzzy cross-bases / schemas dans la connexion sélectionnée** (tables, vues, colonnes).

### SQL de recherche

Via `information_schema`, deux SQL famille MySQL / PG :

| Famille | Schemas exclus | Échappement |
|---|---|---|
| MySQL | `mysql / information_schema / performance_schema / sys` | `LIKE '%term%'`, échappement 3 caractères `%_\\` |
| PG | `pg_catalog / information_schema` | `ILIKE '%term%'` |
| Autres | — | Non supporté, suggère recherche manuelle |

100 hits max par catégorie (tables / vues / colonnes), debounce 280ms.

### Comportement des résultats

- **Clic ligne = reveal** : émet `reveal`, Workspace localise et sélectionne l'objet dans l'arbre (déploie au besoin)
- **Bouton "Aperçu" au hover** : émet `preview`, ouvre directement `SELECT * FROM schema.table LIMIT 200` (quote du dialecte)
- **Icônes** : `▦` table / `◫` vue / `·` colonne

### Sécurité concurrente

Chaque saisie incrémente `seq` ; seul le résultat "le plus récent" est commit, anti-écrasement par ancienne réponse.

---

## 4. Bibliothèque de snippets SQL

Code : `packages/ui/src/snippets.ts` + `packages/ui/src/components/SnippetsPanel.vue`

### Structure de données

```ts
interface Snippet {
  id: string        // `${timestamp}-${rand5}`
  name: string      // libre, vide → 40 premiers caractères du SQL
  sql: string
  tags?: string[]   // catégories, filtrable par # dans l'UI
  dialects?: DbDialect[]  // limite par dialecte, vide = universel
  createdAt: number
}
```

Stockage `localStorage.skylerx.snippets`, Vue `reactive` + `watch deep` persiste en temps réel.

### Ajouter / supprimer

- Clic droit dans l'éditeur SQL → "Enregistrer comme snippet" ou barre `★`
- Bouton `★` sur une ligne d'historique → snippet direct
- `Settings → Éditeur → Save snippet` par défaut ⌘S (configurable)

### Placeholders

Les `{{var}}` du snippet font popup à l'insertion :

```sql
SELECT * FROM {{table}} WHERE id = {{id}}
```

`applySnippetVars()` extrait dans l'ordre d'apparition, popup une par une ; annulation à tout moment = abandon complet, pas d'insertion partielle.

### Filtrage par dialecte

`snippetsForDialect(dialect)` filtre dans le panneau par le dialecte de la connexion courante :

- `dialects = []` ou non défini → visible partout ("universel")
- `dialects = [MySQL, MariaDB]` → seulement sur MySQL / MariaDB

Évite de voir une syntaxe MySQL spécifique dans une connexion PG.

### Interaction panneau

| Action | Effet |
|---|---|
| Barre de recherche | Filtre substring sur name + SQL + tags |
| Tag `#xxx` clic | Filtre par tag ; clic à nouveau = annule |
| Double-clic snippet | Applique les placeholders puis insère |
| `×` | Supprime (sans confirmation) |

---

## 5. Historique des requêtes

Code : `packages/ui/src/components/HistoryPanel.vue`

Chaque exécution (succès ou échec) écrit dans le SQLite local : `sql / executedAt / durationMs / success / pinned / tags / note`.

### Tri + filtre

| Contrôle | Description |
|---|---|
| Barre de recherche | Substring sur sql + tags + note |
| Dropdown tri | `Par temps desc` (défaut) / `Par durée desc` |
| `≥ N ms` | Filtre slow query, ligne entière rouge si dépasse (défaut 500ms) |
| `📌` | Seulement épinglés |
| `Vider` | Vider toute la table en un clic |

Les épinglés sont toujours en haut (`pinned: 1` force le haut), les autres selon le tri.

### Actions par ligne

| Bouton | Action |
|---|---|
| `📌` | Toggle épinglage |
| `🏷` | Modifier tags (CSV : `daily,prod,join`) |
| `📝` | Modifier note (texte libre) |
| `★` | Enregistrer comme snippet (émet `saveSnippet`) |
| Double-clic | Recharge le SQL dans l'éditeur courant |

Toutes les modifs de métadonnées passent par `client.connections.historyMeta(id, patch)` → SQLite, pas localStorage.

### Lien avec notifications slow query

`Settings → Notifications → Triggers globaux → Seuil slow query (ms)` (`settings.slowQueryNotifyMs`). Mis à non-zéro, toute exécution dépassant le seuil déclenche `notify('slow-query', ...)` → canal webhook correspondant.

---

## 6. Favoris

Code : `packages/ui/src/favorites.ts`

Trois `kind` possibles :

| kind | Sens | Action au clic |
|---|---|---|
| `table` | Table | reveal dans l'arbre + aperçu 200 premières lignes |
| `view` | Vue | Idem |
| `query` | SQL custom | Charger dans onglet courant / nouveau brouillon |

### Règle de clé primaire

- Objets : `${connId}|${sqlName}`, un seul favori par objet/connexion, second clic = annule
- Requêtes : `q|${connId}|${createdAt}|${rand4}`, plusieurs favoris du même SQL possibles (scénario : "snapshots à divers moments")

### Tags de groupement

`setFavoriteTag(id, tag)` attache un tag à un favori, panneau plié par tag. Un seul tag par favori, simple et suffisant.

### Persistance

`localStorage.skylerx.favorites`, reactive + watch deep.

### Favori rapide depuis l'historique

`addQueryFavorite({ connId, connName, dialect, name, sql, tags })` pour le scénario "j'ai exécuté ça, ça vaut la peine de garder". `★` du HistoryPanel = snippet, "Favori requête courante" de la barre = cette fonction.

---

## 7. Raccourcis personnalisés (K1)

Code : `packages/ui/src/keybindings.ts` + `packages/ui/src/components/KeyBindingsDialog.vue`

Entrée : `Settings → Raccourcis` / palette → "Raccourcis personnalisés".

### 12 commandes rebindables

| ID | Chord par défaut | Usage |
|---|---|---|
| `run-sql` | `CmdOrCtrl+Enter` | Exécuter SQL |
| `palette` | `CmdOrCtrl+K` | Palette de commandes |
| `object-search` | `CmdOrCtrl+Shift+O` | Recherche globale d'objets |
| `ai-chat` | `CmdOrCtrl+Shift+L` | Toggle panneau AI chat |
| `new-conn` | `CmdOrCtrl+N` | Nouvelle connexion |
| `new-query` | `CmdOrCtrl+T` | Nouvelle requête |
| `close-tab` | `CmdOrCtrl+W` | Fermer onglet |
| `find` | `CmdOrCtrl+F` | Rechercher dans l'éditeur |
| `replace` | `CmdOrCtrl+H` | Remplacer dans l'éditeur |
| `format-sql` | `CmdOrCtrl+Shift+F` | Formater SQL |
| `save-snippet` | `CmdOrCtrl+S` | Sauver SQL courant en snippet |
| `settings` | `CmdOrCtrl+,` | Settings |

### Convention de rendu `CmdOrCtrl`

| Plateforme | `CmdOrCtrl+Shift+K` affiché |
|---|---|
| macOS | `⌘⇧K` (style menu système, sans `+`) |
| Windows / Linux | `Ctrl+Shift+K` |

Stockage uniforme en `CmdOrCtrl+...` (OS-agnostique), rendu plateforme par `formatChord()`.

### Flux d'enregistrement

1. Clic "Enregistrer" sur une ligne → état d'enregistrement, un `input` invisible (`position: absolute; left: -9999px`) prend le focus clavier
2. Écoute `keydown`, `chordFromEvent(e)` parse la combinaison :
   - Ordre des modificateurs fixe : `CmdOrCtrl → Shift → Alt` (garantit l'équivalence string ↔ chord)
   - Lettre unique en majuscules, espace = `Space`, autres `Enter` / `,` / `ArrowUp` tels quels
   - Modificateur seul (Shift sans touche principale) = chaîne vide
3. Enter pour valider / Esc pour annuler / Backspace sur draft vide = "désactiver cette commande" (chaîne vide en stockage)

### Détection de conflit

`conflicts` computed scanne les bindings fusionnés (avec `draftChord`), détecte deux commandes sur le même chord → fin de ligne en rouge "En conflit avec XX", visible immédiatement.

### Stockage + "Restaurer par défaut"

Seules les entrées "différentes du défaut" sont écrites dans `settings.keyBindings` (`Record<string, string>`).

- Retour au défaut → suppression auto du override, stockage minimal
- "Tout restaurer" → vide `settings.keyBindings` + double confirmation
- "Désactiver une commande" = écrire chaîne vide, **clé préservée** mais valeur `''`

---

## 8. Dashboard — Multi SQL multi-cartes

Code : `packages/ui/src/components/DashboardDialog.vue`

Entrée : menu Outils → Dashboard / ⌘K → "Dashboard".

### Structure de carte

```ts
interface Card {
  id: string
  title: string
  connId: string
  sql: string
  lastRunAt?: number
  lastResult?: QueryResult | null
  lastError?: string | null
}
```

- Persisté dans `localStorage.skylerx.dashboard.cards`, **sans `lastResult`** (potentiellement gros), réinitialisé à l'ouverture
- Chaque carte affiche titre + nom connexion + aperçu SQL (200 chars) + 5 premières lignes (60 chars)

### Opérations

| Bouton | Action |
|---|---|
| `+ Ajouter une carte` | Mini formulaire : titre + connexion + SQL (textarea 4 lignes) |
| `↻ Tout rafraîchir` | `Promise.all(cards.map(runCard))` parallèle |
| `↻` carte | Rafraîchit une carte |
| `✎` carte | Entre en édition |
| `×` carte | Supprime (confirmation) |

### Volontairement non fait

- **Pas de rafraîchissement automatique** : risque d'oubli et de pression en arrière-plan, ↻ manuel suffit
- **Pas de graphique** : "→ aller à ChartDialog" est un chemin "voir à la demande" plus clair
- **Pas de partage / collaboration** : pas avant v0.5, anti-dépendance cloud

---

## 9. Notifications webhook

Code : `packages/ui/src/notifications.ts` + `packages/ui/src/components/NotificationSettingsDialog.vue`

Entrée : `Settings → Notifications` / ⌘K → "Notifications webhook".

### 4 canaux

| Canal | Forme URL | Signature |
|---|---|---|
| `dingtalk` | webhook robot DingTalk | HMAC-SHA256(`ts\n${secret}`, key=`secret`), query `?timestamp=&sign=urlencoded(...)` |
| `feishu` | webhook robot Feishu | HMAC-SHA256(data vide, key=`ts\n${secret}`), sign dans le body |
| `slack` | Slack incoming webhook | Pas de signature (URL = credentials) |
| `webhook` | POST JSON générique | Sans signature, à parser côté serveur |

Signature via `globalThis.crypto.subtle` HMAC-SHA256, **sans dépendance tierce**.

### 3 événements déclencheurs

| Event | Déclenchement |
|---|---|
| `query-error` | Échec d'exécution SQL |
| `slow-query` | Durée ≥ `settings.slowQueryNotifyMs` (0 = off) |
| `manual` | Clic "Test" / "Notifier" barre |

Chaque config peut souscrire indépendamment aux 3 (`subscribe: NotifEvent[]`).

### Configuration

```ts
interface NotifConfig {
  id: string
  name: string
  channel: 'dingtalk' | 'feishu' | 'slack' | 'webhook'
  webhookUrl: string
  secret?: string           // Secret de signature DingTalk/Feishu (optionnel)
  enabled: boolean
  subscribe: NotifEvent[]
}
```

Stockage `localStorage.skylerx.notifications`, séparé de `settings` (volume élevé et changements fréquents, anti-bruit).

### Test d'envoi

`Settings → Notifications` → sélectionner config → "Tester". Conditions :

- `enabled === true`
- `webhookUrl` non vide
- `subscribe.includes('manual')` (le test utilise `notify('manual', ...)`)

Non-conformité → toast informatif, pas d'envoi.

### Envoi non bloquant

`notify(event, payload)` fire-and-forget :

```ts
await Promise.all(targets.map(async (c) => {
  try { await dispatchOne(c, payload) }
  catch (e) { console.warn(`[notify] ${c.channel}/${c.name} failed:`, e) }
}))
```

Tout échec individuel avalé, warn en console. **Les notifs sont auxiliaires, ne doivent pas freiner le flux principal**.

### Proxy fetch desktop

Desktop Electron passe par `globalThis.api.ai.fetch` IPC (contourne CORS) ; web fallback `fetch` natif.

---

## 10. Structure du menu application

Code : `apps/desktop/src/main/menu.ts`

7 menus top-level (référence DataGrip / Navicat) :

| Menu | Items principaux |
|---|---|
| **SkylerX** (mac seul) | À propos / Settings ⌘, / Vérifier mises à jour / Services / Masquer / Quitter |
| **Fichier** | Nouvelle connexion ⌘N / Nouvelle requête ⌘T / Ouvrir SQL ⌘O / Import · Export connexions / Backup · Restore / Fermer onglet ⌘W |
| **Édition** | Rôle système (Annuler / Refaire / Couper / Copier / Coller / Tout sélectionner) + Rechercher ⌘F / Remplacer ⌘H / Formater SQL ⌘⇧F |
| **Vue** | Palette ⌘K / Recherche d'objets ⌘⇧O / Toggle AI chat ⌘⇧L / Favoris / Journal d'opérations / Zoom / Plein écran / DevTools |
| **Outils** | Activité serveur / Backup restore / Transfert / Schema diff / Data diff / Snapshots / Dashboard / Recherche inter-tables / Data contracts / AI toolbox / AI assistant |
| **Fenêtre** | Nouvelle fenêtre ⌘⇧N / Réduire / Recharger / (mac) Mettre toutes les fenêtres au premier plan |
| **Aide** | À propos / Référence raccourcis / Repo GitHub / Signaler un problème / Vérifier mises à jour |

### Détail d'implémentation

Les items custom **n'exécutent pas la logique métier dans le main process** (pas d'accès à l'état Vue), tous routent via `webContents.send('menu:command', '<key>')` vers le renderer. Le renderer dans `Workspace.vue` s'abonne via `window.api.menu.onCommand(key => ...)`, route vers `onPaletteSelect` du paletteItem correspondant.

---

## 11. Vue d'ensemble des Settings

Code : `packages/ui/src/components/SettingsDialog.vue`

Le dialogue Settings : 5 catégories à gauche, formulaire dynamique à droite.

| Catégorie | Items principaux |
|---|---|
| **Général** ⚙ | Langue (中 / EN), Thème (sombre / clair), Zoom UI (70% - 200%), Mode commit par défaut (auto / manual), Tri NavTree par fréquence, **Activation masquage + édition règles** |
| **Éditeur** ⌨ | Taille police, indentation, wrap, autocomplétion, casse mots-clés (upper / lower / preserve) |
| **Grille** ▦ | Taille page par défaut (50 / 100 / 200 / 500 / 1000), texte d'affichage NULL |
| **Filigrane prod** ⚠ | Texte, transparence (0.04 - 0.5), angle (-90° - 90°), taille, couleur ; aperçu temps réel |
| **Assistant IA** ✨ | Provider (Anthropic / OpenAI / DeepSeek / Codex / Grok), API Key / Model / Base URL, mémoire et profil (A texte libre / B faits structurés / C mémoire vectorielle) |

> **Liés au thème** : `Settings → Général → Thème` bascule sombre / clair, affecte tous les panneaux. Sombre par défaut (`appearance: 'dark'` dans VitePress / Electron CSS variables).

### Les 3 couches "Mémoire IA"

| Couche | Champ | Sens |
|---|---|---|
| A | `aiCustomInstructions` | Profil texte libre, system prompt à chaque conversation |
| B | `aiFacts[]` + `aiAutoExtractFacts` | Liste de faits structurés, manuel / auto |
| C | `aiVectorMemory` + embedding 3 éléments + `aiVectorTopK` | Mémoire vectorielle, rappel sémantique cross-session |

`Restaurer par défaut` en bas reset tous les settings avec double confirmation.

---

## 12. Multi-fenêtres ⌘⇧N

Code : `apps/desktop/src/main/index.ts` `spawnExtraWindow()` + IPC `window:newSession`

⌘⇧N (mac) / Ctrl+Shift+N (Win/Linux) ouvre une BrowserWindow neuve (1100 × 750), même URL renderer, **session totalement indépendante**.

### Usages typiques

| Scénario | Méthode |
|---|---|
| Local vs remote | Main = dev local, secondaire = replica prod, côte à côte |
| Multi-tenant | Une fenêtre par tenant |
| Grosse requête + écriture parallèle | Main exécute SQL lent, secondaire écrit le suivant |

Chaque fenêtre a ses onglets SQL / sélection connexion · base · schema / position curseur indépendants. Historique / favoris / snippets sont **partagés** (localStorage commun + SQLite mono-fichier).

Pas de "sync fenêtres" (les exécutions d'une connexion dans une fenêtre ne sont pas vues dans l'autre, historique propre) ; pas de "window manager", nombre illimité, utilisez Mission Control / Exposé.

---

## 13. Référence rapide de tous les raccourcis productivité

Défauts ci-dessous, tous rebindables dans `Settings → Raccourcis` (`new-window` est dans le menu, pas dans `COMMANDS`).

| Action | macOS | Windows / Linux | ID |
|---|---|---|---|
| Palette de commandes | ⌘K | Ctrl+K | `palette` |
| Recherche globale d'objets | ⌘⇧O | Ctrl+Shift+O | `object-search` |
| Exécuter SQL | ⌘+Enter | Ctrl+Enter | `run-sql` |
| Toggle AI chat | ⌘⇧L | Ctrl+Shift+L | `ai-chat` |
| Nouvelle connexion / requête / fermer onglet | ⌘N / ⌘T / ⌘W | Ctrl+N / T / W | `new-conn` / `new-query` / `close-tab` |
| Rechercher / Remplacer / Formater SQL | ⌘F / ⌘H / ⌘⇧F | Ctrl+F / H / Shift+F | `find` / `replace` / `format-sql` |
| Sauver snippet / Settings | ⌘S / ⌘, | Ctrl+S / Ctrl+, | `save-snippet` / `settings` |
| Nouvelle fenêtre | ⌘⇧N | Ctrl+Shift+N | (item de menu) |
