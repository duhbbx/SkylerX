---
title: Télécharger SkylerX
description: Installeurs pour toutes les plateformes (macOS / Windows / Linux), multi-architecture x64 + arm64
---

# Télécharger SkylerX

<DownloadButton />

::: tip Sélection automatique de la source
Depuis la Chine continentale, Hong Kong ou Macao, la page bascule automatiquement sur le **miroir Aliyun OSS** (nœud de Shanghai), bien plus rapide que GitHub ; les utilisateurs hors de Chine utilisent **GitHub Releases**. Le sélecteur en haut de la matrice ci-dessous permet de changer manuellement et de mémoriser le choix.
:::

<DownloadMatrix />

## Prérequis système

| Plateforme | Version minimale | Recommandée |
|---|---|---|
| **macOS** | 10.13 (High Sierra) | 12+ (Monterey ou plus récent) |
| **Windows** | 10 | 11 |
| **Linux** | glibc 2.28+ (Ubuntu 20.04 / Debian 11 / CentOS 8 et équivalents) | Ubuntu 22.04+ |

**Architecture** : support double x64 (Intel / AMD) et arm64 (Apple Silicon / serveurs ARM / Surface Pro X).

## Environnements 信创 (souveraineté chinoise)

Compatibilité avec les systèmes d'exploitation chinois suivants (utilisez `.deb` / `.rpm` / `.AppImage`) :

| Système | Format recommandé |
|---|---|
| **银河麒麟** / **中标麒麟** | `.rpm` |
| **统信 UOS** | `.deb` |
| **Ubuntu Kylin** / **优麒麟** | `.deb` |
| **openEuler** | `.rpm` |
| **Deepin** | `.deb` |
| **红旗 Linux** | `.rpm` |
| **龙芯 LoongArch** | Pas de build officiel pour l'instant, contactez l'équipe entreprise pour une compilation sur mesure |

## Mise à jour

SkylerX intègre une **mise à jour automatique** (basée sur electron-updater). À chaque ouverture, l'application vérifie les nouvelles versions et propose de télécharger et installer.

Pour désactiver, décochez "Vérifier automatiquement les mises à jour" dans `Settings → Mise à jour`.

::: warning Utilisateurs Windows — La mise à jour de v0.5.0-rc1 / rc2 vers rc3+ nécessite une intervention manuelle ponctuelle
Les anciennes versions (rc1/rc2) du updater vérifient strictement `publisherName`. Or, depuis v0.5.0-rc3, la vérification de signature a été temporairement levée (en attendant l'approbation de SignPath Foundation), ce qui provoque l'erreur `not signed by the application owner` lors de la mise à jour automatique.

**Opération manuelle ponctuelle** : téléchargez le setup.exe ou portable.exe rc3+ correspondant à votre plateforme dans le tableau ci-dessous, et installez par-dessus (la configuration est préservée). Les mises à jour automatiques fonctionneront ensuite normalement.

Une fois l'approbation SignPath Foundation obtenue, la signature EV + vérification stricte seront restaurées, et plus aucune étape manuelle ne sera nécessaire.
:::

## Versions précédentes

[Voir toutes les versions sur GitHub Releases →](https://github.com/duhbbx/SkylerX/releases)

## Signature de code / Code Signing

Les installeurs Windows sont signés numériquement par **[SignPath Foundation](https://signpath.org/)** — une organisation à but non lucratif qui fournit gracieusement la signature de code aux projets open source.

> Code signing for this project is provided by the [SignPath Foundation](https://signpath.org/), free of charge.

This means:
- Windows users won't see SmartScreen "unknown publisher" warnings
- The installer's authenticity can be verified through standard certificate chain checks
- `electron-updater` enforces publisher name matching on every update

The Foundation issues an EV (Extended Validation) code-signing certificate to qualifying open-source projects. SkylerX is grateful for their support of the open-source community.

## Vérifier l'intégrité des installeurs

Chaque Release est accompagnée d'un fichier `SHA256SUMS.txt` ; pour vérifier après téléchargement :

```bash
# macOS / Linux
shasum -a 256 SkylerX-0.5.0-arm64.dmg
# Ou comparez avec la valeur dans SHA256SUMS.txt sur la page Releases

# Windows PowerShell
Get-FileHash SkylerX-0.5.0-x64-setup.exe -Algorithm SHA256
```

## Un problème ?

- **GitHub trop lent depuis la Chine** : cette page bascule automatiquement sur le miroir Aliyun OSS (sélecteur en haut) ; ou utilisez un miroir d'accélération comme `https://github.akams.cn/` en préfixe d'URL GitHub
- **Miroir OSS lent ou téléchargement coupé** : cliquez "🌐 GitHub" en haut pour repasser sur la source originale, ou accédez directement à <https://skylerx-build.oss-cn-shanghai.aliyuncs.com/releases/latest/> avec un gestionnaire de téléchargement (IDM / Aria2, etc.) supportant la reprise
- **Installation échouée** : voir [Documentation de dépannage →](/fr/docs/troubleshooting)
- **macOS affiche « impossible de vérifier le développeur »** : clic droit sur l'application → Ouvrir → confirmer ; ou dans `Réglages système → Confidentialité et sécurité`, cliquez "Ouvrir quand même"

## Licence

[Apache License 2.0](https://github.com/duhbbx/SkylerX/blob/main/LICENSE) — application desktop entièrement open source, usage commercial gratuit.
