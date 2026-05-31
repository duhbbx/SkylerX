/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Error reporter — captures and formats errors for one-click issue reports.
 *
 * Public surface (Task 3 adds reportError; this file currently exports helpers
 * that reportError will compose).
 *
 * Spec: docs/superpowers/specs/2026-05-31-error-reporter-design.md
 */

import type { Ref } from 'vue'
import { pushReportToast } from './dialog'

export interface EnvSummary {
  appVersion: string
  platform: NodeJS.Platform
  arch: string
  electronVer: string
  nodeVer: string
  chromeVer: string
  locale: string
  timezone: string
  channel: 'github' | 'oss-cn'
  osRelease: string
}

export interface Callsite {
  file: string
  function: string | undefined
  line: number | undefined
}

export interface ErrorReport {
  message: string
  stack: string | undefined
  callsite: Callsite
  tag: string | undefined
  args: Record<string, unknown> | undefined
  env: EnvSummary
  /** ISO 8601 capture moment. */
  timestamp: string
}

// ── redact ────────────────────────────────────────────────────────────
const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'apisecret',
  'privatekey',
  'passphrase',
  'authorization',
  'sessionid',
  'cookie',
])

/**
 * Deep-walk a value and replace values whose keys match SENSITIVE_KEYS with '***'.
 * Depth-capped at 8 to defuse cyclic refs without needing a WeakSet.
 */
export function redact(value: unknown): unknown {
  return redactImpl(value, 0)
}

function redactImpl(value: unknown, depth: number): unknown {
  if (depth > 8) return '[deep object]'
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redactImpl(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '***' : redactImpl(v, depth + 1)
  }
  return out
}

// ── captureCallsite ───────────────────────────────────────────────────
/**
 * Parse the top business frame out of a V8 stack string.
 * Assumes the caller has already removed the errorReporter's own frames
 * (or that this function is called with `new Error().stack` from inside
 * reportError, in which case lines[2] is the first business frame).
 *
 * V8 format:
 *   Error
 *       at functionName (file:line:col)
 *       at file:line:col       (anonymous)
 */
export function captureCallsite(stack: string | undefined): Callsite {
  if (!stack) return { file: 'unknown', function: undefined, line: undefined }
  const lines = stack.split('\n')
  // Skip 'Error' (lines[0]) and reportError itself (lines[1]); pick [2].
  const frame = lines[2] ?? ''
  // Try named-function form: 'at FUNC (FILE:LINE:COL)'.
  // The function token tolerates spaces inside class-method forms like
  // 'new Connection' or 'Object.<anonymous>' so V8 constructor frames don't
  // fall through to the anonymous regex (which would treat "new Connection (pg.ts"
  // as the file).
  const named = frame.match(/at\s+(.+?)\s+\((.+?):(\d+):\d+\)/)
  if (named) {
    return { function: named[1], file: shortenPath(named[2]), line: Number(named[3]) }
  }
  // Fall back to anonymous form: 'at FILE:LINE:COL'
  const anon = frame.match(/at\s+(.+?):(\d+):\d+/)
  if (anon) {
    return { function: undefined, file: shortenPath(anon[1]), line: Number(anon[2]) }
  }
  return { file: 'unknown', function: undefined, line: undefined }
}

function shortenPath(p: string): string {
  // Vite serves dev modules under URLs like 'http://localhost:5174/src/foo.vue'.
  // Strip the path prefix; we only want the leaf for display.
  const last = p.split(/[/\\]/).pop() ?? p
  // Strip query string Vite appends in dev (?t=12345)
  return last.replace(/\?.*$/, '')
}

// ── formatMarkdown ────────────────────────────────────────────────────
const PLATFORM_NAMES: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
}

/**
 * Render an ErrorReport as GitHub-friendly Markdown.
 * Empty sections (no tag, no args, no stack) are omitted so the output stays clean.
 *
 * Known limitation: if r.message or r.stack contains a literal triple-backtick,
 * the fenced code block breaks (rare in practice — most DB driver output
 * doesn't echo markdown). Out of scope for v1.
 */
export function formatMarkdown(r: ErrorReport): string {
  const sections: string[] = []

  // --- Error ---
  sections.push('## Error\n')
  sections.push('```')
  sections.push(r.message)
  sections.push('```\n')

  const callsiteParts = [`\`${r.callsite.file}\``]
  if (r.callsite.function) callsiteParts.push(`\`${r.callsite.function}\``)
  if (r.callsite.line !== undefined) callsiteParts.push(`\`${r.callsite.line}\``)
  sections.push(`**Callsite**: ${callsiteParts.join(' · ')}`)

  if (r.tag) sections.push(`**Tag**: \`${r.tag}\``)

  if (r.args && Object.keys(r.args).length > 0) {
    sections.push('\n**Args** (sensitive fields redacted):\n')
    sections.push('```json')
    sections.push(JSON.stringify(r.args, null, 2))
    sections.push('```')
  }

  if (r.stack) {
    sections.push('\n**Stack**:\n')
    sections.push('```')
    sections.push(r.stack)
    sections.push('```')
  }

  // --- Environment ---
  sections.push(formatEnvBlock(r.env, r.timestamp))

  return sections.join('\n')
}

/**
 * Render just the Environment block — same shape formatMarkdown emits, but
 * standalone so other UI paths (e.g. "submit issue with context" link in
 * the about modal) can pre-populate a fresh issue without faking an error.
 */
export function formatEnvBlock(env: EnvSummary, timestamp?: string): string {
  const platformName = PLATFORM_NAMES[env.platform] ?? env.platform
  const lines: string[] = ['\n## Environment\n']
  lines.push(`- SkylerX: **v${env.appVersion}** (channel: \`${env.channel}\`)`)
  lines.push(`- OS: ${platformName} ${env.osRelease} (${env.arch})`)
  lines.push(`- Electron: ${env.electronVer} · Node: ${env.nodeVer} · Chrome: ${env.chromeVer}`)
  lines.push(`- Locale: ${env.locale} · Timezone: ${env.timezone}`)
  lines.push(`- Captured at: ${timestamp ?? new Date().toISOString()}`)
  return lines.join('\n')
}

/**
 * Read the currently cached EnvSummary (null if boot prefetch hasn't
 * finished yet). The "Submit Issue" link uses this to populate the
 * clipboard without needing another IPC round-trip.
 */
export function getEnvCache(): EnvSummary | null {
  return envCache
}

// ── reportError public API + env cache ──────────────────────────────

export interface ReportOpts {
  args?: Record<string, unknown>
  tag?: string
  callsite?: Callsite
}

let envCache: EnvSummary | null = null

/** Renderer calls this once on boot with the IPC result. */
export function primeEnvCache(env: EnvSummary): void {
  envCache = env
}

/** Test-only escape hatch. Do not call from production code. */
export function __resetEnvCacheForTests(): void {
  envCache = null
}

const ENV_UNAVAILABLE: EnvSummary = {
  appVersion: 'unknown',
  platform: 'linux',
  arch: 'unknown',
  electronVer: 'unknown',
  nodeVer: 'unknown',
  chromeVer: 'unknown',
  locale: 'unknown',
  timezone: 'unknown',
  channel: 'github',
  osRelease: 'unknown',
}

/**
 * Replace toast.error() at every call site.
 *
 * Behaviour:
 * - e: Error → carry message + stack as-is.
 * - e: string | other → wrap into new Error(String(e)); stack will be the wrap site.
 * - Captures the immediate business caller via new Error().stack frame [2].
 * - Redacts opts.args before formatting.
 * - Pushes a danger toast with callsite + report.markdown attached.
 * - If env cache is not yet primed, the markdown still renders but with a
 *   one-line "environment metadata not available yet" placeholder so the
 *   report is never blocked on boot races.
 */
export function reportError(e: unknown, opts: ReportOpts = {}): void {
  const err = e instanceof Error ? e : new Error(String(e))
  const callsite = opts.callsite ?? captureCallsite(new Error().stack)
  const env = envCache
  const args = opts.args ? (redact(opts.args) as Record<string, unknown>) : undefined

  const report: ErrorReport = {
    message: err.message,
    stack: err.stack,
    callsite,
    tag: opts.tag,
    args,
    env: env ?? ENV_UNAVAILABLE,
    timestamp: new Date().toISOString(),
  }
  let markdown = formatMarkdown(report)
  if (!env) {
    markdown += '\n\n> _Note: environment metadata not available yet (boot race)._'
  }

  pushReportToast(err.message, 10_000, { callsite, report: { markdown } })

  // Mirror to console for dev-tools log copy.
  console.error('[reportError]', err, { callsite, tag: opts.tag, args })
}

/**
 * Convenience wrapper for the very common "catch (e) and surface in two places"
 * pattern: assigns a human-readable message into an inline error Ref (so the
 * component's existing error banner / inline display keeps working) AND fires
 * a full `reportError` toast (so the user gets callsite + copy-as-markdown).
 *
 * Behaviour:
 *   reportInlineError(errorRef, e, opts?)
 *     errorRef.value = (e instanceof Error ? e.message : String(e))
 *     reportError(e, opts)
 *
 * Use at every `try/catch` site where the component shows an inline error
 * banner. The toast is incremental on top — the inline banner remains the
 * primary in-context feedback, the toast adds the issue-report metadata.
 *
 * Do NOT use for validation feedback (e.g. "please fill required field" —
 * not an exception). Those should keep using `errorRef.value = 't(...)'`
 * directly with no toast.
 */
export function reportInlineError(
  errorRef: Ref<string | null | undefined>,
  e: unknown,
  opts?: ReportOpts,
): void {
  errorRef.value = e instanceof Error ? e.message : String(e)
  reportError(e, opts)
}
