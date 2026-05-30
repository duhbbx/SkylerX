# Démarrage rapide

Du téléchargement à votre première requête réussie en 5 minutes.

## 1. Télécharger et installer

Rendez-vous sur la [page de téléchargement](/fr/download) pour choisir l'installeur correspondant à votre plateforme :

- **macOS** : fichier `.dmg`, glissez-déposez dans Applications
- **Windows** : assistant `.exe`, cliquez sur Suivant
- **Linux** : `.AppImage` (sans installation, `chmod +x` puis exécution directe), ou `.deb` / `.rpm` (`sudo dpkg -i` / `sudo rpm -ivh`)

Au premier lancement, la base de configuration locale (SQLite, dans le répertoire utilisateur standard de l'OS) est initialisée automatiquement.

## 2. Créer votre première connexion

Lancez l'application → "Nouvelle connexion" en haut à gauche (⌘N / Ctrl+N) → choisissez le dialecte.

### MySQL / PostgreSQL et autres dialectes courants

| Champ | Exemple |
|---|---|
| Nom de connexion | Base de dev locale |
| Dialecte | MySQL |
| Hôte | 127.0.0.1 |
| Port | 3306 (défaut MySQL) |
| Utilisateur | root |
| Mot de passe | (votre mot de passe) |
| Base de données | (optionnel, laissez vide pour choisir après connexion) |
| Marqueur d'environnement | dev / test / prod |

Cliquez sur "Tester la connexion" → puis "Enregistrer" en cas de succès.

### Oracle / locataire OB Oracle

Oracle requiert un Service Name (par défaut `XEPDB1`, le conteneur `gvenzl/oracle-free` utilise `FREEPDB1`) :

| Champ | Exemple |
|---|---|
| Dialecte | Oracle |
| Hôte | 127.0.0.1 |
| Port | 1521 |
| Utilisateur | system |
| Mot de passe | oracle |
| Base de données / Service | FREEPDB1 |
| Avancé → privilege | (vide = normal) ou SYSDBA / SYSOPER etc. |

### Bases de données chinoises (信创)

- **达梦 DM** : port 5236, nécessite le package npm `dmdb` (`pnpm -F @db-tool/desktop add dmdb`)
- **人大金仓 KingbaseES** : port 54321 (défaut), compatible PG, sans driver supplémentaire
- **openGauss** : compatible PG, sans driver supplémentaire
- **OceanBase** : port 2881, utilise mysql2 — le dialecte couvre aussi les locataires Oracle

Détails des champs dans [Gestion des connexions →](/fr/docs/connections)

## 3. Parcourir l'arborescence

Dans la liste, **double-cliquez sur une connexion** → l'arborescence se déploie automatiquement à gauche :

```
📦 Base dev locale (MySQL)
  └── 📁 mydb
       ├── 📁 Tables (12)
       │    ├── users
       │    ├── orders
       │    └── ...
       ├── 📁 Vues (3)
       ├── 📁 Fonctions (1)
       └── 📁 Procédures stockées (0)
```

**Double-cliquer sur une table** → ouvre par défaut la grille de données (SELECT des 200 premières lignes, modifiable dans [Settings → Taille de page par défaut]).

## 4. Écrire et exécuter du SQL

- "Nouvelle requête" dans la barre d'outils ou ⌘T / Ctrl+T pour un nouvel onglet SQL
- Éditeur Monaco avec autocomplétion des tables / colonnes / mots-clés
- ⌘+Enter / Ctrl+Enter pour exécuter (la sélection s'exécute seule si présente)
- Les résultats s'affichent dans la grille en bas

### Quelques raccourcis courants

| Action | macOS | Windows / Linux |
|---|---|---|
| Palette de commandes | ⌘K | Ctrl+K |
| Recherche globale d'objets | ⌘⇧O | Ctrl+Shift+O |
| Exécuter SQL | ⌘+Enter | Ctrl+Enter |
| Formater SQL | ⌘⇧F | Ctrl+Shift+F |
| Basculer panneau IA | ⌘⇧L | Ctrl+Shift+L |
| Nouvelle fenêtre (seconde session) | ⌘⇧N | Ctrl+Shift+N |

Tous les raccourcis sont personnalisables dans `Settings → Raccourcis clavier`.

## 5. Configurer l'assistant IA (optionnel)

`Settings → AI Provider` → ajoutez un provider supporté :

- Anthropic (série Claude)
- OpenAI (GPT-4 / série o1)
- DeepSeek
- Codex
- Grok / xAI

Renseignez votre API Key pour utiliser :
- Panneau de chat à droite (⌘⇧L)
- Complétion en ligne dans l'éditeur (style Copilot)
- Bouton "✨ Demander à l'IA" sur n'importe quelle popup d'erreur pour diagnostiquer
- 7 Toolbox spécialisées (migrations / tuning / lecture EXPLAIN / génération de données de test / langage naturel→SQL / écriture de commentaires / explication d'usage de tables)

## 6. Aller plus loin

- [Éditeur SQL en profondeur](/fr/docs/query) — autocomplétion / bibliothèque de snippets / EXPLAIN
- [Grille de résultats](/fr/docs/grid) — mode édition / filtres / coloration / export
- [Assistant IA](/fr/docs/ai) — configuration provider / système de mémoire / détails des Toolbox
- [Dépannage et compatibilité](/fr/docs/troubleshooting) — diagnostic automatique pour erreurs ORA-xxx / SQLSTATE

## Un problème ?

- Cliquez sur "**✨ Demander à l'IA**" sur n'importe quelle popup d'erreur — envoie automatiquement le SQL + l'erreur + les métadonnées de connexion à l'IA
- Si le problème persiste : [GitHub Issues](https://github.com/duhbbx/SkylerX/issues)
