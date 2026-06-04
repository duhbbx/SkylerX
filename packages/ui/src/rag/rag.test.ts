/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import type { SchemaInput } from '../migrate/convert'
import { chunksFromMarkdown, chunksFromSchema } from './corpus'
import { cosine, lexicalSearch, tokenize, vectorSearch } from './retrieve'
import { formatContext } from './service'
import { type RagIndex, decodeVec, encodeVec, loadIndex, saveIndex } from './store'

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
