# Assistant IA

SkylerX injecte l'IA dans plusieurs **canaux indépendants** à différents endroits du produit — ce n'est pas une seule boîte de chat qui couvre tout :

- **Panneau de chat à droite** (`⌘⇧L`) : conversation multi-tours + injection de la structure de la base + insertion / exécution SQL en un clic
- **Complétion en ligne** : ghost text gris dans l'éditeur (style Copilot)
- **« Demander à l'IA » pour diagnostiquer une erreur** : bouton sur chaque popup d'erreur / zone de résultat
- **AI Toolbox** : un point d'entrée unique pour 7 prompts courants
- **Dialogues spécialisés** : bilan de santé / insights / création de tables / reverse / commentaires / traduction / données de test

La base commune : **abstraction provider + 3 couches de mémoire + IPC multi-canal**. Cette page parle uniquement de faits de code, sans subjectivité.

## 1. Vue d'ensemble — Multi-provider + canaux parallèles

| Module | Fichier | Rôle |
|---|---|---|
| `askAi()` / `askAiChat()` | `ai.ts` | Routage provider (Anthropic vs compatible OpenAI), requête HTTP (via IPC main process), annulable |
| Prompts `pXxx()` | `ai-prompts.ts` | 9 templates de prompts spécialisés, simple concaténation de chaînes |
| Complétion en ligne | `aiInline.ts` | Monaco InlineCompletionsProvider, throttle 600ms + AbortController |
| 3 couches de mémoire | `memory.ts` | A profil / B faits / C mémoire vectorielle, `buildMemorySection()` injecte dans le system prompt |
| Panneau de chat | `AiChatPanel.vue` | Sidebar droite, injection schema + réception chat-bus |
| Dialogues spécialisés | `Ai*Dialog.vue` | Bilan / insights / création / reverse / commentaires / données de test |
| Traduction inter-dialectes | `SqlTranslateDialog.vue` | SQL classique + procédures stockées, deux modes |

Tous les canaux passent au final par `askAi*` → IPC fetch → la même configuration provider. **Changer de provider bascule instantanément tous les canaux**.

## 2. Configuration des providers

`Settings → AI Provider` supporte 5 catégories de providers :

| Provider | Protocole | Endpoint |
|---|---|---|
| **Anthropic** | Anthropic Messages | `${baseUrl}/v1/messages`, auth `x-api-key` |
| **OpenAI** | OpenAI Chat | `${baseUrl}/v1/chat/completions`, auth `Authorization: Bearer` |
| **DeepSeek** | Compatible OpenAI | Idem |
| **Codex** | Compatible OpenAI | Idem |
| **Grok / xAI** | Compatible OpenAI | Idem |

Code réel (`ai.ts → askAi`) :

```ts
const provider = settings.aiProvider
const cfg = settings.aiProviders[provider]
if (!cfg?.apiKey?.trim()) throw new Error('NO_API_KEY')
if (provider === 'anthropic') return callAnthropic(o, cfg.apiKey.trim(), base, model)
return callOpenAiCompat(o, cfg.apiKey.trim(), base, model)
```

### Endpoint personnalisé

Chaque provider a son propre `baseUrl`, à modifier directement :

| Scénario | Configuration |
|---|---|
| Proxy Anthropic interne | provider=Anthropic, `baseUrl=https://your-proxy.example.com` |
| OpenAI compatible privé (vLLM / Ollama / one-api) | provider=OpenAI, ajustez `baseUrl` et `model` |
| DeepSeek direct | `https://api.deepseek.com`, `model=deepseek-chat` |
| Grok direct | `https://api.x.ai`, `model=grok-3-mini` |

### Stockage chiffré de l'API Key

La clé est stockée dans le trousseau OS comme les mots de passe (macOS Keychain / Windows Credential / GNOME libsecret) ; `settings.aiProviders[*].apiKey` est sous forme chiffrée sur disque.

### IPC ou fetch navigateur direct ?

Le preload desktop expose `window.api.ai.fetch` (proxy main process, contourne CORS navigateur, supporte le vrai cancel). Le web fallback sur `fetch` natif. `ai.ts → aiBridge()` choisit automatiquement :

```ts
function aiBridge() {
  return globalThis.api?.ai ?? null
}
```

Le chemin IPC chaîne aussi l'`AbortSignal` du renderer à `ai:cancel` du main process, **annulant vraiment les requêtes en vol** (pas juste la réponse) :

```ts
const reqId = `r${Date.now()}-${random}`
init.signal?.addEventListener('abort', () => bridge.cancel?.(reqId))
```

## 3. Panneau de chat à droite — AiChatPanel

`⌘⇧L` / `Ctrl+Shift+L` pour basculer. Le panneau a une largeur ajustable (`280-800px`) persistée dans `skylerx.aiChat.width`.

### Barre de contexte (en haut)

| Contrôle | Rôle |
|---|---|
| **Sélecteur de connexion** | Vers quelle connexion pointe la conversation (détermine dialecte + source schema) |
| **Sélecteur base / schema** | MySQL via `SCHEMATA`, PG via `pg_namespace` ; bases système filtrées auto |
| **Inclure la structure** (case) | Si coché, requête `information_schema.COLUMNS` → `tbl(col1 type, col2 type, ...)` injecté dans system prompt (limité à 6000 caractères) |
| **Nouvelle conversation** / **Effacer** | Vide l'historique courant pour repartir |

### Implémentation de l'injection schema

MySQL via `information_schema.COLUMNS`, PG via `information_schema.columns`. Regroupé par table : `tbl(col1 type, col2 type, ...)` une ligne par table, troncature à 6000 caractères avec `-- (truncated)`. **Seulement noms de tables + colonnes + types, aucune donnée**.

### Conversation multi-tours

Messages stockés dans `localStorage` clé `skylerx.aiChat.messages`, max 50. Chaque `send()` :

```ts
const memorySection = await buildMemorySection(text)  // mémoire 3 couches A/B/C
const reply = await askAiChat({
  messages: messages.value,           // historique complet
  dialect: connOf(connId.value)?.dialect,
  schema: useSchema.value ? schemaText.value : undefined,
  memorySection,
  signal: controller.signal,
})
```

Après réponse, en **arrière-plan** :
- `autoExtractFacts({ user, assistant })` — LLM extrait 1-3 faits durables vers la couche B
- `rememberVector(\`Q: ${user}\nA: ${assistant}\`)` — vectorisation vers la couche C

### Compteur de réflexion + alerte blocage

`elapsedTimer` incrémente chaque seconde, rendu en `12s`. Au-delà de 20s, ajout rouge `maybeStuck`. Le bouton `[Stop]` appelle `controller.abort()` (chemin IPC = vraie interruption).

### Rendu spécial des blocs SQL

La réponse est splittée par ` ``` ` via `splitParts` ; les blocs SQL passent par Monaco `editor.colorize` async (cache par hash sur `sqlHtml`), les autres par `renderMarkdown` GFM.

Trois boutons sous chaque bloc SQL :

| Bouton | Action |
|---|---|
| `Copier` | `navigator.clipboard.writeText` |
| `Insérer en brouillon` | `emit('insertSql', sql, connId)` → Workspace injecte dans QueryPane |
| `▶ Exécuter` | Double confirmation → `emit('runSql', ...)` → Workspace exécute |

### Badges d'exécution SQL

Après clic sur « Exécuter », un badge est attaché au bloc SQL (persisté dans `skylerx.aiChat.runMarks`, max 200) :

| État | Affichage |
|---|---|
| `pending` | ⌛ gris + « 10:23 envoyé » |
| `ok` | ✓ vert + « 10:23 succès » |
| `error` | ✗ rouge + « 10:23 échec », hover pour voir le détail |

QueryPane diffuse `onChatSqlExecuted` après exécution, le panneau souscrit pour mettre à jour le badge.

### Sélecteur de provider

Le dropdown en bas ne liste que **les providers avec apiKey configurée** (évite le `NO_API_KEY`). Bouton `⚙` adjacent qui émet `openSettings` vers la section AI des réglages.

## 4. Complétion en ligne — aiInline.ts

Monaco InlineCompletionsProvider, ghost text style Copilot. Enregistré sur l'éditeur SQL :

```ts
monaco.languages.registerInlineCompletionsProvider('sql', provider)
```

### Stratégie de throttling

| Paramètre | Valeur | Rôle |
|---|---|---|
| `DEBOUNCE_MS` | 600ms | Le LLM n'est appelé qu'après 600ms de pause |
| `MAX_PREFIX` | 2000 caractères | Le texte avant le curseur est tronqué |
| Longueur min déclenchement | 3 caractères | `prefix.trim().length < 3` → retour vide |

À chaque nouveau déclenchement, **abort immédiat du précédent** :

```ts
function clearPending() {
  if (!pending) return
  clearTimeout(pending.timer)
  pending.abort.abort()  // vraiment annule la requête précédente
  pending = null
}
```

Ne gaspille pas de quota, et l'ancienne complétion ne surgit pas tardivement.

### Prompt + system prompt

```ts
const text = await askAiChat({
  messages: [{ role: 'user', content: buildPrompt(prefix, ctx) }],
  dialect: ctx.dialect,
  extraSystem: 'Tu es un moteur de complétion SQL en ligne. Sors uniquement le fragment SQL après le curseur, '
             + 'max 1 ligne, sans bloc de code, sans explication, sans répéter le contexte. '
             + 'Si le contexte est insuffisant, sors une chaîne vide.',
  signal: abort.signal,
})
```

Contenu de `buildPrompt` : `Dialecte : <d>\n\nSchema :\n<hint>\n\nContexte SQL (curseur à la fin) :\n<prefix>`.

### Nettoyage final (`sanitizeCompletion`)

- Retire les délimiteurs ` ```sql ... ``` ` (LLM met parfois en bloc de code)
- Si le modèle répète le prefix (commence par les 80 derniers caractères du prefix) → tronque
- Réponse multi-lignes : ne garde que la première

### Acceptation / annulation

| Touche | Action |
|---|---|
| `Tab` | Accepter |
| `Esc` / `Backspace` / Continuer à taper | Annuler (Monaco natif) |

### Interrupteur global

Réutilise `settings.enableCompletion` (partagé avec l'autocomplétion SQL) ; désactivé = pas d'appel LLM. Les échecs sont silencieux (la complétion n'est pas mission-critical, on ne dérange pas l'utilisateur si ça plante).

## 5. Bouton « Demander à l'IA » sur erreur

En cas d'échec d'exécution, **chaque popup d'alerte / barre d'erreur de résultats** affiche un bouton `✨ Demander à l'IA`. Clic → `AiChatPanel.askAboutError()` :

```ts
async function askAboutError(p: { connId, connName?, sql, error }) {
  controller?.abort()             // 1) Interrompt la conversation courante
  for (let i=0; i<30 && running.value; i++) await sleep(50)  // attend que finally finisse
  connId.value = p.connId         // 2) Bascule sur la connexion en erreur
  useSchema.value = true          // 3) Force le contexte schema
  saveToStorage()
  const msg = `${t('aichat.askAiPrompt')}\n\n**Connexion** : ${p.connName}\n\n**SQL**\n\`\`\`sql\n${p.sql}\n\`\`\`\n\n**Error**\n\`\`\`\n${p.error}\n\`\`\``
  input.value = msg
  if (switching) await sleep(200) // 4) attend le chargement async du schema
  if (!schemaText.value) await loadSchema()
  await send()
}
```

### Forme du message

Le message utilisateur émis ressemble à :

```markdown
Aide-moi à diagnostiquer cette erreur SQL et propose des causes probables et des correctifs.

**Connexion** : prod-mysql

**SQL**
```sql
INSERT INTO orders(user_id, amount) VALUES (42, 99.9)
```

**Error**
```
ERROR 1452 (23000): Cannot add or update a child row:
a foreign key constraint fails (`shop`.`orders`, CONSTRAINT `fk_user` ...)
```

Avec le contexte schema auto-injecté (`users(id int, ...)` et `orders(...)` présents), l'IA localise généralement en quelques secondes que « `user_id=42` n'existe pas dans `users.id` ».

### Bus chat-bus

Ce mécanisme n'est pas réservé au panneau de chat — `MockDataDialog` utilise le même bus en cas d'échec pour afficher le bouton `askAi` :

```ts
toast.error(`Échec d'exécution : ${errMsg}`, {
  askAi: { sql: stmt, error: errMsg, connId, connName, dialect },
})
```

`ChatErrorAskEvent` est la forme unifiée ; n'importe quel point qui lève une erreur peut attacher un bouton « Demander à l'IA » sans réimplémenter.

## 6. AI Toolbox (7 prompts spécialisés)

`🛠 AI Toolbox` ou `⌘K → Boîte à outils IA`. Un seul dialogue couvre 7 tâches : sélection puis « Lancer l'IA » → fermeture du dialogue + prompt envoyé au panneau de chat.

| Toolbox | Template prompt | Entrée | Forme de sortie |
|---|---|---|---|
| **Écrire migration** | `pMigration` | Table cible + description du besoin | 3 blocs `\`\`\`sql` indépendants : ALTER avant / rollback / migration données |
| **Optimiser SQL** | `pOptimizeSql` | SQL original + EXPLAIN optionnel | Verdict → réécriture (bloc SQL) → suggestions d'index (bloc SQL) → gain attendu |
| **Lire EXPLAIN** | `pExplainAnalysis` | SQL + texte EXPLAIN | Lecture nœud par nœud en français clair + « Conclusion + un point d'action prioritaire » |
| **Générer données de test** | `pTestData` | Table + nb lignes + contexte métier | Bloc `\`\`\`sql` unique, INSERTs lignes par lignes, FK-aware |
| **NL → SQL** | `pNl2Sql` | Description en langage naturel | Bloc `\`\`\`sql` unique, en cas d'ambiguïté retient l'interprétation la plus probable + signale l'ambiguïté |
| **Documenter (sens des champs)** | `pDataDictDoc` | Table + colonnes CSV | Tableau Markdown 3 colonnes : champ / type / sens métier |
| **Expliquer l'usage de la table** | `pExplainTable` | Table + colonnes + indices FK | ≤ 200 caractères + 3 bullets (qui insère / qui lit / stratégie de suppression) |

### Champs du formulaire Toolbox

| Tâche | Table requise | SQL requis | EXPLAIN requis | Extra |
|---|---|---|---|---|
| migration | ✓ | | | Texte du besoin |
| optimize | | ✓ | (optionnel) | |
| explain-analysis | | ✓ | ✓ | |
| test-data | ✓ | | | Nb lignes + contexte métier |
| nl2sql | | | | Texte du besoin |
| doc | ✓ | | | Récupération auto CSV colonnes |
| explain-table | ✓ | | | Récupération auto CSV colonnes |

À la soumission, `pXxx(...)` construit le prompt → `emit('submit', { prompt, connId, connName, withSchema: true })` → Workspace relaie à `AiChatPanel.askPredefined(...)`, même mécanique que `askAboutError`.

### Points de conception

- La demande utilisateur originale (« ajouter colonne / renommer / optimiser ») est conservée telle quelle dans le prompt, pour éviter la perte de sens
- Le contexte (SQL / nom de table / texte EXPLAIN) est inséré en blocs Markdown, plus facile à identifier pour l'IA
- Le format de sortie attendu est clarifié (« donne-moi ALTER + ALTER inverse + migration données »), réduit les allers-retours
- Format de sortie strictement contraint (3 blocs `\`\`\`sql` séparés + titres H3) = parsing stable côté front

## 7. AI Health Check — Bilan de santé

`❤️ Health Check` dans la barre d'outils. À l'ouverture, 4 étapes automatiques :

1. **Collecte des métadonnées** — 3 SQL en parallèle :
   - MySQL : `COLUMNS / STATISTICS / KEY_COLUMN_USAGE` (filtre `REFERENCED_TABLE_NAME IS NOT NULL`)
   - PG : `information_schema.columns + pg_index + pg_class` + sous-requête FK
2. **Sérialisation** — Regroupement par table en texte compact (columns / indexes / FKs)
3. **Envoi à l'IA** — Construit le prompt avec `pHealthCheck`, appelle `askAiChat`
4. **Rendu** — Markdown splitté par H2 en 6 cartes thématiques

### 6 catégories d'anti-patterns + instructions IA réelles (`pHealthCheck`)

| Section | Titre | Tâche réelle de l'IA |
|---|---|---|
| 1 | Colonnes fréquemment filtrées sans index | Détection heuristique de colonnes type `status / created_at / user_id / type / is_* / *_at` souvent en filtre/tri mais sans index → liste |
| 2 | Champs nommés comme FK mais sans contrainte | `xxx_id` / `xxxId` dans une table sans FOREIGN KEY vers une table parente → liste + tente la table parente |
| 3 | Conventions de nommage mélangées | snake_case + camelCase mélangés dans la même table / base → indique le style à uniformiser |
| 4 | Types surdimensionnés | `VARCHAR(255)` pour chaînes courtes / `BIGINT` pour petits entiers / temps en `VARCHAR` |
| 5 | Tables / champs clés sans commentaire | Tables type `user / order / payment / account` sans COMMENT, sélectionne les champs clés à documenter |
| 6 | Champs soft-delete sans index | `deleted_at / is_deleted` pas dans un index → recommande `CREATE INDEX` |
| Résumé | — | 3 à 5 actions prioritaires par « rapport coût/bénéfice » |

**Format strict** : 6 H2 obligatoires `## 1.` à `## 6.` (parsing front facile), même les sections sans problème conservent leur titre « Aucun problème significatif détecté ».

### Collecte de métadonnées

MySQL utilise `information_schema.COLUMNS / STATISTICS / KEY_COLUMN_USAGE`, PG utilise `information_schema.columns + pg_index/pg_class + table_constraints` avec sous-requête FK, 3 requêtes en parallèle (chacune limitée à ~5000 lignes). Métadonnées totales tronquées à ~12K caractères pour éviter le débordement token ; supporté uniquement famille MySQL / PG.

## 8. AI Insights — SQL lents + cause racine

Dialogue à double onglet, fonctionne en collant SQL / erreur (pas besoin de connexion) :

### Onglet 1 : Optimisation SQL lent

Entrée : SQL (obligatoire) + EXPLAIN (optionnel) + stats table/lignes (optionnel). L'IA sort 4 sections : Points suspects (full scan / sans index / produit cartésien / cast implicite / stats obsolètes) → Index recommandés (`CREATE INDEX`) → Réécriture (covering index / sous-requête → JOIN / équivalences) → Estimation du gain.

`extraSystem` : `You are a database performance expert. Be specific and reference actual cost trade-offs.`

### Onglet 2 : Cause racine d'erreur

Entrée : message d'erreur (obligatoire) + contexte (optionnel : SQL exécuté / heure / utilisateur). L'IA sort : Sens de l'erreur (traduction humaine) → 3 causes les plus probables (par probabilité) → Étapes de diagnostic → Plan de correction.

`extraSystem` : `You are an SRE/DBA. Be practical, prioritize quick mitigation.`

Différence avec « bouton Demander à l'IA » : Insights = **deep dive manuel** (vous fournissez une erreur, analyse posée), le bouton = **un clic qui lie le SQL courant + erreur + schema de la connexion** et continue en multi-tours dans le panneau.

## 9. AI Schema Architect — Conception de tables

Assistant conversationnel de conception. Besoin métier → l'IA produit le DDL complet multi-tables + FK + index, possibilité d'itérer en posant des questions.

### System prompt (codé en dur)

```text
You are a senior database architect. The user describes a business domain (in any language).
Your job:
1. Design multiple related tables (with primary keys, foreign keys, indexes,
   sensible types for the <dialect> dialect).
2. Output a single ```sql code block containing the COMPLETE CREATE TABLE statements
   (including foreign keys and indexes) so the user can copy-paste-run.
3. Explain key design decisions briefly in 2-4 bullet points.
4. When the user asks to revise, output the FULL updated SQL again (not just a diff)
   — they will execute the whole block.

Stay concise. Prefer normalized design unless user asks for denormalized.
```

### Flux

1. Description métier (`"Système e-commerce : users, products, orders, order_items, coupons"`)
2. `askAiChat({ messages, dialect, extraSystem })` retourne le Markdown
3. `extractAllSql(reply)` extrait tous les blocs `\`\`\`sql` comme `sqlBlocks`
4. Question supplémentaire → historique complet renvoyé → l'IA sort la **version complète** mise à jour (contrainte stricte dans system prompt : pas de diff, version intégrale)

### Exécution en un clic

Bouton `▶ Exécuter la dernière version` en bas : prend tous les `sqlBlocks` de la dernière réponse, join + `splitStatements` + `client.connections.execute` pour chaque. Double confirmation avec le nombre de `CREATE` et la base cible.

## 10. AI Schema Reverse — Inférence inverse

Donnez des données CSV / TSV / JSON → l'IA déduit le schema → génère `CREATE TABLE` + `INSERT` optionnel.

### Entrée

| Champ | Description |
|---|---|
| Format | CSV / TSV / JSON |
| Nom de table | Par défaut `inferred_table`, modifiable |
| Données d'exemple | Quelques lignes, avec en-têtes pour la précision |
| Générer aussi INSERT | Case à cocher, ajoute « 5. Génère les INSERT pour toutes les données d'exemple » au prompt |

### Structure du prompt

```text
Basé sur les données CSV ci-dessous, déduis le schema et génère le CREATE TABLE en dialecte mysql...

Exigences :
1. Déduis le **type le plus approprié** pour chaque colonne (longueur, numérique, date, enum, etc.)
2. Déduis quelles colonnes peuvent être **clé primaire** (auto-incrément vs clé métier), lesquelles doivent être **NOT NULL**
3. Recommande 1-2 **index candidats** (heuristique : colonnes type FK, colonnes souvent filtrées)
4. Nom de table : `inferred_table`

Données d'exemple :
```
id,name,email,created_at
1,alice,a@x.com,2026-01-01
...
```

Suis strictement cette structure de sortie :

### Explication d'inférence
(colonne → type → raison, 2-3 phrases)

### CREATE TABLE
```sql
CREATE TABLE ...
```

### Recommandations d'index
- ...
```

### Édition puis exécution

Le SQL retourné est injecté dans la zone éditable (`sqlEdit`), modifiable avant `▶ Exécuter` → confirmation → `splitStatements` → exécution.

## 11. AI Comment Writer — Commentaires sur tables / colonnes

Clic droit table `💬 IA écrit les commentaires` ou bouton barre d'outils. Flux :

1. **Extraction colonnes** — MySQL : `information_schema.COLUMNS` (name / type / nullable / default / comment), PG : ajoute `pg_catalog.col_description` pour les commentaires existants
2. **Sérialisation** — en `columnsCsv` : `- col type [NOT NULL] [DEFAULT ...]`
3. **Envoi à l'IA** — `pComment(ctx, columnsCsv)`, force la sortie en **un seul bloc `\`\`\`json`**
4. **Parsing** — extrait le JSON, obtient `[{ col, comment }]`
5. **Tableau comparatif** — commentaires existants vs suggestions IA, case à cocher par ligne
6. **Application** — génère ALTER :
   - MySQL : `ALTER TABLE ... MODIFY <col> <type> [NOT NULL] [DEFAULT ...] COMMENT '...'` (besoin de récupérer type / nullable / default originaux, sinon perte)
   - PG : `COMMENT ON COLUMN <table>.<col> IS '...'`

### Contraintes strictes du prompt (`pComment`)

Le prompt impose : **un seul bloc `\`\`\`json`, sans texte autour** ; chaque entrée du tableau `{ "col": "nom de colonne", "comment": "sens métier en une phrase" }` ; `col` doit être recopié **tel quel** (sensible à la casse, pas traduit) ; `comment` ≤ 30 caractères, si info insuffisante : "? (à compléter manuellement)" ; **lister tous les champs** (même `id / created_at`).

Format strict en sortie = `parseSuggestion()` peut extraire ` ```json ... ``` ` par regex stable, fallback en essayant tout le contenu comme JSON brut. `col` recopié intact → comparaison avec état actuel + génération ALTER sans désalignement.

### Commentaire au niveau table

En plus du niveau colonne, possible d'écrire une phrase pour la table : MySQL `ALTER TABLE ... COMMENT='...'`, PG `COMMENT ON TABLE ... IS '...'`.

## 12. Traduction SQL — SqlTranslateDialog

`🌐 Traduire`. 4 dialectes fixes : `mysql / postgresql / sqlserver / oracle`.

### Deux modes

| Mode | Prompt |
|---|---|
| **SQL** (requête / DDL) | `pTranslate(from, to, sql)` |
| **Procédure stockée / fonction** | `pTranslateProcedure(from, to, code)` — couvre en plus modes de paramètres / BEGIN-END / DECLARE / gestion d'exceptions / curseurs / DELIMITER |

`extraSystem` adapté :

- SQL : `You are a senior SQL polyglot. Translate SQL across dialects precisely; flag every non-portable construct honestly.`
- Procedure : `You are a senior SP/PL/SQL polyglot. Translate stored procedures faithfully; preserve control flow and explicit error handling.`

### Contraintes strictes (`pTranslate`)

3 sections strictes :

1. **SQL traduit** — un seul bloc `\`\`\`sql`, une seule instruction, sans explication
2. **`### Avertissements`** — bullet des points **non portables** (`MySQL ON DUPLICATE KEY UPDATE` → `PG ON CONFLICT DO UPDATE`, sémantique proche mais détails comportementaux différents ; `DATETIME vs TIMESTAMP` ; `NVARCHAR vs NVARCHAR2` ; pagination / auto-incrément / concaténation / style de quotes ; cast implicite, tri NULL) ; sinon « pas de syntaxe non portable »
3. **`### Suggestions`** — bullet de styles plus idiomatiques pour le dialecte cible (CTE / `LIMIT OFFSET` / `COALESCE` à la place d'`IFNULL`) ; sinon « traduction littérale déjà idiomatique »

Titres H3 délimiteurs → parsing front par titre.

### Rendu double colonne

| Colonne gauche | Colonne droite |
|---|---|
| `extractSql(answer)` extrait le SQL traduit → Monaco `colorize` + bouton `Copier` | Markdown restant après le premier bloc `\`\`\`sql` (warnings + suggestions) → `renderMarkdown` |

### Petites optimisations

- `swapDialects()` : inverse from/to en un clic, pratique pour retraduire en sens inverse
- **Court-circuit même dialecte** : `from === to` construit une fausse réponse « traduction inutile », sans appel
- Annulation possible pendant traduction via `controller?.abort()`

## 13. AI Mock Data — Données de test FK-aware

Clic droit table `🧪 Générer des données de test`. Le corps du dialogue est un **moteur de règles** (`mockgen.ts` déduit le `SemanticKind` par nom de colonne + type SQL) ; l'IA n'intervient qu'à deux endroits :

### 13.1 `aiInfer()` — L'IA déduit la sémantique de toutes les colonnes d'un coup

Bouton `✨ Inférer par IA`. Prompt en anglais (les modèles répondent mieux à l'instruction JSON anglaise), contraintes :

- Choisir dans une whitelist fixe `SEMANTIC_KINDS` (`auto / integer / decimal / money / name_cn / phone_cn / id_card_cn / address_cn / email / enum / lorem_cn / ...`), les autres invalides
- Colonnes en contexte chinois (`name/姓名 / 手机/phone / 身份证 / 地址`) priorité variantes `_cn`
- **Interdit** `auto` (génère du texte aléatoire vide de sens), choisir un type spécifique
- `money/price/amount/cost` → `money` ; `decimal/float` → `decimal`
- Entier PK marqué `[PK]` → `integer` (le générateur incrémentera) ; `status/state/role` → `enum` ; `description/content/remark/note` → `lorem_cn`
- **Sortie uniquement** un JSON object, ex. `{"user_id":"integer","name":"name_cn","mobile":"phone_cn"}`

À la réception, `/\{[\s\S]*\}/` extrait le premier JSON (tolère le texte autour), valide chaque kind dans la whitelist + col présente dans baseColumns avant application.

### 13.2 Bouton « Demander à l'IA » en cas d'échec

Échec INSERT (NOT NULL manquant / FK inexistante / type incompatible) → toast avec bouton `askAi` → chat-bus envoie stmt + erreur + infos connexion au panneau de chat.

La génération réelle d'INSERT vient de `buildMockInserts(dialect, tableRef, columns, count)` (chunks de 100), l'IA ne participe pas — uniquement à **inférer la sémantique** + **diagnostiquer les erreurs**.

## 14. Mémoire en 3 couches — memory.ts

`Settings → AI → Mémoire` pour configurer ; injection automatique en tête du system prompt à chaque conversation (les modèles sont plus sensibles au contexte placé en début).

| Couche | Nom | Forme | Usage | Déclenchement |
|---|---|---|---|---|
| **A** | `aiCustomInstructions` | Texte libre | Identité / préférences durables | Injection complète à chaque conversation |
| **B** | `aiFacts` | `{id, text, createdAt}[]` | Faits structurés | Injection complète à chaque conversation ; `aiAutoExtractFacts` actif → extraction auto de 1-3 faits par tour |
| **C** | `aiVectorMemories` | `{id, text, vec, createdAt}[]` | Notes en masse | Top-K par similarité cosinus à chaque tour (par défaut `aiVectorTopK`), seuil > 0.3 |

### Ordre d'assemblage `buildMemorySection(query)`

Construit le Markdown dans l'ordre A → B → C :

- A : `## User profile & preferences` + texte libre
- B : `## Known facts` + bullet list
- C : `## Relevant past notes` + bullet list (requiert query + clé d'embedding configurée, `recallRelevant(query)` prend top-K + seuil > 0.3)

### Configuration embedding

La couche C nécessite un endpoint d'embedding. `Settings → AI → Mémoire` :

| Champ | Défaut |
|---|---|
| `aiEmbeddingBaseUrl` | (vide, à remplir) |
| `aiEmbeddingApiKey` | (vide) |
| `aiEmbeddingModel` | `text-embedding-3-small` |

La requête passe par `${base}/v1/embeddings` compatible OpenAI, DeepSeek / Grok compatibles. Timeout 15s sur ces requêtes courtes, pour ne pas freiner le flux principal de chat.

### Troncature LRU

Limite C à 1000 entrées, troncature ancienne au-delà :

```ts
if (settings.aiVectorMemories.length > 1000) {
  settings.aiVectorMemories.splice(1000, settings.aiVectorMemories.length - 1000)
}
```

### Extraction auto de faits (couche B)

`aiAutoExtractFacts` actif : après chaque tour, `autoExtractFacts({ user, assistant })` demande au LLM d'extraire ≤ 3 faits **durables** (`"uses MySQL 8"` / `"works on 'orders' schema"` / `"prefers snake_case"`), saute les contenus éphémères ; réponse `none` = sauté ; sinon parse en bullets et insère ; échec silencieux (la mémoire ne doit pas bloquer le chat principal). `extraSystem` : `You are a memory curator. Output bullet list of durable facts only.`

## 15. Confidentialité & sécurité

| Comportement par défaut | Description |
|---|---|
| API Key chiffrée | Trousseau OS (macOS / Windows / Linux libsecret) |
| API Key ne quitte jamais la machine | Desktop : IPC direct vers l'endpoint provider ; Web : fetch navigateur direct (ajustez baseUrl pour passer par votre proxy) |
| **N'envoie pas de données par défaut** | « Inclure la structure » désactivé par défaut ; si coché, **n'envoie que** le résumé `tbl(col1 type, col2 type, ...)`, jamais les données de lignes |
| Limite schema 6KB | Troncature auto `-- (truncated)` au-delà, anti-débordement token |
| `request log` auditable | `Settings → AI → Journal des requêtes` (chemin IPC desktop = enregistrement complet) |
| Bouton « Demander à l'IA » indique clairement ce qui est envoyé | SQL complet + code d'erreur + métadonnées connexion + indice schema |

## 16. Maîtrise des coûts

| Dimension | Configuration |
|---|---|
| Changer de provider | Dropdown bas du panneau / `⌘K → Changer de provider IA` |
| Changer de modèle | `Settings → AI Provider → <provider> → model` (modèle bon marché pour complétion + Health Check, cher pour création / traduction) |
| Désactiver complétion en ligne | `Settings → Complétion` (interrupteur global réutilisé via `enableCompletion`) |
| Désactiver mémoire vectorielle | `Settings → AI → Mémoire → Mémoire vectorielle` — chaque chat appelle l'embedding, désactiver économise des tokens |
| Désactiver extraction auto de faits | `aiAutoExtractFacts` désactivé — sans, pas de requête d'extraction supplémentaire par tour |
| Long contexte vs court | « Inclure la structure » au cas par cas, pour les questions non liées à la base (« Explique cette syntaxe SQL ») c'est inutile |

---

## 17. Aide-mémoire des comportements

| Je veux… | Canal à utiliser |
|---|---|
| Conversation multi-tours, itérer | **AiChatPanel** |
| Complétion en direct dans l'éditeur | **Complétion en ligne** (`aiInline.ts`) |
| Diagnostic rapide d'erreur | **Bouton « Demander à l'IA »** (chat-bus) |
| Migration / optimisation / lecture EXPLAIN sur une table | **AiToolboxDialog** |
| Scanner toute la base pour anti-patterns | **AiHealthCheckDialog** |
| Deep dive sur un SQL lent / une erreur | **AiInsightsDialog** |
| Concevoir plusieurs tables depuis une description métier | **AiSchemaArchitectDialog** |
| Inférer un schema depuis des données d'exemple | **AiSchemaReverseDialog** |
| Écrire les commentaires de toutes les colonnes et appliquer | **AiCommentDialog** |
| Traduire SQL / procédures stockées entre dialectes | **SqlTranslateDialog** |
| Remplir une table de données de test (sémantique + FK safe) | **MockDataDialog** |
| Donner une mémoire long terme à l'IA | **memory.ts → 3 couches A/B/C** |

Combiné avec les [Fonctionnalités avancées](./advanced), la puissance double — sur EXPLAIN demandez à l'IA, sur une recommandation d'index demandez l'explication, sur la traduction Oracle → DM évaluez les warnings avec l'IA.
