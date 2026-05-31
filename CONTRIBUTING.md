# Contributing to SkylerX

Thank you for considering contributing! This guide covers the basics: project setup, testing, code style, and how to send a PR.

> 中文阅读体验:这份文档与代码风格、PR 流程相关,用英文是为了对所有贡献者友好。中文阅读问题请直接在 [Issues](https://github.com/duhbbx/SkylerX/issues) 提。

---

## Project setup

```bash
# 1) Install (downloads Electron on first run)
pnpm install

# 2) Rebuild native modules for current Electron ABI (one-time, when version bumps)
pnpm --filter @db-tool/desktop rebuild:native

# 3) Run desktop app with HMR
pnpm dev:desktop

# 4) Run docs site with HMR
pnpm dev:website

# 5) Type check everything
pnpm typecheck

# 6) Lint
pnpm lint
pnpm format          # auto-fix
```

---

## Testing

SkylerX uses **Vitest**. Unit tests focus on **pure logic** (SQL generation, EXPLAIN parsing, diff algorithms, masking rules, schema translation, etc.) — not Vue components and not real database calls.

### Where tests live

Co-located with the code: `foo.ts` → `foo.test.ts` in the same directory.

```
packages/ui/src/
  ddl.ts
  ddl.test.ts          ← tests for ddl.ts
  favorites.ts
  favorites.test.ts
  ...
```

Configured glob: `packages/**/src/**/*.test.ts` and `apps/**/src/**/*.test.ts` (see `vitest.config.ts`).

### Writing a test

Copy the pattern from any existing test (e.g. `packages/ui/src/favorites.test.ts`):

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { myFn } from './my-module'

describe('myFn()', () => {
  beforeEach(() => {
    // setup state if needed
  })

  it('produces expected output', () => {
    expect(myFn('input')).toBe('expected')
  })

  it('handles edge: empty input', () => {
    expect(() => myFn('')).toThrow('EMPTY')
  })
})
```

**Good test candidates:**
- Pure functions with branching logic (SQL generators, parsers, type translators)
- Edge cases (null / empty / max-length / unicode)
- Cross-dialect SQL output (one test per dialect)
- Diff / transformation algorithms (`schema-diff`, `data-diff`, `oracleToDm`)

**Skip writing tests for:**
- Vue component rendering (no jsdom in our setup)
- Direct `window.api` IPC calls (needs Electron mock — not worth it for one-liners)
- Real database interactions (use `executeBatch` happy-path testing in QA instead)
- Trivial getters / setters

### Running tests

```bash
# Run everything once
pnpm test

# Watch mode (recommended while writing tests — re-runs on save)
pnpm test:watch

# Only one package
pnpm -F @db-tool/ui test

# Only files matching a pattern
pnpm test -- favorites
pnpm test -- editable.test

# Only a specific it() by name substring
pnpm test -- -t "toggles add"

# Coverage report (open coverage/index.html after)
pnpm test -- --coverage
```

### Verifying tests beyond local

#### A) GitHub CI (every push / PR)

`.github/workflows/ci.yml` runs **on every push to `main` and every PR**:
1. Artifact scan (catches dangling `</content>`, merge conflict markers)
2. Install + rebuild esbuild
3. `pnpm -r typecheck`
4. `pnpm test`  ← **your tests run here**
5. `pnpm lint`

**Check from your terminal:**

```bash
gh pr checks                # status of checks on current PR
gh run watch                # tail latest workflow run live
gh run view --log-failed    # logs of failed steps
```

Or open the PR on GitHub — bottom of the page shows ✅ / ❌ next to `ci / check`.

#### B) Branch protection (recommended for `main`)

Go to repo **Settings → Branches → Add rule** for `main`:

- ✅ Require status checks to pass before merging
- ✅ Require branches to be up to date before merging
- Select check: `ci / check`

Red checks now block merges — no broken `main`.

#### C) Coverage tracking (optional)

Add codecov:

```yaml
# ci.yml (after pnpm test step)
- run: pnpm test -- --coverage
- uses: codecov/codecov-action@v4
  with:
    files: coverage/lcov.info
    token: ${{ secrets.CODECOV_TOKEN }}
```

README badge:

```markdown
[![codecov](https://codecov.io/gh/duhbbx/SkylerX/branch/main/graph/badge.svg)](https://codecov.io/gh/duhbbx/SkylerX)
```

### Common testing patterns in this repo

| Pattern | Example file |
|---|---|
| SQL string generation per dialect | `packages/ui/src/ddl.test.ts` |
| Type translation tables | `packages/ui/src/oracleToDm.test.ts` |
| Schema / data diff | `packages/ui/src/schema-diff.test.ts`, `data-diff.test.ts` |
| Masking / privacy rules | `packages/ui/src/privileges.test.ts` |
| Editable grid → DML | `packages/ui/src/editable.test.ts` |
| Encryption round-trip | `packages/ui/src/export-encrypt.test.ts` |
| i18n key coverage | `packages/ui/src/i18n.test.ts` |

When in doubt, find the closest existing test and copy its shape.

### Mocking `window.api` / IPC

We **don't** currently mock IPC. Anything depending on `window.api.*` is renderer-side glue and tested manually (or via Playwright e2e).

If you need to test pure logic that incidentally calls IPC, refactor: extract the pure part into a helper without IPC, test that. Keep IPC-touching code as thin orchestration.

---

## E2E tests (Playwright, optional)

`pnpm e2e` runs Playwright tests in `e2e/` (currently empty / opt-in). Add scenarios for the most user-visible flows (open app → new connection → run query) if you want stronger regression coverage. CI does not run these by default.

---

## Code style

- **Biome** for lint + format. CI runs `pnpm lint`, locally you can `pnpm format` to auto-fix.
- **TypeScript strict** everywhere.
- **2-space indent**, single quotes, no trailing semicolons (Biome enforces).
- Prefer **named exports**, no `default export` (except Vue components and config files).

---

## Commit / PR rules

- Commit messages: **conventional commits** style preferred: `feat(driver): add cassandra dialect`, `fix(grid): bigint serialization`, `docs(readme): clarify install steps`.
- Body in Chinese is fine; subject in English is preferred for GitHub searchability.
- PR title: short, no period. PR body: what / why / how tested.
- **Don't** use `Closes #N` / `Fixes #N` in commit messages — GitHub auto-closes issues on merge; we want maintainers to close after verification. Use `Refs #N` instead.
- After a fix lands, add the issue label `status: needs-verification`. Once verified by the reporter, switch to `status: fix-confirmed`. See [CLAUDE.md](./CLAUDE.md) for the full issue workflow.

---

## Releasing

Tags `v*` trigger `.github/workflows/build-desktop.yml`, which builds macOS / Windows / Linux installers in CI. Maintainers cut releases — contributors don't need to.

---

## Questions?

Open a **Discussion** if you have an architectural question or want feedback on an approach before writing code.
Open an **Issue** if you have a bug to report or a concrete enhancement to propose.
