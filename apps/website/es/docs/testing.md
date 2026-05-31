---
title: Pruebas y calidad
description: Modelo de calidad en dos capas de SkylerX — pruebas unitarias automatizadas + listas de verificación manuales que cubren cada base de datos y cada función.
---

# Pruebas y calidad

**Dos capas. Una se ejecuta en cada commit; otra es manual antes de cada release. Ambas son open source y visibles en GitHub.**

## Resumen

| Capa | Herramientas | Cuándo se ejecuta | Dónde encontrar |
|---|---|---|---|
| **Pruebas unitarias** | Vitest | Cada push / PR vía GitHub Actions CI | `packages/**/src/**/*.test.ts` — 15+ archivos: generación SQL, parseo EXPLAIN, schema diff, cifrado round-trip, mapeo Oracle→DM |
| **Listas manuales** | Checkboxes Markdown + Evidencia (captura / log SQL) | Auto-prueba en PR + smoke pre-release, plantillas se rellenan automáticamente en PRs / issues | [`docs/qa/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa) — 30+ listas, ~6000 líneas |

## Capa 1 — Pruebas unitarias

Cada commit dispara CI:

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm lint`

PRs en rojo no se pueden fusionar en `main`.

**Cubre**: lógica pura — generación DDL multi-dialecto, parseo EXPLAIN, schema diff, traducción Oracle→DM, cifrado de configuración, cobertura i18n, reglas del linter SQL.

**No cubre**: renderizado de componentes Vue, interacción con BD real, atajos cross-OS, auto-update — eso va a Capa 2.

Ver: [`packages/ui/src/*.test.ts`](https://github.com/duhbbx/SkylerX/tree/main/packages/ui/src) · [GitHub Actions](https://github.com/duhbbx/SkylerX/actions/workflows/ci.yml)

## Capa 2 — Listas manuales

Todas las listas son Markdown, **se requiere Evidencia** — un ✅ debe estar respaldado por captura / log SQL / grabación. Flujo:

- **Abrir un PR** → GitHub auto-popula secciones `Manual test` + `Reviewer verification`; autor marca durante auto-prueba con evidencia. El reviewer debe hacer pull y re-correr ≥2 ítems aleatorios antes de aprobar
- **Antes de release** → [🚦 Release Smoke issue](https://github.com/duhbbx/SkylerX/issues/new/choose); la plantilla pre-rellena el smoke. Marcar todo verde o vincular fallos a issues antes de ship

### Organización

- [`RELEASE_SMOKE.md`](https://github.com/duhbbx/SkylerX/blob/main/docs/qa/RELEASE_SMOKE.md) — smoke pre-release ~15 min
- [`driver-matrix.md`](https://github.com/duhbbx/SkylerX/blob/main/docs/qa/driver-matrix.md) — matriz de 22 dialectos
- [`features/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/features) — 13 listas por función
- [`databases/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/databases) — 16 listas profundas por dialecto

### Cada lista por dialecto cubre

Connection · Database/schema · Tables · Indexes · Views · Constraints · Functions / Stored procs · Triggers · Sequences · **Users · Roles · Grants** · DML/Query · Transactions · Quirks específicos · Cross-platform · Known limitations.

## Plantillas que dejan rastro

- [`PULL_REQUEST_TEMPLATE.md`](https://github.com/duhbbx/SkylerX/blob/main/.github/PULL_REQUEST_TEMPLATE.md) — Manual test + Reviewer verification + Evidence
- [`50_release_smoke.yml`](https://github.com/duhbbx/SkylerX/blob/main/.github/ISSUE_TEMPLATE/50_release_smoke.yml) — issue de smoke por release
- [`CODEOWNERS`](https://github.com/duhbbx/SkylerX/blob/main/.github/CODEOWNERS) — rutas críticas auto-asignan a owner

## Lo que no fingimos

- **Sin pruebas UI automatizadas todavía** (Playwright en [ROADMAP](/es/roadmap) Q4)
- **Las pruebas manuales dependen de disciplina** — Evidence + reviewer countersign elevan el coste de marcar sin probar
- **Cobertura de BD real depende del entorno del tester** — listas sugieren docker-compose pero correrlo es decisión del tester

## ¿Quieres ayudar?

- Reportar bug: [Bug Report](https://github.com/duhbbx/SkylerX/issues/new/choose)
- Enviar PR: sigue la plantilla estándar; sección Manual test es obligatoria
- Añadir pruebas unitarias: ver [`CONTRIBUTING.md`](https://github.com/duhbbx/SkylerX/blob/main/CONTRIBUTING.md)
- Añadir listas manuales: ver [`docs/qa/databases/README.md`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/databases)

---

> **Calidad por release?** [Release Smoke issues](https://github.com/duhbbx/SkylerX/issues?q=label%3A%22type%3A+smoke%22) · **Estado CI?** [GitHub Actions](https://github.com/duhbbx/SkylerX/actions) · **Hoja de ruta?** [ROADMAP](/es/roadmap)
