#!/usr/bin/env node
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 *
 * 一次性 / 幂等脚本：给项目所有源码文件加 SPDX + 公司署名注释。
 *
 * - 已带「Wuhan Skyler」标记的文件跳过
 * - .ts / .js / .mjs / .cjs：顶部插入块注释；保留 `#!` shebang
 * - .vue：在第一个 <script ...> 开标签后插入 JS 块注释，避免改动 SFC 结构
 * - 跳过 node_modules / dist / out / release / .vite / *.d.ts 生成产物等
 *
 *   pnpm exec node scripts/add-license-header.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const MARKER = 'Wuhan Skyler'
const HEADER_LINES = [
  'Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)',
  'SPDX-License-Identifier: Apache-2.0',
]
const BLOCK_COMMENT = `/*\n * ${HEADER_LINES[0]}\n * ${HEADER_LINES[1]}\n */`

// 扫描根目录（相对 ROOT）
const SCAN_ROOTS = ['packages', 'apps', 'scripts', 'e2e']
// 顶层独立配置文件
const TOP_LEVEL = ['playwright.config.ts', 'vitest.config.ts']

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'out',
  'release',
  '.vite',
  '.turbo',
  '.cache',
  '.git',
  'coverage',
])
const SKIP_FILE_SUFFIX = ['.d.ts'] // 类型声明：通常构建工具生成 / 第三方影子，跳过
const ALLOW_EXTS = new Set(['.ts', '.js', '.mjs', '.cjs', '.vue'])

/** 递归收集要处理的源文件路径 */
async function walk(dir, out = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue
    if (SKIP_DIRS.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      await walk(full, out)
    } else if (e.isFile()) {
      const ext = extname(e.name)
      if (!ALLOW_EXTS.has(ext)) continue
      if (SKIP_FILE_SUFFIX.some((s) => e.name.endsWith(s))) continue
      out.push(full)
    }
  }
  return out
}

/** 在 .vue 文件第一个 <script ...> 开标签之后插入 JS 块注释。 */
function injectVue(src) {
  // 匹配第一个 <script ...> 开标签（允许属性、跨行）
  const m = src.match(/<script\b[^>]*>/)
  if (!m) return null // 没有 script 块，跳过（不动 template-only 文件）
  const insertAt = m.index + m[0].length
  // 始终让注释独占一行，避免老 Biome 在「<script ...>/* */」同一行上解析失败放大错误。
  const after = src.slice(insertAt).replace(/^\n*/, '')
  return `${src.slice(0, insertAt)}\n${BLOCK_COMMENT}\n${after}`
}

/** 给 .ts/.js/.mjs/.cjs 文件加头，保留 shebang 在首行。 */
function injectScript(src) {
  if (src.startsWith('#!')) {
    const nl = src.indexOf('\n')
    if (nl === -1) return `${src}\n${BLOCK_COMMENT}\n`
    return `${src.slice(0, nl + 1)}${BLOCK_COMMENT}\n${src.slice(nl + 1)}`
  }
  return `${BLOCK_COMMENT}\n${src}`
}

async function main() {
  const files = []
  for (const r of SCAN_ROOTS) {
    await walk(join(ROOT, r), files)
  }
  for (const f of TOP_LEVEL) {
    try {
      await stat(join(ROOT, f))
      files.push(join(ROOT, f))
    } catch {
      /* 不存在就算了 */
    }
  }

  let added = 0
  let skipped = 0
  let unchanged = 0

  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    if (src.includes(MARKER)) {
      unchanged++
      continue
    }
    const ext = extname(f)
    let next
    if (ext === '.vue') {
      next = injectVue(src)
    } else {
      next = injectScript(src)
    }
    if (next == null) {
      skipped++
      continue
    }
    writeFileSync(f, next, 'utf8')
    added++
  }

  // 按工作区分组输出
  console.log('---')
  console.log(`Scanned: ${files.length} files`)
  console.log(`Added header:   ${added}`)
  console.log(`Already had it: ${unchanged}`)
  console.log(`Skipped (no <script> in .vue or unsupported): ${skipped}`)
  console.log('Marker:', JSON.stringify(MARKER))
  console.log('Root:', relative(process.cwd(), ROOT) || '.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
