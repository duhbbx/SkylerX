---
title: Tests et qualité
description: Modèle qualité à deux couches de SkylerX — tests unitaires automatisés + checklists manuelles couvrant chaque base et chaque fonction.
---

# Tests et qualité

**Deux couches. L'une tourne à chaque commit ; l'autre est manuelle avant chaque release. Les deux sont open source, visibles sur GitHub.**

## En bref

| Couche | Outils | Quand | Où trouver |
|---|---|---|---|
| **Tests unitaires** | Vitest | Chaque push / PR via GitHub Actions CI | `packages/**/src/**/*.test.ts` — 15+ fichiers : génération SQL, parsing EXPLAIN, schema diff, chiffrement round-trip, mapping Oracle→DM |
| **Checklists manuelles** | Cases Markdown + Preuve (capture / log SQL) | Auto-test sur PR + smoke pré-release, modèles auto-remplis dans PRs / issues | [`docs/qa/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa) — 30+ checklists, ~6000 lignes |

## Couche 1 — Tests unitaires

Chaque commit déclenche le CI :

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm lint`

Les PRs au rouge ne peuvent pas être fusionnés dans `main`.

**Couvre** : logique pure — génération DDL multi-dialecte, parsing EXPLAIN, schema diff, traduction Oracle→DM, chiffrement settings, couverture i18n, règles linter SQL.

**Ne couvre pas** : rendu des composants Vue, interactions BD réelles, raccourcis cross-OS, auto-update — ça va dans Couche 2.

Voir : [`packages/ui/src/*.test.ts`](https://github.com/duhbbx/SkylerX/tree/main/packages/ui/src) · [GitHub Actions](https://github.com/duhbbx/SkylerX/actions/workflows/ci.yml)

## Couche 2 — Checklists manuelles

Toutes en Markdown, **Preuve obligatoire** — un ✅ doit être adossé à une capture / log SQL / enregistrement. Workflow :

- **Ouvrir une PR** → GitHub auto-remplit `Manual test` + `Reviewer verification` ; l'auteur coche durant son auto-test avec preuves. Le reviewer doit pull la branche et re-jouer ≥2 items aléatoires avant d'approuver
- **Avant une release** → ouvrir une [🚦 Release Smoke issue](https://github.com/duhbbx/SkylerX/issues/new/choose) ; le modèle pré-remplit le smoke. Tout vert ou liens vers issues de bug avant de tagger

### Organisation

- [`RELEASE_SMOKE.md`](https://github.com/duhbbx/SkylerX/blob/main/docs/qa/RELEASE_SMOKE.md) — smoke pré-release ~15 min
- [`driver-matrix.md`](https://github.com/duhbbx/SkylerX/blob/main/docs/qa/driver-matrix.md) — matrice 22 dialectes
- [`features/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/features) — 13 checklists par fonctionnalité
- [`databases/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/databases) — 16 checklists approfondies par dialecte

### Ce que couvre chaque fichier par dialecte

Connection · Database/schema · Tables · Indexes · Views · Constraints · Functions / Stored procs · Triggers · Sequences · **Users · Roles · Grants** · DML/Query · Transactions · Quirks spécifiques · Cross-platform · Known limitations.

## Modèles qui laissent une trace

- [`PULL_REQUEST_TEMPLATE.md`](https://github.com/duhbbx/SkylerX/blob/main/.github/PULL_REQUEST_TEMPLATE.md) — Manual test + Reviewer verification + Evidence
- [`50_release_smoke.yml`](https://github.com/duhbbx/SkylerX/blob/main/.github/ISSUE_TEMPLATE/50_release_smoke.yml) — issue smoke par release
- [`CODEOWNERS`](https://github.com/duhbbx/SkylerX/blob/main/.github/CODEOWNERS) — chemins critiques s'assignent automatiquement à un owner

## Ce qu'on ne prétend pas

- **Pas encore de tests UI automatisés** (Playwright dans [ROADMAP](/fr/roadmap) T4)
- **Tests manuels dépendent de la discipline** — Evidence + contre-signature reviewer relèvent le coût du « cocher sans tester »
- **Couverture des BD réelles dépend du tester** — checklists suggèrent docker-compose mais les exécuter reste à la charge du tester

## Participer

- Rapporter un bug : [Bug Report](https://github.com/duhbbx/SkylerX/issues/new/choose)
- Envoyer une PR : suivre le modèle standard ; section Manual test obligatoire
- Ajouter des tests unitaires : voir [`CONTRIBUTING.md`](https://github.com/duhbbx/SkylerX/blob/main/CONTRIBUTING.md)
- Ajouter des checklists : voir [`docs/qa/databases/README.md`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/databases)

---

> **Qualité d'une release ?** [Release Smoke issues](https://github.com/duhbbx/SkylerX/issues?q=label%3A%22type%3A+smoke%22) · **État CI ?** [GitHub Actions](https://github.com/duhbbx/SkylerX/actions) · **Feuille de route ?** [ROADMAP](/fr/roadmap)
