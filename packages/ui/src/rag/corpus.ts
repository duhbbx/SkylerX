/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * RAG —— 语料(chunk)构建。
 *
 * 把 schema(introspect.readSchema 的输出)和文档拆成可检索的 chunk:每张表一个
 * (表名 + 列 + 类型 + 注释 + 外键),文档按标题分段。chunk 文本既喂 embedding、
 * 也供词法检索;ref 记下来源表,答完能标「引用了哪些表」。纯函数,可单测。
 */
import type { SchemaInput } from '../migrate/convert'

export interface RagChunk {
  id: string
  kind: 'table' | 'doc'
  title: string
  text: string
  ref?: { schema?: string; table?: string }
}

/** 由一个 schema 的结构构建表级 chunk。 */
export function chunksFromSchema(input: SchemaInput): RagChunk[] {
  const out: RagChunk[] = []
  for (const t of input.tables) {
    const cols = t.columns
      .map((c) => {
        const parts = [c.name, c.dataType]
        if (c.nullable === false) parts.push('NOT NULL')
        if (t.primaryKey?.includes(c.name)) parts.push('PK')
        const cmt = c.comment ? ` (${c.comment})` : ''
        return `${parts.join(' ')}${cmt}`
      })
      .join('; ')
    const fks = (input.foreignKeys ?? [])
      .filter((f) => f.table === t.name)
      .map((f) => `${f.columns.join(',')} → ${f.refTable}.${f.refColumns.join(',')}`)
    const lines = [
      `Table ${t.schema}.${t.name}${t.comment ? ` — ${t.comment}` : ''}`,
      `Columns: ${cols}`,
    ]
    if (fks.length) lines.push(`Foreign keys: ${fks.join('; ')}`)
    out.push({
      id: `tbl:${t.schema}.${t.name}`,
      kind: 'table',
      title: `${t.schema}.${t.name}`,
      text: lines.join('\n'),
      ref: { schema: t.schema, table: t.name },
    })
  }
  return out
}

/**
 * 语料指纹:对 chunk 的 id + 文本长度 + 文本做 FNV-1a 32-bit 哈希(顺序无关,排序后算)。
 * 用于陈旧检测:重新 introspect 出新 chunk,指纹变了就说明结构改了、索引该重建。
 */
export function fingerprint(chunks: RagChunk[]): string {
  const parts = chunks.map((c) => `${c.id}:${c.text.length}:${c.text}`).sort()
  let h = 0x811c9dc5
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) {
      h ^= p.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** 由 markdown 文档按 ## 标题分段成 doc chunk(无标题则整段一个)。 */
export function chunksFromMarkdown(md: string, source = 'doc'): RagChunk[] {
  const text = (md ?? '').trim()
  if (!text) return []
  const out: RagChunk[] = []
  const sections = text.split(/\n(?=#{1,6}\s)/)
  for (let i = 0; i < sections.length; i++) {
    const body = sections[i].trim()
    if (!body) continue
    const titleM = /^#{1,6}\s+(.+)$/m.exec(body)
    const title = titleM ? titleM[1].trim() : `${source} #${i + 1}`
    out.push({ id: `doc:${source}:${i}`, kind: 'doc', title, text: body })
  }
  return out
}
