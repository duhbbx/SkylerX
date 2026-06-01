/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect, MetaNodeKind } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import type { TreeNode } from './components/treeNode'
import {
  buildAlterTable,
  buildCreateTable,
  buildDrop,
  buildSqlTemplate,
  emptyColumn,
  emptyTableSpec,
  formatBytes,
  objectDdlQuery,
  previewSql,
  quoteId,
} from './ddl'

function node(
  kind: MetaNodeKind,
  name: string,
  sqlName?: string,
  path: string[] = [name],
): TreeNode {
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
    expect(buildSqlTemplate(DbDialect.PostgreSQL, 'createlike', 't', cols)).toContain(
      'INCLUDING ALL',
    )
    expect(buildSqlTemplate(DbDialect.SqlServer, 'createlike', 't', cols)).toContain(
      'SELECT * INTO',
    )
    expect(buildSqlTemplate(DbDialect.Oracle, 'createlike', 't', cols)).toContain(
      'AS SELECT * FROM t',
    )
  })

  it('createindex names index + first column', () => {
    const sql = buildSqlTemplate(DbDialect.MySQL, 'createindex', 't', cols)
    expect(sql).toContain('CREATE INDEX')
    expect(sql).toContain('ON t (`id`)')
    expect(sql).toContain('CREATE UNIQUE INDEX') // 注释里给出唯一索引写法
  })

  it('comment uses dialect-correct syntax', () => {
    expect(buildSqlTemplate(DbDialect.MySQL, 'comment', 't', cols)).toContain(
      'ALTER TABLE t COMMENT =',
    )
    const pg = buildSqlTemplate(DbDialect.PostgreSQL, 'comment', 't', cols)
    expect(pg).toContain('COMMENT ON TABLE t')
    expect(pg).toContain('COMMENT ON COLUMN t."id"')
    expect(buildSqlTemplate(DbDialect.SqlServer, 'comment', 't', cols)).toContain(
      'sp_addextendedproperty',
    )
  })
})

describe('buildAlterTable index/FK diff', () => {
  const col = { ...emptyColumn(), name: 'id', type: 'int', nullable: false, originalName: 'id' }
  const baseSpec = () => ({ ...emptyTableSpec(), columns: [{ ...col }] })

  it('drops removed indexes and creates added ones', () => {
    const spec = { ...baseSpec(), indexes: [{ name: 'idx_b', columns: 'b', unique: false }] }
    const out = buildAlterTable(DbDialect.MySQL, '`t`', [{ ...col }], spec, {
      indexes: [{ name: 'idx_a', columns: 'a', unique: false }],
    }).join('\n')
    expect(out).toContain('DROP INDEX `idx_a`')
    expect(out).toContain('CREATE INDEX `idx_b` ON `t` (`b`)')
  })

  it('leaves unchanged indexes alone', () => {
    const idx = { name: 'idx_a', columns: 'a', unique: false }
    const spec = { ...baseSpec(), indexes: [{ ...idx }] }
    const out = buildAlterTable(DbDialect.MySQL, '`t`', [{ ...col }], spec, {
      indexes: [{ ...idx }],
    })
    expect(out.join('\n')).not.toMatch(/INDEX/)
  })

  it('drops a removed FK with dialect-correct syntax', () => {
    const orig = {
      name: 'fk1',
      columns: 'a',
      refTable: 'r',
      refColumns: 'id',
      onDelete: '',
      onUpdate: '',
    }
    const my = buildAlterTable(DbDialect.MySQL, '`t`', [{ ...col }], baseSpec(), {
      foreignKeys: [orig],
    })
    expect(my.join('\n')).toContain('DROP FOREIGN KEY `fk1`')
    const pg = buildAlterTable(DbDialect.PostgreSQL, '"t"', [{ ...col }], baseSpec(), {
      foreignKeys: [orig],
    })
    expect(pg.join('\n')).toContain('DROP CONSTRAINT "fk1"')
  })
})

describe('DEFAULT value quoting (bug: bare 张三 → unquoted)', () => {
  const col = (name: string, def: string, originalName?: string) => ({
    ...emptyColumn(),
    name,
    type: 'varchar',
    length: '60',
    nullable: true,
    defaultValue: def,
    originalName,
  })
  it('quotes bare string defaults; passes through numbers/keywords/funcs/already-quoted', () => {
    const cols = [
      col('name', '张三'),
      col('age', '18'),
      col('flag', 'NULL'),
      col('ts', 'CURRENT_TIMESTAMP'),
      col('u', 'UUID()'),
      col('lit', "'hello'"),
    ]
    const out = buildCreateTable(DbDialect.MySQL, { database: 'd' }, 't', {
      ...emptyTableSpec(),
      columns: cols,
    })
    expect(out).toContain("DEFAULT '张三'")
    expect(out).toContain('DEFAULT 18')
    expect(out).toContain('DEFAULT NULL')
    expect(out).toContain('DEFAULT CURRENT_TIMESTAMP')
    expect(out).toContain('DEFAULT UUID()')
    expect(out).toContain("DEFAULT 'hello'")
  })
  it('ALTER CHANGE column quotes the same way', () => {
    const orig = col('name', '', 'name')
    const cur = col('name', '张三', 'name')
    const out = buildAlterTable(DbDialect.MySQL, '`t`', [orig], {
      ...emptyTableSpec(),
      columns: [cur],
    }).join('\n')
    expect(out).toContain("DEFAULT '张三'")
  })
  it('PG SET DEFAULT also quoted', () => {
    const orig = col('city', '', 'city')
    const cur = col('city', '北京', 'city')
    const out = buildAlterTable(DbDialect.PostgreSQL, '"t"', [orig], {
      ...emptyTableSpec(),
      columns: [cur],
    }).join('\n')
    expect(out).toContain(`SET DEFAULT '北京'`)
  })
})

describe('MySQL charset / collation', () => {
  const baseCol = {
    ...emptyColumn(),
    name: 'name',
    type: 'varchar',
    length: '100',
    nullable: false,
  }
  it('buildCreateTable emits CHARACTER SET / COLLATE for MySQL columns', () => {
    const spec = {
      ...emptyTableSpec(),
      columns: [{ ...baseCol, charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' }],
    }
    const out = buildCreateTable(DbDialect.MySQL, { database: 'd' }, 't', spec)
    expect(out).toContain('CHARACTER SET utf8mb4')
    expect(out).toContain('COLLATE utf8mb4_unicode_ci')
  })
  it('buildAlterTable CHANGE picks up charset/collation diffs', () => {
    const orig = { ...baseCol, originalName: 'name', charset: 'utf8', collation: 'utf8_general_ci' }
    const cur = { ...orig, charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' }
    const out = buildAlterTable(DbDialect.MySQL, '`t`', [orig], {
      ...emptyTableSpec(),
      columns: [cur],
    }).join('\n')
    expect(out).toMatch(/CHANGE `name` `name`.*CHARACTER SET utf8mb4.*COLLATE utf8mb4_unicode_ci/)
  })
  it('PG ignores charset/collation (MySQL-only)', () => {
    const spec = { ...emptyTableSpec(), columns: [{ ...baseCol, charset: 'utf8mb4' }] }
    const out = buildCreateTable(
      DbDialect.PostgreSQL,
      { database: 'd', schema: 'public' },
      't',
      spec,
    )
    expect(out).not.toContain('CHARACTER SET')
  })
})

describe('index column syntax (prefix / order)', () => {
  const baseCol = { ...emptyColumn(), name: 'id', type: 'int', nullable: false }
  it('MySQL inline index emits prefix length + DESC', () => {
    const spec = {
      ...emptyTableSpec(),
      columns: [{ ...baseCol }],
      indexes: [{ name: 'idx_ab', columns: 'a(10) DESC, b', unique: false }],
    }
    const out = buildCreateTable(DbDialect.MySQL, { database: 'd' }, 't', spec)
    expect(out).toContain('INDEX `idx_ab` (`a`(10) DESC, `b`)')
  })
  it('PG CREATE INDEX preserves DESC (no prefix length)', () => {
    const spec = {
      ...emptyTableSpec(),
      columns: [{ ...baseCol }],
      indexes: [{ name: 'idx_a', columns: 'a desc', unique: false }],
    }
    const out = buildCreateTable(
      DbDialect.PostgreSQL,
      { database: 'd', schema: 'public' },
      't',
      spec,
    )
    expect(out).toContain('CREATE INDEX "idx_a" ON "t" ("a" DESC);')
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
    expect(buildDrop(DbDialect.PostgreSQL, node(MetaNodeKind.Table, 't'), true)?.sql).toContain(
      'CASCADE',
    )
    // MySQL 不支持 DROP TABLE ... CASCADE → 不应附加
    expect(buildDrop(DbDialect.MySQL, node(MetaNodeKind.Table, 't'), true)?.sql).not.toContain(
      'CASCADE',
    )
    expect(buildDrop(DbDialect.Oracle, node(MetaNodeKind.Table, 't'), true)?.sql).toContain(
      'CASCADE CONSTRAINTS',
    )
  })

  it('returns null for non-droppable kinds', () => {
    expect(buildDrop(DbDialect.MySQL, node(MetaNodeKind.Column, 'c'))).toBeNull()
  })

  it('drops MySQL trigger by name, PG trigger needs the table', () => {
    expect(buildDrop(DbDialect.MySQL, node(MetaNodeKind.Trigger, 'trg'))?.sql).toBe(
      'DROP TRIGGER `trg`',
    )
    const pg = buildDrop(
      DbDialect.PostgreSQL,
      node(MetaNodeKind.Trigger, 'trg', undefined, ['public', 'orders', 'trg']),
    )
    expect(pg?.sql).toBe('DROP TRIGGER "trg" ON "orders"')
  })
})

describe('objectDdlQuery — oracle family (Oracle/DM)', () => {
  const n = (kind: MetaNodeKind, name: string) =>
    node(kind, name, `"HR"."${name}"`, ['HR', name])

  it('sequence → get_ddl SEQUENCE', () => {
    const q = objectDdlQuery(DbDialect.Oracle, 'sequence', '"HR"."S1"', n(MetaNodeKind.Sequence, 'S1'))
    expect(q?.mode).toBe('oracle-ddl')
    expect(q?.sql).toContain("get_ddl('SEQUENCE', 'S1', 'HR')")
    expect(q?.bodySql).toBeUndefined()
  })

  it('synonym → get_ddl SYNONYM', () => {
    const q = objectDdlQuery(DbDialect.DM, 'synonym', '"HR"."V1"', n(MetaNodeKind.Synonym, 'V1'))
    expect(q?.sql).toContain("get_ddl('SYNONYM', 'V1', 'HR')")
    expect(q?.bodySql).toBeUndefined()
  })

  it('package → spec sql + body bodySql', () => {
    const q = objectDdlQuery(DbDialect.DM, 'package', '"HR"."PKG"', n(MetaNodeKind.Package, 'PKG'))
    expect(q?.sql).toContain("get_ddl('PACKAGE', 'PKG', 'HR')")
    expect(q?.bodySql).toContain("get_ddl('PACKAGE_BODY', 'PKG', 'HR')")
  })

  it('type → spec sql + body bodySql', () => {
    const q = objectDdlQuery(DbDialect.Oracle, 'type', '"HR"."T1"', n(MetaNodeKind.Type, 'T1'))
    expect(q?.sql).toContain("get_ddl('TYPE', 'T1', 'HR')")
    expect(q?.bodySql).toContain("get_ddl('TYPE_BODY', 'T1', 'HR')")
  })

  it('escapes single quotes in names', () => {
    const q = objectDdlQuery(DbDialect.Oracle, 'sequence', `"HR"."O'X"`, node(MetaNodeKind.Sequence, "O'X", `"HR"."O'X"`, ['HR', "O'X"]))
    expect(q?.sql).toContain("get_ddl('SEQUENCE', 'O''X', 'HR')")
  })
})
