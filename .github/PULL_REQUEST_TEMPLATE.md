<!--
This template is auto-loaded when you open a PR. Delete sections that don't apply.
Subject line guideline: conventional commits, e.g. `feat(driver): add cassandra dialect`.
-->

## Summary

<!-- 1–3 sentences: what changes, and *why*. The diff shows *what*. -->

## Refs

<!-- Replace with `Refs #N` for related issues. DO NOT use `Closes #N` / `Fixes #N` — owner closes after verification. -->
Refs #

---

## Manual test (author fills)

> A ✅ without evidence does NOT count. For each section: screenshot, recording, or copy-pasted SQL/log output. If something genuinely isn't testable, write *why*.

### Setup
- Branch / commit:
- OS:
- Database / driver under test (if any):

### Happy path
- [ ] Steps:
  1.
  2.
- [ ] Expected:
- [ ] Actual:
- [ ] **Evidence**: <!-- drop screenshot, screen recording, or SQL log here. REQUIRED for UI changes. -->

### Edge cases I checked
- [ ] _case_ → evidence:
- [ ] _case_ → evidence:

### Regressions I looked for
- [ ] _flow that could break_ → still works (evidence):
- [ ] _flow that could break_ → still works (evidence):

## Automated checks

- [ ] `pnpm typecheck` — passes
- [ ] `pnpm test` — passes locally (CI re-runs)
- [ ] `pnpm lint` — clean (or `pnpm format` applied)
- [ ] Added / updated unit tests where it made sense (see [CONTRIBUTING.md](../CONTRIBUTING.md#testing))

## Anything reviewer should know

<!--
- Backwards-incompatible decisions
- Skipped work + why
- Follow-up issues you plan to file
-->

---

## Reviewer verification (reviewer fills BEFORE clicking Approve)

> Don't trust the author's ✅ alone. Pull the branch, rerun at least 2 random items from "Manual test", and spot-check one thing the author didn't mention.

- [ ] I pulled the branch and ran it locally (or have a strong reason not to — state it)
- [ ] I reran at least **2 random items** from the author's Manual test
  - Item 1:
  - Item 2:
- [ ] I checked one thing the author did **not** mention (regression spot-check):
- [ ] Evidence (screenshot / recording / brief note):

<!-- If this PR is docs-only or pure typo fix, you may skip Reviewer verification. State that explicitly. -->
