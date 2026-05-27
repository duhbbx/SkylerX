import { describe, expect, it } from 'vitest'
import { parseCSV, parseJSON } from './io'

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
})
