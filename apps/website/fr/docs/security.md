# Sécurité et conformité

SkylerX cible simultanément les environnements dev / test / prod, avec un modèle de sécurité end-to-end intégré, couvrant **des identifiants de connexion au rendu des résultats, de la soumission SQL à l'export bulk**. Cette page décrit chaque défense réellement implémentée : ce qu'elle fait, ce qu'elle ne fait pas, et les preuves disponibles pour ops et audit conformité.

## 1. Vue d'ensemble

Le modèle de sécurité est segmenté selon le "flux de données" en 5 étapes, chacune avec un module dédié :

| Étape | Module / fichier | Rôle principal |
|---|---|---|
| Stockage identifiants | `apps/desktop/src/main/db/connectionStore.ts` | Mots de passe / clés SSH chiffrés via trousseau OS (Electron `safeStorage`) |
| Identification env | `packages/ui/src/connEnv.ts` | Marqueurs 3 couleurs dev / test / prod + connexion read-only + whitelist d'instructions de lecture |
| Interception SQL | `packages/ui/src/sqlLint.ts` | 7 règles heuristiques (UPDATE/DELETE sans WHERE, DROP/TRUNCATE en prod, etc.) |
| Présentation données | `packages/ui/src/masking.ts` + `DataMaskingViewDialog` | Match par regex de nom de colonne → masquage au rendu + vue masquée en base |
| Gouvernance / audit | `compliance.ts` / `PiiScannerDialog` / `DataContractDialog` / `export-encrypt.ts` | Check Conformité GB17859, scanner PII, data contracts, export chiffré |

Détails par étape ci-dessous, basés sur le code.

## 2. Chiffrement des mots de passe (trousseau OS)

Code : `apps/desktop/src/main/db/connectionStore.ts`

Lors de création / modification d'une connexion, le mot de passe ne va pas en clair dans SQLite, mais passe par Electron `safeStorage` (macOS = Keychain, Windows = DPAPI, Linux = libsecret / kwallet) :

```ts
function encryptPassword(plain?: string): string | null {
  if (!plain) return null
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(plain).toString('base64')}`
  }
  return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`
}
```

Le champ stocké a toujours un préfixe pour identifier la version :

| Préfixe | Sens | Quand |
|---|---|---|
| `enc:` | Cipher trousseau OS | Chemin normal, macOS / Windows / la plupart Linux |
| `plain:` | base64 (**uniquement dev**) | `safeStorage.isEncryptionAvailable()` faux, ex. conteneur Linux sans libsecret / kwallet |
| Autres | Champs legacy sans préfixe | Données historiques |

> **Important** : `plain:` fonctionne toujours, mais c'est **comme du clair**. Sous Linux, installez `gnome-keyring` ou `kwallet`, puis l'utilisateur ré-édite une connexion (tout enregistrement déclenche un re-chiffrement).

### Clés tunnel SSH

La config SSH a `password` / `privateKey` / `passphrase`, tout passe par la même chaîne de chiffrement. **À l'affichage liste (`listConnections`), les clés sont retirées** pour éviter qu'elles traînent en mémoire :

```ts
function decryptSsh(stored, withSecrets) {
  const ssh = JSON.parse(decryptPassword(stored)) as SshConfig
  return withSecrets
    ? ssh
    : { ...ssh, password: undefined, privateKey: undefined, passphrase: undefined }
}
```

Seule la vraie connexion / le re-remplissage du formulaire (`getConnection`) renvoie les clés complètes.

## 3. Marqueur d'environnement dev / test / prod + protection production

Code : `packages/ui/src/connEnv.ts`

Le champ `extra.env` de la config connexion stocke un tri-état :

| Valeur | Label UI | Couleur (`ENV_META.color`) | Sévérité |
|---|---|---|---|
| `dev` | Développement | `#4caf50` vert | Standard |
| `test` | Test | `#e0a020` orange | Standard |
| `prod` | Production | `#e04050` rouge | **Règles SQL supplémentaires + double confirmation avant exécution** |

### Connexion read-only (`extra.readOnly`)

Read-only marqué par `connReadOnly()`. SkylerX vérifie à 2 endroits indépendamment :

1. **Niveau connexion** : `isReadOnlyStatement(sql)` intercepte les writes via whitelist du premier mot-clé (`select` / `with` / `show` / `explain` / `desc(ribe)` / `pragma`), tout autre = interdit.
2. **Mode commit** : read-only force `auto` commit (la transaction manuelle n'a pas de sens en lecture) ; voir `initialCommitMode()`.

### Filigrane production

`Settings → Filigrane production` permet de personnaliser texte / angle / transparence / couleur ; superpose un filigrane SVG sur toutes les vues des connexions prod (éditeur SQL, résultats, aperçu d'export), anti-screenshot.

## 4. SQL Linter — 7 règles intégrées

Code : `packages/ui/src/sqlLint.ts`

Scan heuristique sur chaînes, pas de parser complet, intercepte uniquement les patterns "manifestement dangereux". Résultats à 3 niveaux :

| Sévérité | Retour UI | Exécuté ? |
|---|---|---|
| `error` | Popup modale, double confirmation | Exécuté après confirmation |
| `warn` | Toast | **Exécuté** (juste informatif) |
| `info` | Décision côté caller (badge possible) | Exécuté |

Tableau complet des règles :

| ID règle | Sévérité | Condition | Message |
|---|---|---|---|
| `no-where-update` | error | `UPDATE` au début + pas de `WHERE` | UPDATE sans WHERE, met à jour toute la table |
| `no-where-delete` | error | `DELETE FROM` + pas de `WHERE` | DELETE sans WHERE, vide toute la table |
| `prod-drop` | error | env=prod + `DROP TABLE/DATABASE/SCHEMA/INDEX/VIEW` | Exécution de DROP XXX en production |
| `prod-truncate` | warn | env=prod + `TRUNCATE` | TRUNCATE en production |
| `cross-join` | warn | `SELECT` + `FROM a, b` (virgule JOIN) ou `JOIN` sans `ON/USING` | Multi-tables sans condition de jointure (produit cartésien suspecté) |
| `select-star` | info | `SELECT *` | SELECT *, mieux d'expliciter les colonnes |
| `forgotten-limit` | info | `SELECT` sans `LIMIT` / `FETCH FIRST` / `TOP n` / `COUNT()` | SELECT sans LIMIT, peut ramener beaucoup |

### Contraintes "cheap"

Le retrait des commentaires se fait avec 2 regex simples (`/\/\*[\s\S]*?\*\//g` et `/--[^\n]*/g`) pour ne pas se faire piéger par un `-- WHERE 1=1`. Toutes les règles sont O(n) string scan, sans ralentir le chemin chaud.

### Agrégation multi-instructions

`lintStatements(stmts, ctx)` regroupe par id en gardant la sévérité max, idéal pour "coller un fichier SQL et tout exécuter".

## 5. Data contracts (notNull / range / regex)

Code : `packages/ui/src/components/DataContractDialog.vue`

Les contrats permettent de pré-signaler les "valeurs interdites" sur des champs métier. Chaque contrat a 4 parties :

| Champ | Type | Description |
|---|---|---|
| `name` | string | Nom du contrat |
| `table` | string | `schema.table` cible |
| `notNull` | `string[]` | Colonnes non NULL |
| `range` | `Record<string, [min, max]>` | Plage numérique, `null` = illimité |
| `regex` | `Record<string, string>` | Regex à matcher |
| `enabled` | boolean | Toggle |

Stockage `localStorage.skylerx.dataContracts`, tableau JSON.

### Exemple typique

```json
{
  "name": "Intégrité table users",
  "table": "public.users",
  "notNull": ["phone", "email"],
  "range": { "age": [0, 150] },
  "regex": { "email": "^[^@]+@[^@]+$", "phone": "^1\\d{10}$" },
  "enabled": true
}
```

### Import / export

- **📋 Exporter** → JSON dans le presse-papier, à coller dans doc partagé / repo git
- **📥 Importer** → coller JSON pour écraser la liste

DBA écrit les contrats, distribués par équipe / projet, chargés localement dans SkylerX et actifs auto.

## 6. Scan de champs sensibles (PII Scanner)

Code : `packages/ui/src/components/PiiScannerDialog.vue`

Heuristique en 2 phases : **match nom de colonne → validation échantillon**.

### Phase match nom

Via `columnPattern` regex de `DEFAULT_MASK_RULES` (voir section suivante). Ex. `user_phone` match `(phone|mobile|tel|手机|电话)`, classé `phone`.

### Phase validation échantillon (optionnel)

Pour les colonnes matchées, charge N lignes (défaut 50, ajustable 10-1000), regex de double validation :

| kind | Regex de validation |
|---|---|
| `phone` | `/^\+?[\d\s\-()]{7,20}$/` |
| `email` | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| `idCard` | `/^\d{15}$\|^\d{17}[\dxX]$/` |
| `bankCard` | `/^\d{12,19}$/` |
| `name` / `address` / `default` | Aucun, nom de colonne seul |

Hit < 30% = "coïncidence de nom, pas vraiment PII", retiré du rapport.

### Rapport et suite

Rapport groupé par table en tri desc des hits, **📋 Exporter CSV** (colonnes : schema/table/column/data_type/rule/kind/sample). CSV livrable à l'audit conformité ; clic droit base → "Générer vue masquée" pour ces colonnes.

## 7. Vue masquée (DataMaskingViewDialog)

Code : `packages/ui/src/masking.ts` + `packages/ui/src/components/DataMaskingViewDialog.vue`

### 7.1 Règles de masquage intégrées

`DEFAULT_MASK_RULES` est la baseline, modifiable dans `Settings → Masquage`.

| Règle | columnPattern | kind | Actif par défaut | Algorithme |
|---|---|---|---|---|
| Téléphone | `(phone\|mobile\|tel\|手机\|电话)` | phone | ✅ | 3 premiers + `****` + 4 derniers |
| Email | `(email\|mail\|邮箱)` | email | ✅ | Première lettre + `***@domain` |
| ID Card | `(id_?card\|身份证\|idno)` | idCard | ✅ | 6 premiers + `*…` + 4 derniers |
| Carte bancaire | `(bank_?card\|card_?no\|账号\|账户)` | bankCard | ✅ | 4 premiers ` **** **** ` 4 derniers |
| Nom | `(real_?name\|user_?name\|full_?name\|姓名)` | name | ❌ | Premier caractère + `*` (reste caché) |
| Adresse | `(address\|addr\|地址)` | address | ❌ | 6 premiers caractères + `***` |
| Mot de passe / Token | `(password\|passwd\|secret\|pwd\|token\|api_?key\|密码)` | default | ✅ | 2 premiers + `****` + 2 derniers |

### 7.2 Masquage au rendu vs vue masquée en base

Deux chemins indépendants :

- **Masquage au rendu** : `Settings → Masquage → Activer`. Front masque selon nom de colonne → règle → algorithme, **sans toucher à la base** ; export = choix "Original / Masqué" dans le dialogue.
- **Vue masquée en base** (`DataMaskingViewDialog`) : génère `CREATE OR REPLACE VIEW ... AS SELECT mask_expr(c) ...` SQL en base, **les apps lisent la vue, pas la table directe**. 6 stratégies :

| Stratégie | Expression SQL générée (exemple MySQL) |
|---|---|
| `raw` original | `` `c` AS `c` `` |
| `md5` | `` md5(CAST(`c` AS char(4000))) AS `c` `` |
| `partial` N premiers M derniers | `` CONCAT(LEFT(`c`,N), '***', RIGHT(`c`,M)) AS `c` `` |
| `fixed` remplacement | `'***' AS \`c\`` |
| `truncate` troncature | `` LEFT(`c`, max) AS `c` `` |
| `null` | `` NULL AS `c` `` |

À l'ouverture, `recommendStrategy(colName)` propose une stratégie par colonne, ajustable. SQL généré modifiable avant exécution (▶ Créer la vue).

## 8. Vérification de Conformité GB17859 (sécurité chinoise niveau 2.0)

Code : `packages/ui/src/compliance.ts` + `packages/ui/src/components/ComplianceDialog.vue`

Vérifie ce qui est "vérifiable depuis une connexion DB", sans toucher au firewall / chiffrement de disque (niveau OS). 4 états :

| Sévérité | Sens |
|---|---|
| `pass` ✅ | Conforme |
| `warn` ⚠️ | Non conforme mais risque maîtrisé (audit off, SSL off) |
| `fail` ❌ | Violation grave (root remote ouvert, mot de passe vide) |
| `unknown` — | Indéterminé (privilèges insuffisants, feature commerciale) |

### Famille MySQL (MySQL / MariaDB / OceanBase / TiDB) — 7 règles

| ID | Catégorie | Titre | Détection |
|---|---|---|---|
| `mysql.auth.password-policy` | Identification | Politique de mot de passe forte | `SHOW VARIABLES LIKE 'validate_password%'`, policy ≥ MEDIUM et length ≥ 8 |
| `mysql.audit.enabled` | Audit | Audit log activé | `audit_log_*` (entreprise) ou `server_audit_*` (MariaDB) |
| `mysql.auth.root-remote` | Contrôle d'accès | root sans accès remote | `SELECT user, host FROM mysql.user WHERE user='root'` |
| `mysql.auth.anonymous` | Contrôle d'accès | Pas d'utilisateur anonyme | `mysql.user WHERE user=''` |
| `mysql.transport.ssl` | Intégrité | SSL forcé | `require_secure_transport=ON` |
| `mysql.audit.slowlog` | Audit | Slow query log activé | `slow_query_log=ON` |
| `mysql.integrity.binlog` | Intégrité | binlog activé | `log_bin=ON` (PITR / réplication) |

### Famille PostgreSQL (PG / KingbaseES / openGauss / Greenplum / CockroachDB) — 6 règles

| ID | Catégorie | Titre | Détection |
|---|---|---|---|
| `pg.auth.password-encryption` | Identification | Algorithme SCRAM-SHA-256 | `SHOW password_encryption` |
| `pg.audit.pgaudit` | Audit | Extension pgaudit installée | `pg_extension WHERE extname='pgaudit'` |
| `pg.transport.ssl` | Intégrité | SSL activé | `SHOW ssl` |
| `pg.access.superuser-count` | Contrôle d'accès | Nombre de superusers contrôlé (≤ 2) | `SELECT rolname FROM pg_roles WHERE rolsuper` |
| `pg.audit.log-statement` | Audit | log_statement configuré | `SHOW log_statement` ≠ none |
| `pg.auth.empty-password` | Identification | Pas d'utilisateur connectable sans mot de passe | `pg_authid WHERE rolpassword IS NULL AND rolcanlogin` |

### Export rapport Markdown

**Exporter Markdown** appelle `renderReport()` : groupé par catégorie, avec stat "Total : ✅ N · ⚠️ N · ❌ N · — N" + description / conclusion / `evidence` brute par règle. Nom auto : `compliance-<safeName>-<YYYY-MM-DDTHH-MM-SS>.md`.

### Exécution parallèle

"Démarrer la vérification" lance `Promise.all` en parallèle, échec d'une règle = `unknown` (try/catch), n'affecte pas les autres, le driver gère lui-même la file.

### Autres dialectes

Hors MySQL / PG, placeholder :

```
Pas de check de conformité pour ce dialecte — confirmation manuelle requise
```

Oracle / SQL Server / SQLite / 达梦 à venir.

## 9. Cryptographie nationale chinoise SM2 / SM3 / SM4 (planifié)

Le jeu de règles de conformité considère déjà "`password_encryption=md5` faible par norme nationale chinoise / Conformité GB17859 (sécurité chinoise niveau 2.0)" (voir `pg.auth.password-encryption`). Les API auxiliaires SM2 / SM3 / SM4 (chiffrement/signature applicatif avant insertion) ne sont **pas encore publiées**, prévu en v0.6 dans un module `cryptoCn.ts` :

- SM2 signature / chiffrement courbe elliptique (basé sm-crypto)
- SM3 hash
- SM4 chiffrement bloc symétrique (CBC / ECB)

Une fois les signatures stables, une section "API auxiliaire SM" sera ajoutée à cette page.

## 10. Export chiffré .skbk

Code : `packages/ui/src/export-encrypt.ts`

Chiffre un texte (typiquement dump SQL ou config connexion) avec mot de passe en JSON one-line, suffixes `.sql.enc` / `.skbk`.

### Stack algorithmique

| Étape | Algo | Paramètres |
|---|---|---|
| Dérivation clé | PBKDF2-HMAC-SHA-256 | iter = `DEFAULT_ITER` = **200 000** (ajustable, dans l'en-tête) |
| Chiffrement | AES-GCM 256 | salt 16 octets + iv 16 octets, regénérés à chaque fois |
| Intégrité | Tag auth AES-GCM 128-bit | Mot de passe faux / fichier modifié → `WRONG_PASSWORD` direct |
| En-tête | `magic: 'SKYLERX-ENC-v1'` | Identification version pour évolution |

> **Compromis PBKDF2 iter 200 000** : OWASP 2023 recommande SHA-256 ≥ 600 000, mais desktop = vieilles machines à considérer (Atom CPU = 1+ s sur 600k). Pour contenus extrêmement sensibles, ajustez `iter` lors de `encryptText`.

### Format de sérialisation

```json
{
  "magic": "SKYLERX-ENC-v1",
  "salt": "<base64 16B>",
  "iv":   "<base64 16B>",
  "iter": 200000,
  "data": "<base64 ciphertext + tag>"
}
```

Ordre des champs fixe pour git diff ; JSON une ligne pour streaming.

### Codes d'erreur

| Erreur | Quand | Retour UI |
|---|---|---|
| `INVALID_BLOB` | Parsing : champ manquant / type incorrect / `magic` ne match pas | "Format de fichier corrompu" |
| `WRONG_PASSWORD` | Tag GCM invalide (mot de passe faux / fichier modifié) | "Mot de passe erroné" (pas de distinction des deux causes, anti side-channel) |

### Dépendance Web Crypto

Tout via `globalThis.crypto.subtle`, sans dépendance tierce. Desktop Electron renderer + navigateurs modernes OK ; Node 18+ aussi (pour tests). Environnements anciens → `Web Crypto API unavailable: upgrade to Node 18+ or a modern browser`.

## 11. Frontière de confidentialité IA

L'assistant IA (Anthropic / OpenAI / DeepSeek / Codex / Grok) est central, mais ce qu'il envoie à l'API tierce est **strictement limité au contexte nécessaire** :

| Type | Envoyé ? | Note |
|---|---|---|
| SQL courant | ✅ | Prémisse du chat / complétion déclenché par l'utilisateur |
| Schema hint (noms base / table / colonne) | ✅ | Métadonnées seulement, **aucune donnée de ligne** |
| Message d'erreur + code | ✅ | Pour le diagnostic "Demander à l'IA", voir doc AI §4 |
| Métadonnées connexion (dialecte / nom / base) | ✅ | Aide l'IA à choisir le bon dialecte |
| **Données de résultats** | ❌ | Même avec complétion IA, seulement le schema hint, jamais le contenu des lignes |
| **Mot de passe connexion / clé privée SSH** | ❌ | Chiffré dans le trousseau, jamais lu pour prompt |
| **Toute la config locale** | ❌ | Seulement dialect / database de la connexion courante |

Pour isolation totale de l'IA :

1. `Settings → AI Provider → vider API Key` → désactive complétion / chat / Demander à l'IA
2. Ou endpoint local (Ollama / vLLM / déployé privé), pointez `endpoint` vers `http://localhost:...`

> **Webhooks IA suivent les mêmes règles** : le corps de notif par défaut = "titre + résumé + heure", pas de données de ligne. Modifiable dans `Settings → Notifications`.

## 12. Aide-mémoire des entrées sécurité

| Action | Entrée |
|---|---|
| Check Conformité GB17859 | ⌘K → "Conformité GB17859 (sécurité chinoise niveau 2.0) · nom connexion" / clic droit connexion → Conformité |
| Scan PII | Clic droit base → PII Scanner |
| Vue masquée | Clic droit base / table → Générer vue masquée |
| Data contracts | ⌘K → "Data contracts" / Outils → Data contracts |
| Export chiffré | Grille / Éditeur SQL → Exporter → `.skbk` |
| Politiques sécurité globales | `Settings → Masquage` / `Settings → Filigrane prod` |
| Raccourcis (anti-misclic) | `Settings → Raccourcis` |

## 13. Limites connues

Au niveau code, à connaître pour DBA :

- **Le SQL Linter est heuristique** : pas de parser complet, peut rater des cas rares (ex. commentaires `/* ... */` imbriqués + `where` dans chaîne littérale). Pour opérations critiques, combinez avec double confirmation prod (saisie du nom de connexion).
- **Conformité requiert les droits de lecture appropriés** : `mysql.user` SELECT, `pg_authid` superuser ; sans droits → `unknown`, **ne pas confondre unknown avec pass**.
- **Masquage rendu seulement côté UI** : la base contient toujours l'original. Pour empêcher l'app de lire l'original, vue masquée + restrictions de privilèges DB.
- **Le fichier chiffré n'empêche pas le bruteforce dictionnaire** : 200k iter PBKDF2 ≈ 10⁷ de coût, un mot de passe faible reste crackable offline. Utilisez un mot de passe fort, ou un KMS / distribution clé publique en équipe.
- **Le marqueur env est une contrainte molle** : `extra.env = 'prod'` est saisi par l'utilisateur ; un slip vers `dev` désactive les protections prod. Standardisez en équipe via "export config → import" entre collègues.
