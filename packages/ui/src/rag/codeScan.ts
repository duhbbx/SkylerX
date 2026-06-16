/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RagChunk } from './corpus'

/** 单文件大小上限(字节):超过的源文件(通常是生成物/压缩文件)跳过,省 token 与噪声。 */
export const MAX_FILE_BYTES = 256 * 1024

/** 纳入索引的扩展名白名单:源码 + SQL + 文档。 */
const ALLOW_EXT = new Set([
  '.java', '.kt', '.py', '.go', '.ts', '.tsx', '.js', '.jsx', '.rb', '.php',
  '.cs', '.scala', '.xml', '.sql', '.md',
])

/** 永远忽略的目录名(任意层级命中即剪枝)。 */
const ALWAYS_IGNORE_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'target', 'vendor', '.next', '.nuxt',
])

export interface IgnoreMatcher {
  ignores(relPath: string): boolean
}

/**
 * 极简 .gitignore:只支持「名字 / 目录/ / *.ext」三类常见规则(够覆盖噪声剪枝)。
 * 不追求 git 完整语义(否定规则 ! / 锚定 / **)——YAGNI,真有需要再加。
 */
export function parseGitignore(text: string): IgnoreMatcher {
  const names = new Set<string>() // 精确名(目录或文件)
  const exts = new Set<string>() // *.ext → '.ext'
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const pat = line.replace(/\/$/, '') // 去尾斜杠
    if (pat.startsWith('*.')) exts.add(pat.slice(1)) // '*.log' → '.log'
    else names.add(pat)
  }
  return {
    ignores(relPath: string): boolean {
      const segs = relPath.split('/')
      if (segs.some((s) => names.has(s))) return true
      const dot = relPath.lastIndexOf('.')
      if (dot >= 0 && exts.has(relPath.slice(dot))) return true
      return false
    },
  }
}

function ext(relPath: string): string {
  const slash = relPath.lastIndexOf('/')
  const base = slash >= 0 ? relPath.slice(slash + 1) : relPath
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

/**
 * 该相对路径的文件是否纳入索引:
 *  - 不在永远忽略目录里、不被 .gitignore 命中
 *  - 扩展名在白名单内、不是 *.min.*、大小不超上限
 */
export function shouldIndexFile(relPath: string, size: number, ig: IgnoreMatcher): boolean {
  const segs = relPath.split('/')
  if (segs.some((s) => ALWAYS_IGNORE_DIRS.has(s))) return false
  if (/\.min\.[a-z]+$/i.test(relPath)) return false
  if (!ALLOW_EXT.has(ext(relPath))) return false
  if (size > MAX_FILE_BYTES) return false
  if (ig.ignores(relPath)) return false
  return true
}

/** 代码分块:按行滑窗(窗口 80 行、重叠 10 行),每块头部带文件路径,便于检索归因。 */
const WINDOW_LINES = 80
const OVERLAP_LINES = 10

export function chunkCode(relPath: string, text: string): RagChunk[] {
  if (!text.trim()) return []
  const lines = text.split(/\r?\n/)
  const out: RagChunk[] = []
  const step = WINDOW_LINES - OVERLAP_LINES
  let i = 0
  for (let start = 0; start < lines.length; start += step) {
    const slice = lines.slice(start, start + WINDOW_LINES).join('\n')
    if (!slice.trim()) continue
    out.push({
      id: `code:${relPath}␟${i}`,
      kind: 'code',
      title: relPath,
      text: `// file: ${relPath}\n${slice}`,
    })
    i++
    if (start + WINDOW_LINES >= lines.length) break
  }
  return out
}
