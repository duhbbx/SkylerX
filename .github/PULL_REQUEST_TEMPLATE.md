<!--
This template is auto-loaded when you open a PR. Delete sections that don't apply.
Subject line guideline: conventional commits, e.g. `feat(driver): add cassandra dialect`.
-->

## Summary

<!-- 1–3 sentences: what changes, and *why*. The diff shows *what*. -->

## Refs

<!-- Replace with `Refs #N` for related issues. DO NOT use `Closes #N` / `Fixes #N` — owner closes after verification. -->
Refs #

## Manual test

> Tick what you actually verified. If something doesn't apply, delete the line.
> For bug fixes, include the **reproducer** you used so a reviewer can rerun it.

### Setup
- Branch / commit:
- OS:
- Database under test (if applicable):

### Happy path
- [ ] Steps:
  1.
  2.
- [ ] Expected:
- [ ] Result:

### Edge cases I checked
- [ ]
- [ ]
- [ ]

### Regressions I looked for
- [ ]
- [ ]

## Automated checks

- [ ] `pnpm typecheck` — all packages pass
- [ ] `pnpm test` — passes locally (CI re-runs anyway)
- [ ] `pnpm lint` — clean (or `pnpm format` already applied)
- [ ] Added / updated unit tests for the affected logic (see [CONTRIBUTING.md](../CONTRIBUTING.md#testing))

## Screenshots / recording

<!-- For UI changes, attach before/after. For multi-locale changes, show 2-3 locales. -->

## Anything reviewer should know

<!--
- Backwards-incompatible decisions
- Skipped work + why
- Follow-up issues you plan to file
-->
