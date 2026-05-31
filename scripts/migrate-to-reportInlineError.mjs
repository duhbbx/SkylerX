/*
 * Codemod: migrate inline error-ref assignments to reportInlineError.
 *
 * Pattern (the only one — conservative on purpose):
 *   error.value = e instanceof Error ? e.message : String(e)
 *   anyName.value = id instanceof Error ? id.message : String(id)
 *
 * Becomes:
 *   reportInlineError(anyName, id)
 *
 * Other shapes (validation strings, t(...) wrappers) are left untouched —
 * they aren't exception sinks and shouldn't fire toasts.
 *
 * Import injection: add reportInlineError to the existing errorReporter
 * import in the file (the prior toast.error codemod already added a
 * `reportError` import to every file with a previous toast.error site;
 * extend that import to include reportInlineError).
 *
 * Run: node scripts/migrate-to-reportInlineError.mjs
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOTS = [
  path.resolve('packages/ui/src'),
  path.resolve('apps/desktop/src/renderer'),
]

const ERROR_REPORTER_TARGET = path.join(path.resolve('packages/ui/src'), 'errorReporter')

// Matches:  someName.value = ident instanceof Error ? ident.message : String(ident)
// Captures the ref name and the catch identifier (must be the same identifier in all 3 spots).
const PATTERN =
  /([a-zA-Z_$][\w$]*)\.value\s*=\s*([a-zA-Z_$][\w$]*)\s+instanceof\s+Error\s*\?\s*\2\.message\s*:\s*String\(\2\)/g

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

    src = src.replace(PATTERN, (_m, refName, _idName) => {
      return `reportInlineError(${refName}, ${_idName})`
    })

    if (src === before) continue

    // Ensure reportInlineError is imported.
    const existingImport = src.match(/import\s*\{([^}]+)\}\s*from\s+['"][^'"]*errorReporter['"]/)
    if (existingImport) {
      // Add reportInlineError to the existing import (if not already there)
      const names = existingImport[1]
      if (!/\breportInlineError\b/.test(names)) {
        const updated = `import { ${names.trim().replace(/,?\s*$/, '')}, reportInlineError } from`
        src = src.replace(/import\s*\{([^}]+)\}\s*from\s+(['"][^'"]*errorReporter['"])/, `${updated} $2`)
      }
    } else {
      // No existing errorReporter import — add a fresh one.
      const imp = `import { reportInlineError } from '${relativeImport(f)}'`
      if (f.endsWith('.vue')) {
        src = src.replace(/(<script\s+setup[^>]*>\s*\n)/, `$1${imp}\n`)
      } else if (/^import[^\n]*\n/m.test(src)) {
        src = src.replace(/(^(?:import[^\n]*\n)+)/m, `$1${imp}\n`)
      } else {
        src = `${imp}\n${src}`
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
