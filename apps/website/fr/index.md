---
layout: home
title: SkylerX — Outil open source de gestion de bases de données
titleTemplate: Multiplateforme · Multi-dialecte · Boosté par l'IA

hero:
  name: SkylerX
  text: Un outil de gestion<br/>de bases de données boosté par l'IA, multiplateforme
  tagline: 17 dialectes SQL + 3 NoSQL · Suite complète pour les bases de données chinoises (信创) · Electron + Vue 3 · Apache 2.0
  image:
    src: /hero-screenshot.png
    alt: Espace de travail SkylerX
  actions:
    - theme: brand
      text: Télécharger
      link: /fr/download
    - theme: alt
      text: Documentation
      link: /fr/docs/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/duhbbx/SkylerX

features:
  - icon: 🧠
    title: Plusieurs assistants IA
    details: Permutation libre entre Anthropic / OpenAI / DeepSeek / Codex / Grok ; 7 outils IA spécialisés + complétion en ligne + bilan de santé
  - icon: 🔌
    title: Plus de 20 dialectes
    details: SQL grand public + bases chinoises (达梦/金仓/openGauss/OceanBase/TiDB) + NoSQL (MongoDB/Redis/ES)
  - icon: 🛡
    title: Protection production
    details: Marqueur prod + double confirmation pour SQL dangereux + moteur de règles SQL Linter + masquage de données + Cryptographie nationale chinoise SM2/3/4
  - icon: 📊
    title: Grille de résultats visuelle
    details: Défilement virtuel + édition en ligne + détection JSON/BLOB + sparklines pour colonnes numériques + coloration conditionnelle
  - icon: 🔍
    title: EXPLAIN visualisé
    details: Lignes estimées vs réelles, surlignage des opérateurs lents, mode ANALYZE optionnel pour exécution réelle
  - icon: 🛠
    title: Boîte à outils DBA
    details: Activité serveur / KILL / parsing des slow logs / surveillance du lag de réplication / recommandation d'index / détection de dérive de schéma
---

<HeroExtra />

## Pourquoi choisir SkylerX

- **Navicat est payant et n'est pas open source**, avec les tracas d'activation et de renouvellement en Chine
- **DataGrip est cher en abonnement**, peu adapté aux développeurs indépendants
- **DBeaver est lent avec une interface vieillissante**, et son IA est limitée
- **Les bases chinoises** (达梦 / KingbaseES / openGauss) sont mal supportées par les outils classiques
- On veut un outil qui **utilise vraiment l'IA pour écrire du SQL / interpréter EXPLAIN / auditer la base**

C'est pourquoi SkylerX a été réécrit de zéro : **open source, gratuit, multiplateforme, prêt pour le 信创**.

## Fonctionnalités principales

<FeatureGrid />

## Bases de données supportées

Couvre 17 dialectes SQL + 3 NoSQL, suite complète pour les **bases de données chinoises et environnements 信创** :

<DatabaseGrid />

[Voir la matrice complète des bases de données →](/fr/databases)

## Démarrage

```bash
# 1. Télécharger l'installeur correspondant à votre plateforme depuis GitHub Releases
#    macOS .dmg / Windows .exe / Linux .AppImage / .deb / .rpm
open https://github.com/duhbbx/SkylerX/releases/latest

# 2. Installer et lancer SkylerX

# 3. Nouvelle connexion → choisir le dialecte → renseigner host/port/user/password → tester → enregistrer

# 4. Double-cliquer sur la connexion → parcourir l'arborescence → double-cliquer sur une table pour ouvrir la grille → commencer à requêter
```

Pour le tutoriel complet, voir [Démarrage rapide →](/fr/docs/getting-started)

## À propos / Partenariats commerciaux

**Wuhan Skyler Network Technology Co., Ltd.** — éditeur et mainteneur de SkylerX, propose aussi des prestations de développement sur mesure et de partenariats projet :

- 🗄 **Conseil bases de données** — choix / conception / tuning / migration (Oracle / SQL Server → MySQL / PG / bases chinoises)
- 🏢 **Déploiement de remplaçant à Navicat / DataGrip** — versions privées personnalisées pour entreprises
- 🛡 **Déploiement en environnement 信创 / souveraineté numérique chinoise** — 麒麟 / 统信 UOS / 龙芯 / 飞腾 etc.
- 🤖 **Intégration IA** — passerelle LLM / RAG / workflows agentiques / inférence privatisée
- 📊 **Plateformes data** — ETL / entrepôts de données (ClickHouse / Snowflake / DuckDB)
- 🛠 **DevOps & SRE** — CI/CD / observabilité / multi-cloud hybride

Contact : `duhbbx@gmail.com` · WeChat `tuhoooo`
