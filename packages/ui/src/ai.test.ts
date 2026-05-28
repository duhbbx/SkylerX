import { describe, expect, it } from 'vitest'
import { extractSql } from './ai'

describe('extractSql', () => {
  it('pulls the first ```sql fenced block', () => {
    const md = 'sure:\n```sql\nSELECT 1;\n```\nthen done'
    expect(extractSql(md)).toBe('SELECT 1;')
  })
  it('falls back to any fenced block when no sql tag', () => {
    expect(extractSql('```\nSELECT * FROM t;\n```')).toBe('SELECT * FROM t;')
  })
  it('returns the trimmed input when no fence', () => {
    expect(extractSql('  SELECT now();  ')).toBe('SELECT now();')
  })
})
