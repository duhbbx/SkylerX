/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { parseCSV, parseJSON, toHTML, toMarkdown } from './io'

describe('toMarkdown', () => {
  it('renders a GFM table and escapes pipes/newlines', () => {
    const md = toMarkdown(
      ['id', 'name'],
      [
        { id: 1, name: 'a|b' },
        { id: 2, name: 'c\nd' },
      ],
    )
    const lines = md.split('\n')
    expect(lines[0]).toBe('| id | name |')
    expect(lines[1]).toBe('| --- | --- |')
    expect(lines[2]).toBe('| 1 | a\\|b |')
    expect(lines[3]).toBe('| 2 | c d |')
  })
  it('null/undefined render as empty cells', () => {
    const md = toMarkdown(['a'], [{ a: null }])
    expect(md.split('\n')[2]).toBe('|  |')
  })
})

describe('toHTML', () => {
  it('produces an html doc with escaped cells', () => {
    const html = toHTML(['c'], [{ c: '<b>&x' }])
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<td>&lt;b&gt;&amp;x</td>')
    expect(html).toContain('<th>c</th>')
  })
})

describe('parseJSON', () => {
  it('array of objects → header (key union) + rows', () => {
    const out = parseJSON('[{"id":1,"name":"a"},{"id":2,"name":"b"}]')
    expect(out[0]).toEqual(['id', 'name'])
    expect(out.slice(1)).toEqual([
      ['1', 'a'],
      ['2', 'b'],
    ])
  })

  it('unions keys across objects in first-seen order; missing → empty', () => {
    const out = parseJSON('[{"a":1},{"a":2,"b":3}]')
    expect(out[0]).toEqual(['a', 'b'])
    expect(out[1]).toEqual(['1', ''])
    expect(out[2]).toEqual(['2', '3'])
  })

  it('null → empty (NULL), nested object → JSON string', () => {
    const out = parseJSON('[{"x":null,"y":{"k":1}}]')
    expect(out[1]).toEqual(['', '{"k":1}'])
  })

  it('single object wraps to one row; array-of-arrays passes through', () => {
    expect(parseJSON('{"a":1}')).toEqual([['a'], ['1']])
    expect(parseJSON('[[1,2],[3,4]]')).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('empty array → no rows', () => {
    expect(parseJSON('[]')).toEqual([])
  })
})

describe('parseCSV (regression)', () => {
  it('parses quoted fields with embedded commas', () => {
    expect(parseCSV('a,b\n"1,5",x')).toEqual([
      ['a', 'b'],
      ['1,5', 'x'],
    ])
  })
  it('parses TSV when delimiter is tab (clipboard paste from spreadsheets)', () => {
    expect(parseCSV('a\tb\tc\n1\t2\t3', '\t')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })
  it('tab delimiter keeps commas inside fields intact', () => {
    expect(parseCSV('name\tnote\nfoo\ta, b, c', '\t')).toEqual([
      ['name', 'note'],
      ['foo', 'a, b, c'],
    ])
  })
})
