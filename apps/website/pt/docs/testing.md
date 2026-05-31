---
title: Testes e qualidade
description: Modelo de qualidade em duas camadas do SkylerX — testes unitários automatizados + listas de verificação manuais cobrindo cada banco e cada funcionalidade.
---

# Testes e qualidade

**Duas camadas. Uma roda em cada commit; outra é manual antes de cada release. Ambas são open source, visíveis no GitHub.**

## Resumo

| Camada | Ferramentas | Quando roda | Onde encontrar |
|---|---|---|---|
| **Testes unitários** | Vitest | Cada push / PR via GitHub Actions CI | `packages/**/src/**/*.test.ts` — 15+ arquivos: geração SQL, parsing EXPLAIN, schema diff, criptografia round-trip, mapeamento Oracle→DM |
| **Listas manuais** | Checkboxes Markdown + Evidência (captura / log SQL) | Auto-teste em PR + smoke pré-release, modelos auto-preenchidos em PRs / issues | [`docs/qa/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa) — 30+ listas, ~6000 linhas |

## Camada 1 — Testes unitários

Cada commit dispara CI:

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm lint`

PRs vermelhos não podem fazer merge em `main`.

**Cobre**: lógica pura — geração DDL multi-dialeto, parsing EXPLAIN, schema diff, tradução Oracle→DM, criptografia de settings, cobertura i18n, regras do linter SQL.

**Não cobre**: renderização de componentes Vue, interação com BD real, atalhos cross-OS, fluxo de auto-update — vai para Camada 2.

Ver: [`packages/ui/src/*.test.ts`](https://github.com/duhbbx/SkylerX/tree/main/packages/ui/src) · [GitHub Actions](https://github.com/duhbbx/SkylerX/actions/workflows/ci.yml)

## Camada 2 — Listas manuais

Todas em Markdown, **Evidência obrigatória** — um ✅ deve estar lastreado em captura / log SQL / gravação. Fluxo:

- **Abrir PR** → GitHub auto-popula seções `Manual test` + `Reviewer verification`; autor marca durante auto-teste com evidências. Revisor deve dar pull no branch e re-rodar ≥2 itens aleatórios antes de aprovar
- **Antes de release** → [🚦 Release Smoke issue](https://github.com/duhbbx/SkylerX/issues/new/choose); modelo pré-preenche o smoke. Marcar tudo verde ou linkar falhas a issues antes de tagear

### Organização

- [`RELEASE_SMOKE.md`](https://github.com/duhbbx/SkylerX/blob/main/docs/qa/RELEASE_SMOKE.md) — smoke pré-release ~15 min
- [`driver-matrix.md`](https://github.com/duhbbx/SkylerX/blob/main/docs/qa/driver-matrix.md) — matriz de 22 dialetos
- [`features/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/features) — 13 listas por funcionalidade
- [`databases/`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/databases) — 16 listas profundas por dialeto

### Cada arquivo por dialeto cobre

Connection · Database/schema · Tables · Indexes · Views · Constraints · Functions / Stored procs · Triggers · Sequences · **Users · Roles · Grants** · DML/Query · Transactions · Quirks específicos · Cross-platform · Known limitations.

## Modelos que deixam rastro

- [`PULL_REQUEST_TEMPLATE.md`](https://github.com/duhbbx/SkylerX/blob/main/.github/PULL_REQUEST_TEMPLATE.md) — Manual test + Reviewer verification + Evidence
- [`50_release_smoke.yml`](https://github.com/duhbbx/SkylerX/blob/main/.github/ISSUE_TEMPLATE/50_release_smoke.yml) — issue de smoke por release
- [`CODEOWNERS`](https://github.com/duhbbx/SkylerX/blob/main/.github/CODEOWNERS) — caminhos críticos auto-atribuem ao owner

## O que não fingimos

- **Sem testes UI automatizados ainda** (Playwright em [ROADMAP](/pt/roadmap) Q4)
- **Testes manuais dependem de disciplina** — Evidence + contra-assinatura do revisor elevam o custo de "marcar sem testar"
- **Cobertura de BD real depende do ambiente do tester** — listas sugerem docker-compose mas executar é decisão do tester

## Como ajudar

- Reportar bug: [Bug Report template](https://github.com/duhbbx/SkylerX/issues/new/choose)
- Enviar PR: seguir o template padrão; seção Manual test obrigatória
- Adicionar testes unitários: ver [`CONTRIBUTING.md`](https://github.com/duhbbx/SkylerX/blob/main/CONTRIBUTING.md)
- Adicionar listas manuais: ver [`docs/qa/databases/README.md`](https://github.com/duhbbx/SkylerX/tree/main/docs/qa/databases)

---

> **Qualidade por release?** [Release Smoke issues](https://github.com/duhbbx/SkylerX/issues?q=label%3A%22type%3A+smoke%22) · **Status CI?** [GitHub Actions](https://github.com/duhbbx/SkylerX/actions) · **Roteiro?** [ROADMAP](/pt/roadmap)
