---
layout: home
title: SkylerX — Open-source database management tool
titleTemplate: Cross-platform · Multi-dialect · AI-powered

hero:
  name: SkylerX
  text: An AI-powered<br/>cross-platform database tool
  tagline: 17 SQL + 3 NoSQL dialects · Full Chinese-vendor stack · Electron + Vue 3 · Apache 2.0
  image:
    src: /hero-screenshot.png
    alt: SkylerX query workspace
  actions:
    - theme: brand
      text: Download
      link: /en/download
    - theme: alt
      text: Read the docs
      link: /en/docs/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/duhbbx/SkylerX

features:
  - icon: 🧠
    title: Multiple AI assistants
    details: Switch freely between Anthropic / OpenAI / DeepSeek / Codex / Grok; 7 pro AI Toolboxes + inline completion + health check
  - icon: 🔌
    title: 20+ dialects
    details: Mainstream SQL + Chinese vendors (DM/KingbaseES/openGauss/OceanBase/TiDB) + NoSQL (MongoDB/Redis/ES)
  - icon: 🛡
    title: Production safeguards
    details: prod tags + dangerous-SQL double confirm + SQL Linter rule engine + data masking + SM2/3/4 Chinese crypto
  - icon: 📊
    title: Rich result grid
    details: Virtual scroll + editable + JSON/BLOB detection + sparklines on numeric columns + conditional coloring
  - icon: 🔍
    title: EXPLAIN visualizer
    details: Estimated vs actual rows, slow-operator highlighting, optional ANALYZE real run
  - icon: 🛠
    title: DBA toolbox
    details: Server activity / KILL / slow-query log analysis / replication lag / index recommender / schema drift detection
---

<HeroExtra />

## Why SkylerX

- **Navicat** is paid and closed-source, with renewal/activation friction in China
- **DataGrip** subscription is expensive, unfriendly to individual developers
- **DBeaver** feels sluggish, its UI is dated, and AI support is thin
- **Chinese databases** (DM / KingbaseES / openGauss) get poor support in mainstream tools
- We wanted a tool that **actually uses AI to write SQL, read EXPLAIN, and diagnose databases**

So we rewrote one — **open source, free, cross-platform, and ready for Chinese-vendor compliance**.

## Core capabilities

<FeatureGrid />

## Supported databases

Covers 17 SQL + 3 NoSQL dialects, including the **full Chinese-vendor compliance stack**:

<DatabaseGrid />

[See the full database matrix →](/en/databases)

## Get started

```bash
# 1. Grab the installer for your platform from GitHub Releases
#    macOS .dmg / Windows .exe / Linux .AppImage / .deb / .rpm
open https://github.com/duhbbx/SkylerX/releases/latest

# 2. Install and launch SkylerX

# 3. New connection → pick dialect → fill host/port/user/password → test → save

# 4. Double-click the connection → browse the nav tree → double-click a table to open the data grid → start querying
```

Full walkthrough in [Quick Start →](/en/docs/getting-started)

## About / Business inquiries

**Wuhan Skyler Network Technology Co., Ltd.** — the developer and maintainer of SkylerX. We also take on consulting and project work:

- 🗄 **Database consulting** — selection / design / tuning / migration (Oracle / SQL Server → MySQL / PG / Chinese DBs)
- 🏢 **Navicat / DataGrip alternative deployment** — private builds for enterprises
- 🛡 **Chinese-vendor compliance** — Kylin / UnionTech UOS / Loongson / Phytium etc.
- 🤖 **AI integration** — LLM gateways / RAG / agent workflows / private inference
- 📊 **Data platforms** — ETL / data warehouses (ClickHouse / Snowflake / DuckDB)
- 🛠 **DevOps & SRE** — CI/CD / observability / multi-cloud hybrid

Contact: `duhbbx@gmail.com` · WeChat `tuhoooo`
