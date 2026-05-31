/*
 * Codemod: migrate toast.error(...) → reportError(...).
 *
 * Handles the three dominant patterns:
 *   1. toast.error(e instanceof Error ? e.message : String(e))  → reportError(e)
 *   2. toast.error(e.message)                                   → reportError(e)
 *   3. toast.error('literal') / toast.error("literal")          → reportError(new Error('literal'))
 *
 * Imports: if a file has any transformed line, add
 *   import { reportError } from '<relative path to packages/ui/src/errorReporter>'
 * (only if no such import already exists).
 *
 * Run: node scripts/migrate-to-reportError.mjs
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOTS = [
  path.resolve('packages/ui/src'),
  path.resolve('apps/desktop/src/renderer'),
]

const ERROR_REPORTER_TARGET = path.join(path.resolve('packages/ui/src'), 'errorReporter')

const PATTERNS = [
  // 1. toast.error(e instanceof Error ? e.message : String(e))
  [
    /toast\.error\(\s*([a-zA-Z_$][\w$]*)\s+instanceof\s+Error\s*\?\s*\1\.message\s*:\s*String\(\1\)\s*\)/g,
    (_m, id) => `reportError(${id})`,
  ],
  // 2. toast.error(e.message)
  [/toast\.error\(\s*([a-zA-Z_$][\w$]*)\.message\s*\)/g, (_m, id) => `reportError(${id})`],
  // 3. toast.error('literal') / toast.error("literal")  — strings without backticks
  [
    /toast\.error\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*\)/g,
    (_m, q, lit) => `reportError(new Error(${q}${lit}${q}))`,
  ],
]

async function walk(dir, out) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'out') continue
      await walk(p, out)
    } else if (/\.(ts|vue)$/.test(e.name)) {
      out.push(p)
    }
  }
}

function relativeImport(filePath) {
  let rel = path.relative(path.dirname(filePath), ERROR_REPORTER_TARGET)
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel
}

async function main() {
  const files = []
  for (const root of ROOTS) {
    try {
      await walk(root, files)
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
  }
  let touched = 0
  for (const f of files) {
    let src = await fs.readFile(f, 'utf8')
    const before = src
    for (const [re, fn] of PATTERNS) src = src.replace(re, fn)
    if (src === before) continue

    // Ensure import { reportError } is present
    if (!/from\s+['"][^'"]*errorReporter['"]/.test(src)) {
      const imp = `import { reportError } from '${relativeImport(f)}'`
      if (f.endsWith('.vue')) {
        // Inject into <script setup ...> block after the opening tag
        src = src.replace(/(<script\s+setup[^>]*>\s*\n)/, `$1${imp}\n`)
      } else {
        // .ts files: inject after the first existing import block, or at top
        if (/^import[^\n]*\n/m.test(src)) {
          src = src.replace(/(^(?:import[^\n]*\n)+)/m, `$1${imp}\n`)
        } else {
          src = `${imp}\n${src}`
        }
      }
    }

    await fs.writeFile(f, src)
    touched++
    console.log(`updated: ${path.relative('.', f)}`)
  }
  console.log(`\nCodemod done. Updated ${touched} files.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
