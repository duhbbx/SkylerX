/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest'
import type { SchemaInput } from '../migrate/convert'
import { chunksFromMarkdown, chunksFromSchema, fingerprint } from './corpus'
import { cosine, lexicalSearch, tokenize, vectorSearch } from './retrieve'
import { buildIndex, formatContext, isStale } from './service'
import { type RagIndex, decodeVec, encodeVec, loadIndex, saveIndex } from './store'

vi.mock('../ai', () => ({
  embedTexts: vi.fn(),
  canEmbed: () => true,
}))
import { embedTexts } from '../ai'

const schema: SchemaInput = {
  tables: [
    {
      schema: 'hr',
      name: 'employee',
      comment: '员工',
      columns: [
        { name: 'id', dataType: 'numeric', nullable: false, comment: '主键' },
        { name: 'name', dataType: 'varchar(50)', comment: '姓名' },
        { name: 'dept_id', dataType: 'numeric' },
      ],
      primaryKey: ['id'],
    },
    {
      schema: 'hr',
      name: 'department',
      comment: '部门',
      columns: [{ name: 'id', dataType: 'numeric', nullable: false }],
      primaryKey: ['id'],
    },
  ],
  foreignKeys: [
    { table: 'employee', columns: ['dept_id'], refTable: 'department', refColumns: ['id'] },
  ],
}

describe('corpus', () => {
  it('one chunk per table with columns, PK, FK, comment', () => {
    const c = chunksFromSchema(schema)
    expect(c.length).toBe(2)
    const emp = c.find((x) => x.ref?.table === 'employee')!
    expect(emp.text).toContain('员工')
    expect(emp.text).toContain('id numeric NOT NULL PK (主键)')
    expect(emp.text).toContain('Foreign keys: dept_id → department.id')
  })
  it('markdown splits by headings', () => {
    const c = chunksFromMarkdown('# A\nbody a\n## B\nbody b')
    expect(c.map((x) => x.title)).toEqual(['A', 'B'])
  })
})

describe('retrieve', () => {
  it('tokenize handles ascii + CJK', () => {
    expect(tokenize('user_id 姓名')).toEqual(['user_id', '姓', '名'])
  })
  it('cosine', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
  })
  it('lexicalSearch ranks by token + title match', () => {
    const chunks = chunksFromSchema(schema)
    const hits = lexicalSearch('姓名 employee', chunks, 5)
    expect(hits[0].chunk.ref?.table).toBe('employee') // title + 姓名 both hit
    expect(hits[0].score).toBeGreaterThan(0)
  })
  it('BM25 IDF: discriminative terms outscore ubiquitous ones', () => {
    const chunks = chunksFromSchema(schema)
    // '部门' is unique to one table (high IDF); 'numeric' is in every table (low IDF)
    const rare = lexicalSearch('部门', chunks, 5)
    const common = lexicalSearch('numeric', chunks, 5)
    expect(rare[0].chunk.ref?.table).toBe('department')
    expect(rare[0].score).toBeGreaterThan(common[0].score) // 区分度高的词得分更高
  })
  it('vectorSearch ranks by cosine', () => {
    const chunks = chunksFromSchema(schema)
    const items = [
      { chunk: chunks[0], vec: [1, 0, 0] },
      { chunk: chunks[1], vec: [0, 1, 0] },
    ]
    const hits = vectorSearch([0.9, 0.1, 0], items, 2)
    expect(hits[0].chunk).toBe(chunks[0])
  })
})

describe('store', () => {
  it('encode/decode vector round-trips (Float32 precision)', () => {
    const v = [0.5, -0.25, 1.5, 0]
    const d = decodeVec(encodeVec(v))
    expect([...d]).toEqual(v)
  })
  it('save / load index', () => {
    const m = new Map<string, string>()
    const s = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, x: string) => void m.set(k, x),
      removeItem: (k: string) => void m.delete(k),
    }
    const idx: RagIndex = {
      key: 'c1',
      builtAt: 1,
      mode: 'lexical',
      chunks: chunksFromSchema(schema),
    }
    expect(saveIndex(idx, s)).toBe(true)
    expect(loadIndex('c1', s)?.chunks.length).toBe(2)
  })
})

describe('service', () => {
  it('formatContext renders titled sections', () => {
    const hits = chunksFromSchema(schema).map((chunk) => ({ chunk, score: 1 }))
    expect(formatContext(hits)).toContain('### hr.employee')
  })
})

describe('buildIndex', () => {
  const mem = () => {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, x: string) => void m.set(k, x),
      removeItem: (k: string) => void m.delete(k),
    }
  }
  it('batches embedding requests (≤64 inputs each) and builds a vector index', async () => {
    vi.stubGlobal('localStorage', mem())
    const calls: number[] = []
    vi.mocked(embedTexts).mockImplementation(async (texts: string[]) => {
      calls.push(texts.length)
      return texts.map(() => [1, 0, 0])
    })
    const many = Array.from({ length: 150 }, (_, i) => ({
      id: `t${i}`,
      kind: 'table' as const,
      title: `t${i}`,
      text: `table ${i}`,
    }))
    const idx = await buildIndex('k', many, { nowMs: 1 })
    expect(idx.mode).toBe('vector')
    expect(idx.vectors).toHaveLength(150)
    expect(calls).toEqual([64, 64, 22]) // 分批,每批 ≤64
    expect(idx.fingerprint).toBeTruthy()
  })
  it('falls back to lexical when embedding throws', async () => {
    vi.stubGlobal('localStorage', mem())
    vi.mocked(embedTexts).mockRejectedValue(new Error('NO_EMBEDDINGS'))
    const idx = await buildIndex('k', chunksFromSchema(schema), { nowMs: 1 })
    expect(idx.mode).toBe('lexical')
    expect(idx.vectors).toBeUndefined()
    expect(idx.fingerprint).toBeTruthy()
  })
})

describe('staleness', () => {
  it('fingerprint is order-independent and content-sensitive', () => {
    const a = chunksFromSchema(schema)
    const b = [...a].reverse()
    expect(fingerprint(a)).toBe(fingerprint(b)) // 顺序无关
    const changed = chunksFromSchema({
      ...schema,
      tables: [{ ...schema.tables[0], comment: '改了注释' }, schema.tables[1]],
    })
    expect(fingerprint(changed)).not.toBe(fingerprint(a)) // 内容变 → 变
  })
  it('isStale: false on unchanged, true on changed, false on legacy (no fingerprint)', () => {
    const chunks = chunksFromSchema(schema)
    const idx: RagIndex = {
      key: 'c',
      builtAt: 1,
      mode: 'lexical',
      chunks,
      fingerprint: fingerprint(chunks),
    }
    expect(isStale(idx, chunks)).toBe(false)
    const changed = chunksFromSchema({
      ...schema,
      tables: [
        ...schema.tables,
        { schema: 'hr', name: 'extra', columns: [{ name: 'x', dataType: 'int' }] },
      ],
    })
    expect(isStale(idx, changed)).toBe(true)
    expect(isStale({ ...idx, fingerprint: undefined }, changed)).toBe(false) // 老索引不误报
  })
})
