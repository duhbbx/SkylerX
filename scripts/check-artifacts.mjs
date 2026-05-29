#!/usr/bin/env node
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 *
 * CI 预构建检查：扫源码里的 AI/工具流残片（如悬空 </content>、</file>、<<<<<<<），
 * 早一步阻断「本地能跑 / CI vite build 才炸」类问题（见 v0.3.3/v0.3.4 那次事故）。
 *
 * 用法：node scripts/check-artifacts.mjs
 *  - 命中任一标记 → 打印文件:行 + 上下文 → exit 1
 *  - 无命中 → 静默 exit 0
 *
 * 只扫源码目录；产物 / node_modules / .git / 测试 fixture / 此脚本自身 不扫。
 */

import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const SCAN_ROOTS = ['packages', 'apps', 'scripts', 'e2e']
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
  'fixtures',
])
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue', '.json', '.yml', '.yaml'])
const SELF = relative(ROOT, fileURLToPath(import.meta.url))

/** 残片标记：每条 = [正则, 人话原因]；正则会逐行执行。 */
const PATTERNS = [
  [/^<\/content>\s*$/i, '悬空 </content>（AI 工具流尾巴）'],
  [/^<\/file>\s*$/i, '悬空 </file>'],
  [/^<\/document>\s*$/i, '悬空 </document>'],
  [/^<\/output>\s*$/i, '悬空 </output>'],
  [/^<<<<<<<\s/, 'git 合并冲突标记 <<<<<<<'],
  [/^=======\s*$/, 'git 合并冲突标记 ======='],
  [/^>>>>>>>\s/, 'git 合并冲突标记 >>>>>>>'],
]

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
    if (e.isDirectory()) await walk(full, out)
    else if (e.isFile() && SCAN_EXTS.has(extname(e.name)) && relative(ROOT, full) !== SELF) {
      out.push(full)
    }
  }
  return out
}

function extname(name) {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i)
}

async function main() {
  const files = []
  for (const r of SCAN_ROOTS) await walk(join(ROOT, r), files)
  const hits = []
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const [re, why] of PATTERNS) {
        if (re.test(lines[i])) {
          hits.push({ file: relative(ROOT, f), line: i + 1, snippet: lines[i], why })
        }
      }
    }
  }
  if (!hits.length) return
  console.error('✘ 发现源码残片，请清理后再提交：\n')
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  ${h.why}`)
    console.error(`    > ${h.snippet}`)
  }
  console.error(`\n共 ${hits.length} 处。`)
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
