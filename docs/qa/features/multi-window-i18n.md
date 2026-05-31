# Multi-Window + i18n — manual QA

Covers: spawning a second window, independent state, 7-language switch, text-fit / overflow per locale.

> Run when changing: `apps/desktop/src/main/index.ts` (window:newSession), `packages/ui/src/i18n/*`, any UI component that uses `t()`.

## Setup

- Branch / commit:
- OS:

## Multi-window

### Spawn
- [ ] Menu → "New Window" (or `Cmd+Shift+N` / `Ctrl+Shift+N`) → new window opens
- [ ] New window shows same connection list (shared SQLite store)
- [ ] New window has independent state: open different tab / different query → first window unchanged
- [ ] Evidence: screenshot of both windows side-by-side

### Independence
- [ ] Run query A in window 1, query B in window 2 → both execute concurrently
- [ ] No deadlock, no cross-window state leak
- [ ] Evidence: paste both queries + results

### Close
- [ ] Close window 2 → window 1 unaffected (still running, query history intact)
- [ ] Close all windows on macOS → app stays in dock (standard mac behavior)
- [ ] Close all windows on Windows / Linux → app quits
- [ ] Evidence:

### Window persistence (if shipped)
- [ ] Open 3 windows → close all → restart app → restored windows? (check spec — currently NOT restored, that's expected)
- [ ] Evidence:

## i18n — 7 locales

### Switch
- [ ] Settings → Language → pick each in turn:
  - [ ] 简体中文 (zh-CN)
  - [ ] English (en-US)
  - [ ] Español (es-ES)
  - [ ] Français (fr-FR)
  - [ ] 日本語 (ja-JP)
  - [ ] 한국어 (ko-KR)
  - [ ] Português (pt-BR)
- [ ] Each switch: UI text updates immediately (no reload required) OR app prompts to restart (depends on impl)
- [ ] After switch: nav, menu, dialog text all in chosen language
- [ ] Evidence per locale: screenshot of main window

### Persistence
- [ ] Switch to Japanese → close app → reopen → still Japanese
- [ ] Evidence:

### Coverage check (regression for forgotten strings)
For each locale, verify these areas:

| Area | Verify | Status (zh / en / es / fr / ja / ko / pt) |
|---|---|:---:|
| Main menu (File / Edit / View / Window / Help) | all entries translated | [ ] |
| Connection form labels | host / port / user / password / DB / SSL | [ ] |
| Connection dialog buttons | Test / Save / Cancel | [ ] |
| Result grid header context menu | sort / filter / hide / export | [ ] |
| Toast messages | success / error / warning | [ ] |
| AI chat placeholder + buttons | send / stop / clear | [ ] |
| Settings dialog tabs | General / AI / Editor / Linter / Privacy | [ ] |
| Export dialog | format options + buttons | [ ] |
| About dialog | version / website / credits | [ ] |

Mark a cell `X` if **any** string in that area is still in English on that locale (untranslated). One unchecked cell = i18n gap to file.

### Text fit / overflow

Some translations are 2x longer than English. Verify:

- [ ] German-ish long-word locales (de in future) — not yet shipped, skip
- [ ] Spanish / French / Portuguese: button text doesn't overflow, doesn't wrap awkwardly
- [ ] Japanese / Korean: CJK characters use correct font (no fallback to default emoji font)
- [ ] Chinese: same — no font fallback
- [ ] Specifically check:
  - [ ] Sidebar nav items
  - [ ] Toolbar buttons
  - [ ] Modal title bars
  - [ ] Status bar text
- [ ] Evidence: screenshot of each at min window width (940px)

### Number / date formatting

- [ ] Settings → "Use locale formats" toggle
- [ ] On: numbers use `1,234.56` (en) or `1.234,56` (es / fr / de) or `1234.56` (no separator for ja)
- [ ] On: dates use `MM/DD/YYYY` (en-US) or `DD/MM/YYYY` (es / fr / pt) or `YYYY/MM/DD` (ja / ko)
- [ ] Off: ISO 8601 everywhere
- [ ] Evidence:

### Right-to-left (RTL) safety

- [ ] No RTL locale shipped yet (Arabic / Hebrew in long-term roadmap)
- [ ] **But**: verify CSS uses logical properties (`start` / `end`, not `left` / `right`) so future RTL works
- [ ] Inspect CSS via DevTools → grep for `padding-left` / `margin-right` → should be minimal
- [ ] Evidence: console screenshot or grep output

## Multi-window + i18n combination

- [ ] Open window 1 in English → switch to 中文 → does window 1 also switch? (depends on impl — same setting bridge)
- [ ] Open window 2 while window 1 is in 中文 → window 2 boots in 中文 (shared setting)
- [ ] Evidence:

## Cross-platform

- [ ] macOS: menu bar i18n (top of screen) → all menus translated
- [ ] Windows: in-window menu bar i18n → all menus translated
- [ ] Linux: same as Windows
- [ ] System dialog (file picker, confirm) language follows OS, not app — confirm
- [ ] Evidence:

## Known limitations

- Some database error messages come from the DB itself (e.g. PG `ERROR: relation "foo" does not exist`) — NOT translated by app, and that's intentional
- Code editor (Monaco) UI is partially translated (its own i18n bundle), known gaps
- 7 locales is the current set; new locales follow `apps/website/.vitepress/i18n.ts` style with paired translation files
