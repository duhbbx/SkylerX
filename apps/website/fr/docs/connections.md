# Gestion des connexions

## Créer une nouvelle connexion

⌘N / Ctrl+N ou le bouton "Nouvelle connexion" en haut à gauche → ouvre le formulaire.

### Champs de base (tous dialectes)

| Champ | Description |
|---|---|
| Nom de connexion | Pour l'affichage, libre |
| Dialecte | Type de base de données (MySQL / PG / Oracle / ...) |
| Hôte | hostname ou IP |
| Port | Rempli automatiquement selon le dialecte (MySQL 3306 / PG 5432 / Oracle 1521 ...) |
| Utilisateur | Nom d'utilisateur |
| Mot de passe | Laissez vide pour qu'il soit demandé à la première connexion |
| Base de données | Base / schema par défaut, optionnel |
| Groupe | Dossier au niveau racine de l'arborescence, utile pour gérer plusieurs environnements |
| Marqueur d'environnement | dev / test / prod — prod déclenche la [protection production](#protection-production) |

### Champs spécifiques au dialecte

#### Oracle / locataire OB Oracle

| Champ | Description |
|---|---|
| Service Name | Par défaut XEPDB1, le conteneur `gvenzl/oracle-free` utilise FREEPDB1 |
| privilege | SYSDBA / SYSOPER / SYSASM / SYSBACKUP / SYSDG / SYSKM / SYSRAC, vide pour connexion normale |

> **Connexion SYSDBA** Oracle se fait généralement à la racine CDB (`FREE` plutôt que `FREEPDB1`).

#### Snowflake

| Champ | Description |
|---|---|
| Account | Identifiant Snowflake type `xy12345.us-east-1` |
| Warehouse | Entrepôt de calcul |
| Role | Rôle par défaut |
| Schema | Schema par défaut |
| Authenticator | password par défaut, ou `snowflake_jwt` clé privée |
| Private Key Path | Fichier PEM de clé privée (visible en mode JWT) |
| Private Key Passphrase | Passphrase de la clé privée (si applicable) |

#### MongoDB

Mode **URI direct** optionnel : `mongodb://user:pass@host:27017/db?replicaSet=rs0` ; si rempli, ignore host/port/user/password.

#### SQLite / DuckDB

Pas besoin de host/port/user, seulement le **chemin du fichier de base** :
- Bouton "Parcourir…" à côté pour ouvrir le dialogue système de sélection de fichier
- Autorise un nom de fichier inexistant (création automatique d'une nouvelle base)
- Vide → mode mémoire `:memory:` (perdu à la fermeture de l'application)

#### ClickHouse

| Champ | Description |
|---|---|
| URL | URL complète (`https://user:pass@host:8443/...`), si renseignée ignore host/port |
| Show System Databases | Cache par défaut les bases `system` / `information_schema` |

#### Redis

Seulement host/port/password/dbIndex requis. SkylerX déploie automatiquement les 16 bases logiques (db0..db15).

#### H2

Supporte uniquement le **mode PG-server**. H2 doit être lancé avec le paramètre `-pg` :

```bash
java -cp h2-2.x.x.jar org.h2.tools.Server \
  -pg -pgPort 5435 -ifNotExists -baseDir ./data
```

Puis connectez : Host=localhost, Port=5435, User=`sa`, Password=vide.

## Tunnel SSH

Base de données derrière un bastion ? Basculez sur l'onglet **SSH** → activez le tunnel SSH :

- Hôte SSH / port / utilisateur
- Authentification : **mot de passe** ou **clé privée** (`~/.ssh/id_rsa` par exemple) au choix
- Passphrase de la clé privée (si chiffrée)

SkylerX établit automatiquement un tunnel SSH puis se connecte à la base à travers.

## SSL / TLS

Basculez sur l'onglet **SSL** → activez SSL :

- Vérifier le certificat serveur ?
- CA / certificat / clé (collez le PEM ou sélectionnez un fichier)

## Mode Manual Commit (validation manuelle)

`Settings → Mode de validation par défaut global` ou **par connexion → Avancé → Mode de validation** :

- `auto` (par défaut) : chaque SQL est validé immédiatement
- `manual` : l'utilisateur doit explicitement cliquer "Valider / Rollback", SkylerX maintient une connexion longue pour la transaction

Adapté aux scénarios de réparation de données / migrations critiques, **fortement recommandé pour les connexions de production**.

## Tester la connexion

Bouton "Tester la connexion" en bas du formulaire → retour en temps réel :
- ✅ Succès + affichage de la version du serveur + latence aller-retour
- ❌ Échec + code d'erreur + classification automatique ("Connection refused" / "DNS" / "Timeout" / "Auth" / "SSL" etc.) + étapes de dépannage

Sur la popup d'échec, cliquez sur **"✨ Demander à l'IA"** → envoie automatiquement l'erreur + les métadonnées de connexion à l'assistant IA.

## Protection production (`env=prod`)

Les connexions marquées prod bénéficient d'une protection supplémentaire :

- Badge rouge `[prod]` à la racine de l'arborescence
- Lors de l'exécution de `DROP TABLE / DATABASE / INDEX` / `TRUNCATE` / `UPDATE/DELETE` sans WHERE, **demande de saisir le nom de la connexion** pour continuer
- L'IA répond de manière plus prudente sur les connexions prod (style SELECT-only par défaut)

Le marqueur d'environnement est une **configuration purement locale**, n'affecte pas la base de données elle-même.

## Stockage chiffré des mots de passe

Les mots de passe sont chiffrés via le trousseau OS :

- **macOS** : Keychain Access
- **Windows** : DPAPI (basé sur la session utilisateur actuelle)
- **Linux** : Secret Service (GNOME Keyring / KWallet)

Si le trousseau est indisponible, fallback vers l'encodage base64 (clairement marqué du préfixe `plain:`, **avertissement non sécurisé**). **En production, il est fortement recommandé** de garantir la disponibilité du trousseau.

## Gestion des groupes

Chaque connexion peut être placée sous un **groupe** (optionnel), l'arbre racine se replie par groupe :

```
📁 Environnement de développement
   ├── MySQL local
   └── PostgreSQL local
📁 Environnement de test
   └── OceanBase test
📁 Environnement de production  ⚠
   └── prod-mysql [prod]
```

Lors de la création d'une connexion, saisissez le nom du groupe dans le champ correspondant (Entrée pour valider).

## Multi-fenêtres (requêtes parallèles sur plusieurs connexions)

⌘⇧N / Ctrl+Shift+N pour ouvrir une nouvelle fenêtre SPA → charge la même base de configuration, les deux fenêtres se connectent indépendamment, sans interférence.

Idéal pour un scénario "prod à gauche, staging à droite, comparaison".

## Supprimer une connexion

Clic droit sur la connexion → Supprimer → double confirmation → suppression dans SQLite + nettoyage synchrone du Keychain.

La base de données elle-même **n'est pas affectée**, seule la configuration de connexion côté SkylerX disparaît.
