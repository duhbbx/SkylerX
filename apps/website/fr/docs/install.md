# Installation et mise à jour

## macOS

Téléchargez le `.dmg` → double-cliquez pour monter → glissez SkylerX dans Applications → éjectez le disque.

Au premier lancement, vous verrez peut-être "impossible de vérifier le développeur" :
1. Clic droit sur SkylerX → Ouvrir → choisissez "Ouvrir" dans la popup
2. Ou via `Réglages système → Confidentialité et sécurité → Ouvrir quand même`

### Apple Silicon vs Intel

La page de téléchargement détecte automatiquement et recommande la version arm64. Si votre Mac a Rosetta installé, la version x64 fonctionne aussi, mais arm64 est plus rapide nativement et consomme moins de mémoire.

## Windows

Téléchargez l'assistant `.exe` → double-cliquez → cliquez sur Suivant.

**Avertissement SmartScreen** : cliquez sur "Informations complémentaires → Exécuter quand même".

### x64 vs arm64

x64 fonctionne sur toutes les machines Windows ; arm64 est destiné aux Surface Pro X / portables Qualcomm Snapdragon pour éviter la consommation supplémentaire due à l'émulation x64.

## Linux

### AppImage (sans installation, idéal pour usage ponctuel)

```bash
chmod +x SkylerX-0.5.0-x64.AppImage
./SkylerX-0.5.0-x64.AppImage
```

### .deb (Debian / Ubuntu / 统信 UOS / 优麒麟 / Deepin)

```bash
sudo dpkg -i SkylerX-0.5.0-amd64.deb
# En cas de problème de dépendances :
sudo apt-get install -f
```

### .rpm (Fedora / openEuler / 银河麒麟 / 红旗 / 中标麒麟)

```bash
sudo rpm -ivh SkylerX-0.5.0-x86_64.rpm
# Ou avec dnf
sudo dnf install ./SkylerX-0.5.0-x86_64.rpm
```

### .pacman (Arch Linux / Manjaro)

```bash
sudo pacman -U SkylerX-0.5.0-x86_64.pacman
```

### .tar.gz (autres distributions)

```bash
tar -xzf SkylerX-0.5.0-x64.tar.gz
cd SkylerX-0.5.0
./skylerx
# Optionnel : créez un raccourci bureau
```

## Mise à jour automatique

SkylerX embarque `electron-updater` et vérifie les nouvelles versions au démarrage :

1. Téléchargement silencieux en arrière-plan
2. Notification "Redémarrer l'application pour appliquer la mise à jour" une fois terminé
3. L'utilisateur clique pour appliquer la nouvelle version

**Désactiver la mise à jour automatique** : `Settings → Mise à jour → décocher "Vérifier automatiquement les mises à jour"` ou lancer avec la variable d'environnement `SKYLERX_DISABLE_AUTOUPDATE=1`.

## Emplacement des données

La base de configuration locale de SkylerX (SQLite) est stockée dans le répertoire utilisateur standard de l'OS :

| Plateforme | Chemin |
|---|---|
| macOS | `~/Library/Application Support/@db-tool/desktop/db-tool.db` |
| Windows | `%APPDATA%\@db-tool\desktop\db-tool.db` |
| Linux | `~/.config/@db-tool/desktop/db-tool.db` |

Y sont stockés :
- Configurations de connexion (mots de passe chiffrés via le trousseau OS)
- Historique des requêtes SQL
- Bibliothèque de snippets SQL
- Favoris
- Mémoire IA
- Préférences utilisateur

**Conseil de sauvegarde** : copiez régulièrement tout le répertoire `@db-tool/desktop` sur OneDrive / iCloud / NAS.

## Désinstallation

### macOS
Glissez SkylerX dans la corbeille → optionnellement nettoyez `~/Library/Application Support/@db-tool/`

### Windows
Panneau de configuration → Programmes et fonctionnalités → SkylerX → Désinstaller → optionnellement nettoyez `%APPDATA%\@db-tool\`

### Linux
```bash
sudo apt remove skylerx        # installé via .deb
sudo rpm -e skylerx            # installé via .rpm
rm -f ~/.config/@db-tool       # configuration (optionnel)
```

## Mise à jour

Mise à jour automatique dans l'app → redémarrage et c'est fait. Vous pouvez aussi télécharger manuellement le nouvel installeur et installer par-dessus. **La base de configuration est conservée**, compatible entre versions.

## Environnements 信创 (souveraineté chinoise)

Compatibilité avec les systèmes d'exploitation chinois suivants :

- **银河麒麟 / 中标麒麟** : recommandé `.rpm`
- **统信 UOS** : recommandé `.deb`
- **Ubuntu Kylin 优麒麟** : recommandé `.deb`
- **openEuler** : recommandé `.rpm`
- **Deepin** : recommandé `.deb`

**龙芯 LoongArch / 飞腾** : pas de build officiel pour l'instant, pour un besoin spécifique veuillez nous contacter en [partenariat entreprise](mailto:duhbbx@gmail.com) pour une compilation personnalisée.
