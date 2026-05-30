---
layout: home
title: SkylerX — Herramienta open source de gestión de bases de datos
titleTemplate: Multiplataforma · Multidialecto · Potenciada por IA

hero:
  name: SkylerX
  text: Una herramienta multiplataforma<br/>de bases de datos con IA
  tagline: 17 dialectos SQL + 3 NoSQL · Suite completa de bases de datos chinas · Electron + Vue 3 · Apache 2.0
  image:
    src: /hero-screenshot.png
    alt: Espacio de trabajo de consultas SkylerX
  actions:
    - theme: brand
      text: Descargar ahora
      link: /es/download
    - theme: alt
      text: Ver documentación
      link: /es/docs/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/duhbbx/SkylerX

features:
  - icon: 🧠
    title: Múltiples asistentes de IA
    details: Cambia libremente entre Anthropic / OpenAI / DeepSeek / Codex / Grok; 7 AI Toolboxes especializados + autocompletado en línea + diagnóstico de salud
  - icon: 🔌
    title: Más de 20 dialectos
    details: Principales SQL + bases de datos chinas (达梦/金仓/openGauss/OceanBase/TiDB) + NoSQL (MongoDB/Redis/ES)
  - icon: 🛡
    title: Protección en producción
    details: Etiqueta prod + doble confirmación para SQL peligroso + motor de reglas SQL Linter + enmascaramiento de datos + cifrado nacional chino SM2/3/4
  - icon: 📊
    title: Resultados visuales
    details: Scroll virtual + edición en línea + detección de JSON/BLOB + sparkline en columnas numéricas + coloreado condicional
  - icon: 🔍
    title: EXPLAIN visual
    details: Filas estimadas vs reales, operadores lentos resaltados, ANALYZE real opcional
  - icon: 🛠
    title: Caja de herramientas DBA
    details: Actividad del servidor / KILL / análisis del log de consultas lentas / monitor de replicación / recomendación de índices / detección de drift de esquema
---

<HeroExtra />

## Por qué elegir SkylerX

- **Navicat es de pago y cerrado**, además del engorro de renovación y activación en China
- **DataGrip tiene una suscripción cara**, poco amigable para desarrolladores individuales
- **DBeaver es lento, su UI está anticuada** y sus capacidades de IA son débiles
- Las **bases de datos chinas** (达梦 / KingbaseES / openGauss) no están bien soportadas en las herramientas principales
- Buscas una herramienta que **realmente use IA para escribir SQL, interpretar EXPLAIN y diagnosticar tu base de datos**

Por eso reescribimos SkylerX desde cero: **open source, gratuito, multiplataforma y listo para el ecosistema chino (信创)**.

## Capacidades principales

<FeatureGrid />

## Bases de datos soportadas

Cubre 17 dialectos SQL + 3 NoSQL, suite completa para **bases de datos chinas y entornos 国产信创**:

<DatabaseGrid />

[Ver matriz completa de bases de datos →](/es/databases)

## Cómo empezar

```bash
# 1. Descarga el instalador de tu plataforma desde GitHub Releases
#    macOS .dmg / Windows .exe / Linux .AppImage / .deb / .rpm
open https://github.com/duhbbx/SkylerX/releases/latest

# 2. Instala e inicia SkylerX

# 3. Nueva conexión → elige dialecto → introduce host/port/user/password → prueba → guarda

# 4. Doble clic en la conexión → explora el árbol → doble clic en una tabla para abrir la cuadrícula de datos → empieza a consultar
```

Tutorial completo en [Guía rápida →](/es/docs/getting-started)

## Acerca de / Colaboración comercial

**Wuhan Skyler Network Technology Co., Ltd.** — desarrolladores y mantenedores de SkylerX, también ofrecemos desarrollo a medida y colaboración en proyectos:

- 🗄 **Consultoría de bases de datos** — selección / diseño / tuning / migración (Oracle / SQL Server → MySQL / PG / bases de datos chinas)
- 🏢 **Despliegue alternativo a Navicat / DataGrip** — versiones privadas personalizadas para empresas
- 🛡 **Despliegues 信创 / localización china** — Kylin / UnionTech UOS / Loongson / Phytium, entre otros
- 🤖 **Integración de IA** — pasarela LLM / RAG / flujos de Agentes / inferencia privada
- 📊 **Plataformas de datos** — ETL / data warehouses (ClickHouse / Snowflake / DuckDB)
- 🛠 **DevOps y SRE** — CI/CD / observabilidad / multi-nube híbrida

Contacto: `duhbbx@gmail.com` · WeChat `tuhoooo`
