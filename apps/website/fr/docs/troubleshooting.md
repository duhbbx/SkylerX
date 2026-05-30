# Dépannage et compatibilité

## Problèmes de connexion courants

### `ECONNREFUSED` — Connexion refusée

- Le processus base de données n'est pas démarré / mauvais port
- Vérifiez : `nc -zv <host> <port>` ou `telnet`
- Conteneur Docker : `docker ps` pour confirmer Up + mapping de ports correct

### `ETIMEDOUT` — Timeout

- Pare-feu / groupe de sécurité / VPN bloque
- Scénario tunnel SSH : bastion inaccessible

### `Authentication failed` — Échec d'authentification

- Nom d'utilisateur / mot de passe erroné
- Problème de compatibilité MySQL `caching_sha2_password` — mettez à jour mysql2 ou utilisez `mysql_native_password`
- PG `pg_hba.conf` n'autorise pas cette origine

### Oracle `ORA-12541: TNS:no listener`

- Le conteneur Oracle n'est pas complètement démarré ou LISTENER non enregistré
- Attendez 1-2 minutes et réessayez
- Vérifiez que le service name est correct (XEPDB1 par défaut, `gvenzl/oracle-free` utilise FREEPDB1)

### Oracle `ORA-00900: invalid SQL statement near 'v'` (en se connectant à OceanBase)

- C'est une caractéristique du **locataire OB Oracle** — la fonction `VERSION()` n'existe pas en mode Oracle
- Corrigé dans SkylerX v0.5+ (utilisation de `SELECT 1 FROM DUAL` pour le ping)
- Anciennes versions : mettez à jour vers la dernière

### Oracle `ORA-01950: insufficient quota on tablespace USERS`

Un nouvel utilisateur Oracle sans quota échoue sur insert / création de table. **Correction** :

```sql
-- Exécuter en SYSDBA
ALTER USER "your_username" QUOTA UNLIMITED ON USERS;
-- Ou de manière plus radicale
GRANT UNLIMITED TABLESPACE TO "your_username";
```

> ⚠️ Oracle met en majuscule les identifiants non quotés par défaut ; si le nom d'utilisateur est en minuscules entre guillemets (`"test"`), les ALTER suivants doivent aussi utiliser les guillemets + la casse originale.

### Impossible d'éditer un ObjectId MongoDB

- Modifier un champ `_id` dans la grille d'édition échoue — après sérialisation IPC l'ObjectId devient une chaîne, le driver ne le wrappe pas automatiquement
- Corrigé dans SkylerX v0.5+ : le driver détecte automatiquement les chaînes 24-hex pour `_id` et les wrappe en ObjectId
- Anciennes versions : pour les collections à clé primaire ObjectId, utilisez temporairement mongosh

## Aide-mémoire des codes d'erreur

### MySQL / MariaDB / TiDB / Doris / StarRocks

| errno | Signification | Causes courantes |
|---|---|---|
| 1045 | Access denied | Utilisateur / mot de passe erroné |
| 1049 | Unknown database | Base de données inexistante |
| 1054 | Unknown column | Nom de colonne erroné |
| 1062 | Duplicate entry | Conflit d'index unique |
| 1064 | SQL syntax error | Erreur de syntaxe |
| 1146 | Table doesn't exist | Table inexistante / mauvaise base |
| 1213 | Deadlock | Interblocage, ré-essayez |
| 1264 | Out of range value | Valeur hors plage du type de colonne |
| 2002 | Can't connect via socket | Hôte / port erroné |
| 2003 | Can't connect to MySQL server | Connexion refusée |
| 2013 | Lost connection during query | Crash serveur / timeout |

### PostgreSQL / dialectes compatibles (KingbaseES / openGauss / CockroachDB / Greenplum / Redshift / H2)

SQLSTATE 5 chiffres :

| code | Signification |
|---|---|
| 23505 | unique violation |
| 23502 | not null violation |
| 23503 | foreign key violation |
| 42P01 | undefined table |
| 42703 | undefined column |
| 42601 | syntax error |
| 28000 | invalid authorization |
| 08001 | unable to connect |
| 40001 | serialization failure (ré-essayer) |
| 53300 | too many connections |

### Oracle / locataire OB Oracle / DM 达梦

Série ORA-xxxxx :

| code | Signification |
|---|---|
| 00900 | invalid SQL statement |
| 00904 | invalid identifier |
| 00911 | invalid character |
| 00942 | table or view does not exist |
| 01017 | invalid username/password |
| 01950 | no privileges on tablespace |
| 12541 | TNS no listener |
| 12514 | service not found |
| 28000 | account locked |

## Performances lentes

### Grand jeu de résultats lent

- Taille de page trop grande ? Descendez à 200-500 lignes, le défilement virtuel s'active automatiquement
- Trop de colonnes ? Masquez les colonnes inutiles (clic droit sur en-tête → masquer)

### Latence réseau élevée

- Connexion distante lente : utilisez un tunnel SSH compressé / bastion à proximité
- IA lente : changez pour un provider à région plus proche (deepseek.com rapide en Chine)

### Démarrage lent de SkylerX

- Vérifiez `Settings → Démarrage` → désactivez "Vérifier automatiquement les mises à jour"
- macOS : `xattr -d com.apple.quarantine /Applications/SkylerX.app` pour retirer l'attribut quarantine

## Sécurité des données / confidentialité

- Mots de passe chiffrés — via le trousseau OS (macOS Keychain / Win DPAPI / Linux Secret Service)
- L'IA **n'envoie pas de données** par défaut, uniquement les schema hints
- Toutes les connexions / historique SQL / snippets / paramètres sont en SQLite local
- Aucune télémétrie / statistique envoyée

## Problèmes de mise à jour courants

### Mise à jour automatique échouée

- Problème réseau : téléchargez manuellement depuis [Releases](https://github.com/duhbbx/SkylerX/releases)
- Problème de permissions : l'application macOS n'a pas les droits d'écriture, réinstallez en administrateur

### Connexions / paramètres perdus après mise à jour

**Ne devrait pas arriver**. Le SQLite local est compatible entre versions. Si cela arrive, **ne supprimez pas le répertoire de données de l'ancienne version** ; ouvrez une [Issue](https://github.com/duhbbx/SkylerX/issues), c'est généralement un problème de migration de chemin.

## Signaler un bug

Si aucune des solutions ci-dessus ne fonctionne :

1. Cliquez sur "**✨ Demander à l'IA**" sur n'importe quelle popup d'erreur pour voir si l'IA peut diagnostiquer
2. Si rien n'y fait → [GitHub Issues](https://github.com/duhbbx/SkylerX/issues/new)
3. Joignez à l'Issue :
   - Version de SkylerX (`Help → About`)
   - OS + version
   - Type de base de données + version
   - Étapes de reproduction
   - Message d'erreur complet

## Partenariats / déploiement privé

- Adaptation profonde aux environnements 信创 (龙芯 / 飞腾 / 鲲鹏)
- Cryptographie nationale chinoise / déploiement Conformité GB17859 (sécurité chinoise niveau 2.0)
- Conseil en migration de bases (Oracle → 达梦 / KingbaseES)
- Versions personnalisées intranet

Contact : `duhbbx@gmail.com` · WeChat `tuhoooo`
