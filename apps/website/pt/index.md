---
layout: home
title: SkylerX — Ferramenta open source de gerenciamento de banco de dados
titleTemplate: Multiplataforma · Multi-dialeto · Com IA

hero:
  name: SkylerX
  text: Uma ferramenta de gerenciamento<br/>de banco de dados com IA, multiplataforma
  tagline: 17 dialetos SQL + 3 NoSQL · Suporte completo a bancos de dados chineses (信创) · Electron + Vue 3 · Apache 2.0
  image:
    src: /hero-screenshot.png
    alt: Workspace de consulta do SkylerX
  actions:
    - theme: brand
      text: Baixar agora
      link: /pt/download
    - theme: alt
      text: Ver documentação
      link: /pt/docs/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/duhbbx/SkylerX

features:
  - icon: 🧠
    title: Múltiplos assistentes de IA
    details: Troque livremente entre Anthropic / OpenAI / DeepSeek / Codex / Grok; 7 Toolboxes profissionais de IA + autocompletar inline + diagnóstico de saúde
  - icon: 🔌
    title: Mais de 20 dialetos
    details: Principais SQL + Bancos de dados chineses (信创) (达梦/金仓/openGauss/OceanBase/TiDB) + NoSQL (MongoDB/Redis/ES)
  - icon: 🛡
    title: Proteção de produção
    details: Marcador prod + dupla confirmação para SQL perigoso + motor de regras SQL Linter + mascaramento de dados + Criptografia nacional chinesa SM2/3/4
  - icon: 📊
    title: Resultados visuais
    details: Rolagem virtual + edição + detecção de JSON/BLOB + sparkline em colunas numéricas + coloração condicional
  - icon: 🔍
    title: Visualização de EXPLAIN
    details: Linhas estimadas vs reais, destaque de operadores lentos, opção ANALYZE para execução real
  - icon: 🛠
    title: Caixa de ferramentas DBA
    details: Atividade do servidor / KILL / Análise de logs de slow query / Monitor de atraso de replicação / Recomendação de índices / Detecção de drift de schema
---

<HeroExtra />

## Por que escolher o SkylerX

- **Navicat é pago e não é open source**, com complicações de renovação e ativação na China
- **DataGrip tem assinatura cara**, pouco amigável para desenvolvedores individuais
- **DBeaver é lento e tem UI antiga**, com capacidades de IA limitadas
- **Bancos de dados chineses** (达梦 / KingbaseES / openGauss) têm suporte pouco amigável nas ferramentas mais usadas
- Você quer uma ferramenta que **realmente use IA para escrever SQL / interpretar EXPLAIN / fazer diagnóstico do banco**

Por isso o SkylerX foi reescrito: **open source, gratuito, multiplataforma e pronto para 信创**.

## Principais capacidades

<FeatureGrid />

## Bancos de dados suportados

Cobre 17 dialetos SQL + 3 NoSQL, com suporte completo para **bancos de dados chineses e ambientes 信创**:

<DatabaseGrid />

[Ver matriz completa de bancos de dados →](/pt/databases)

## Começar a usar

```bash
# 1. Baixe o instalador da plataforma correspondente em GitHub Releases
#    macOS .dmg / Windows .exe / Linux .AppImage / .deb / .rpm
open https://github.com/duhbbx/SkylerX/releases/latest

# 2. Instale e inicie o SkylerX

# 3. Nova conexão → escolha o dialeto → preencha host/port/user/password → teste → salve

# 4. Duplo clique na conexão → navegue na árvore → duplo clique na tabela → comece a consultar
```

Tutorial completo em [Início rápido →](/pt/docs/getting-started)

## Sobre / Parcerias comerciais

**Wuhan Skyler Network Technology Co., Ltd.** — desenvolvedora e mantenedora do SkylerX, também aceita projetos de outsourcing e parcerias:

- 🗄 **Consultoria em banco de dados** — escolha / design / tuning / migração (Oracle / SQL Server → MySQL / PG / bancos chineses)
- 🏢 **Implantação como alternativa ao Navicat / DataGrip** — versão privada customizada para empresas
- 🛡 **Implantação em ambiente 信创 / nacional chinês** — 麒麟 / 统信 UOS / 龙芯 / 飞腾 etc.
- 🤖 **Integração de IA** — Gateway LLM / RAG / fluxos de trabalho de Agent / inferência privada
- 📊 **Plataformas de dados** — ETL / data warehouse (ClickHouse / Snowflake / DuckDB)
- 🛠 **DevOps & SRE** — CI/CD / observabilidade / multi-cloud híbrido

Contato: `duhbbx@gmail.com` · WeChat `tuhoooo`
