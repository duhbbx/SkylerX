import { DbDialect, MetaNodeKind } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { buildDrop, buildSqlTemplate, formatBytes, previewSql, quoteId } from './ddl'
import type { TreeNode } from './components/treeNode'

function node(kind: MetaNodeKind, name: string, sqlName?: string, path: string[] = [name]): TreeNode {
  return {
    kind,
    name,
    sqlName,
    path,
    hasChildren: false,
    expanded: false,
    loading: false,
    error: null,
    children: null,
  }
}

describe('quoteId', () => {
  it('quotes per dialect family', () => {
    expect(quoteId(DbDialect.MySQL, 'a')).toBe('`a`')
    expect(quoteId(DbDialect.OceanBase, 'a')).toBe('`a`') // MySQL 兼容族
    expect(quoteId(DbDialect.SqlServer, 'a')).toBe('[a]')
    expect(quoteId(DbDialect.PostgreSQL, 'a')).toBe('"a"')
    expect(quoteId(DbDialect.Oracle, 'a')).toBe('"a"')
  })
  it('escapes the embedded quote char', () => {
    expect(quoteId(DbDialect.MySQL, 'a`b')).toBe('`a``b`')
    expect(quoteId(DbDialect.SqlServer, 'a]b')).toBe('[a]]b]')
    expect(quoteId(DbDialect.PostgreSQL, 'a"b')).toBe('"a""b"')
  })
})

describe('previewSql', () => {
  it('uses the dialect-correct row-limit syntax', () => {
    expect(previewSql(DbDialect.MySQL, 't', 10)).toBe('SELECT * FROM t LIMIT 10;')
    expect(previewSql(DbDialect.PostgreSQL, 't', 10)).toBe('SELECT * FROM t LIMIT 10;')
    expect(previewSql(DbDialect.SqlServer, 't', 10)).toBe('SELECT TOP 10 * FROM t;')
    expect(previewSql(DbDialect.Oracle, 't', 10)).toBe('SELECT * FROM t FETCH FIRST 10 ROWS ONLY;')
  })
  it('defaults to 200 rows', () => {
    expect(previewSql(DbDialect.MySQL, 't')).toContain('LIMIT 200')
  })
})

describe('buildSqlTemplate', () => {
  const cols = [
    { name: 'id', pk: true },
    { name: 'name', pk: false },
  ]

  it('select lists quoted columns', () => {
    const sql = buildSqlTemplate(DbDialect.MySQL, 'select', 't', cols)
    expect(sql).toContain('SELECT `id`, `name`')
    expect(sql).toContain('FROM t')
  })

  it('update / delete key on the primary key', () => {
    expect(buildSqlTemplate(DbDialect.MySQL, 'update', 't', cols)).toContain('WHERE `id` = NULL')
    expect(buildSqlTemplate(DbDialect.MySQL, 'delete', 't', cols)).toContain('WHERE `id` = NULL')
  })

  it('createlike differs per dialect', () => {
    expect(buildSqlTemplate(DbDialect.MySQL, 'createlike', 't', cols)).toContain('LIKE t')
    expect(buildSqlTemplate(DbDialect.PostgreSQL, 'createlike', 't', cols)).toContain('INCLUDING ALL')
    expect(buildSqlTemplate(DbDialect.SqlServer, 'createlike', 't', cols)).toContain('SELECT * INTO')
    expect(buildSqlTemplate(DbDialect.Oracle, 'createlike', 't', cols)).toContain('AS SELECT * FROM t')
  })

  it('createindex names index + first column', () => {
    const sql = buildSqlTemplate(DbDialect.MySQL, 'createindex', 't', cols)
    expect(sql).toContain('CREATE INDEX')
    expect(sql).toContain('ON t (`id`)')
    expect(sql).toContain('CREATE UNIQUE INDEX') // 注释里给出唯一索引写法
  })

  it('comment uses dialect-correct syntax', () => {
    expect(buildSqlTemplate(DbDialect.MySQL, 'comment', 't', cols)).toContain('ALTER TABLE t COMMENT =')
    const pg = buildSqlTemplate(DbDialect.PostgreSQL, 'comment', 't', cols)
    expect(pg).toContain('COMMENT ON TABLE t')
    expect(pg).toContain('COMMENT ON COLUMN t."id"')
    expect(buildSqlTemplate(DbDialect.SqlServer, 'comment', 't', cols)).toContain('sp_addextendedproperty')
  })
})

describe('formatBytes', () => {
  it('renders human-readable sizes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.00 KB')
    expect(formatBytes(1536)).toBe('1.50 KB')
    expect(formatBytes(1048576)).toBe('1.00 MB')
  })
})

describe('buildDrop', () => {
  it('prefers sqlName for tables', () => {
    const r = buildDrop(DbDialect.MySQL, node(MetaNodeKind.Table, 't', '`db`.`t`'))
    expect(r?.sql).toBe('DROP TABLE `db`.`t`')
  })

  it('appends CASCADE only where the dialect supports it', () => {
    expect(buildDrop(DbDialect.PostgreSQL, node(MetaNodeKind.Table, 't'), true)?.sql).toContain('CASCADE')
    // MySQL 不支持 DROP TABLE ... CASCADE → 不应附加
    expect(buildDrop(DbDialect.MySQL, node(MetaNodeKind.Table, 't'), true)?.sql).not.toContain('CASCADE')
    expect(buildDrop(DbDialect.Oracle, node(MetaNodeKind.Table, 't'), true)?.sql).toContain('CASCADE CONSTRAINTS')
  })

  it('returns null for non-droppable kinds', () => {
    expect(buildDrop(DbDialect.MySQL, node(MetaNodeKind.Column, 'c'))).toBeNull()
  })

  it('drops MySQL trigger by name, PG trigger needs the table', () => {
    expect(buildDrop(DbDialect.MySQL, node(MetaNodeKind.Trigger, 'trg'))?.sql).toBe('DROP TRIGGER `trg`')
    const pg = buildDrop(DbDialect.PostgreSQL, node(MetaNodeKind.Trigger, 'trg', undefined, ['public', 'orders', 'trg']))
    expect(pg?.sql).toBe('DROP TRIGGER "trg" ON "orders"')
  })
})
