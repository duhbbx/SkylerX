/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { canIntrospect, oracleColType, readSchema } from './introspect'
import type { ProfileExec } from './profile'

type Entry = [RegExp, Array<Record<string, unknown>>]
function mockExec(map: Entry[]): ProfileExec {
  return async (sql: string) => {
    for (const [re, rows] of map) if (re.test(sql)) return rows
    return []
  }
}

describe('oracleColType reconstruction', () => {
  it('rebuilds the native type string from catalog columns', () => {
    expect(oracleColType({ data_type: 'VARCHAR2', char_length: 50 })).toBe('VARCHAR2(50)')
    expect(oracleColType({ data_type: 'CHAR', data_length: 1 })).toBe('CHAR(1)')
    expect(oracleColType({ data_type: 'NUMBER', data_precision: 10, data_scale: 2 })).toBe(
      'NUMBER(10,2)',
    )
    expect(oracleColType({ data_type: 'NUMBER', data_precision: 10, data_scale: 0 })).toBe(
      'NUMBER(10)',
    )
    expect(oracleColType({ data_type: 'NUMBER' })).toBe('NUMBER')
    expect(oracleColType({ data_type: 'DATE' })).toBe('DATE')
    expect(oracleColType({ data_type: 'CLOB' })).toBe('CLOB')
  })
})

describe('canIntrospect', () => {
  it('PG-family, Oracle/DM, MySQL and SQL Server are all supported', () => {
    expect(canIntrospect(DbDialect.Vastbase)).toBe(true)
    expect(canIntrospect(DbDialect.Oracle)).toBe(true)
    expect(canIntrospect(DbDialect.DM)).toBe(true)
    expect(canIntrospect(DbDialect.MySQL)).toBe(true)
    expect(canIntrospect(DbDialect.SqlServer)).toBe(true)
  })
})

describe('Oracle reader (mock catalog)', () => {
  it('builds SchemaInput with types, PK, FK, check, index, sequence', async () => {
    const exec = mockExec([
      // 只有 DEPT/EMP 是基表;V_X 是视图(在 all_tab_columns 里有列但不在 all_tables)
      [/FROM all_tables /, [{ TBL: 'DEPT' }, { TBL: 'EMP' }]],
      [
        /all_tab_columns/,
        [
          {
            TBL: 'DEPT',
            COL: 'ID',
            DATA_TYPE: 'NUMBER',
            DATA_PRECISION: 10,
            DATA_SCALE: 0,
            NULLABLE: 'N',
          },
          { TBL: 'DEPT', COL: 'NAME', DATA_TYPE: 'VARCHAR2', CHAR_LENGTH: 50, NULLABLE: 'Y' },
          { TBL: 'V_X', COL: 'ID', DATA_TYPE: 'NUMBER', NULLABLE: 'Y' }, // 视图列,应排除
          {
            TBL: 'EMP',
            COL: 'ID',
            DATA_TYPE: 'NUMBER',
            DATA_PRECISION: 10,
            DATA_SCALE: 0,
            NULLABLE: 'N',
          },
          {
            TBL: 'EMP',
            COL: 'DEPT_ID',
            DATA_TYPE: 'NUMBER',
            DATA_PRECISION: 10,
            DATA_SCALE: 0,
            NULLABLE: 'Y',
          },
          {
            TBL: 'EMP',
            COL: 'SALARY',
            DATA_TYPE: 'NUMBER',
            DATA_PRECISION: 12,
            DATA_SCALE: 2,
            NULLABLE: 'Y',
          },
        ],
      ],
      [/all_col_comments/, [{ TBL: 'DEPT', COL: 'NAME', COMMENTS: '名称' }]],
      [/all_tab_comments/, [{ TBL: 'DEPT', COMMENTS: '部门表' }]],
      [
        /all_cons_columns/,
        [
          { CN: 'PK_DEPT', COL: 'ID', POSITION: 1 },
          { CN: 'PK_EMP', COL: 'ID', POSITION: 1 },
          { CN: 'FK_EMP_DEPT', COL: 'DEPT_ID', POSITION: 1 },
          { CN: 'CK_SAL', COL: 'SALARY', POSITION: 1 },
        ],
      ],
      [
        /all_constraints c/,
        [
          { CN: 'PK_DEPT', CT: 'P', TBL: 'DEPT' },
          { CN: 'PK_EMP', CT: 'P', TBL: 'EMP' },
          { CN: 'CK_SAL', CT: 'C', TBL: 'EMP', SC: 'SALARY >= 0' },
          { CN: 'NN_ID', CT: 'C', TBL: 'EMP', SC: '"ID" IS NOT NULL' }, // auto NOT NULL → skipped
          { CN: 'FK_EMP_DEPT', CT: 'R', TBL: 'EMP', RCN: 'PK_DEPT', RTBL: 'DEPT', DR: 'CASCADE' },
          { CN: 'BIN$PK', CT: 'P', TBL: 'BIN$OLD==$0' }, // 回收站对象的约束,不应造出 phantom 表
        ],
      ],
      [/all_ind_columns/, [{ IDX: 'IX_EMP_DEPT', COL: 'DEPT_ID', POS: 1 }]],
      [
        /all_indexes/,
        [
          { IDX: 'IX_EMP_DEPT', TBL: 'EMP', UNIQ: 'NONUNIQUE' },
          { IDX: 'PK_EMP', TBL: 'EMP', UNIQ: 'UNIQUE' }, // backs a constraint → excluded
        ],
      ],
      [
        /all_sequences/,
        [{ NAME: 'EMP_SEQ', INCREMENT_BY: 1, LAST_NUMBER: 1000, CACHE_SIZE: 20, CYCLE_FLAG: 'N' }],
      ],
    ])
    const si = await readSchema(exec, DbDialect.Oracle, 'HR')

    const dept = si.tables.find((t) => t.name === 'DEPT')!
    const emp = si.tables.find((t) => t.name === 'EMP')!
    expect(si.tables.map((t) => t.name).sort()).toEqual(['DEPT', 'EMP']) // V_X view excluded
    expect(dept.columns.map((c) => c.dataType)).toEqual(['NUMBER(10)', 'VARCHAR2(50)'])
    expect(dept.primaryKey).toEqual(['ID'])
    expect(dept.comment).toBe('部门表')
    expect(dept.columns.find((c) => c.name === 'NAME')?.comment).toBe('名称')
    expect(emp.checks).toEqual([{ name: 'CK_SAL', expr: 'SALARY >= 0' }]) // NOT NULL check filtered out
    expect(si.foreignKeys).toEqual([
      {
        name: 'FK_EMP_DEPT',
        table: 'EMP',
        schema: 'HR',
        columns: ['DEPT_ID'],
        refTable: 'DEPT',
        refSchema: 'HR',
        refColumns: ['ID'],
        onDelete: 'CASCADE',
      },
    ])
    expect(si.indexes).toEqual([
      { name: 'IX_EMP_DEPT', table: 'EMP', schema: 'HR', columns: ['DEPT_ID'], unique: false },
    ])
    expect(si.sequences).toEqual([
      {
        kind: 'sequence',
        schema: 'HR',
        name: 'EMP_SEQ',
        start: 1000,
        increment: 1,
        cache: 20,
        cycle: false,
      },
    ])
  })
})

describe('PG reader (mock catalog)', () => {
  it('parses columns, PK, FK, check, index from pg_catalog rows', async () => {
    const exec = mockExec([
      [
        /format_type/,
        [
          { tbl: 'emp', col: 'id', typ: 'integer', notnull: true },
          { tbl: 'emp', col: 'name', typ: 'character varying(50)', notnull: false, cmt: 'nm' },
        ],
      ],
      [/obj_description\(c\.oid/, [{ tbl: 'emp', cmt: 'employees' }]],
      [
        /contype IN/,
        [
          { name: 'pk', t: 'p', tbl: 'emp', cols: 'id' },
          { name: 'ck', t: 'c', tbl: 'emp', def: 'CHECK ((id > 0))' },
        ],
      ],
      [
        /pg_get_indexdef/,
        [
          {
            tbl: 'emp',
            idx: 'ix_name',
            uniq: false,
            def: 'CREATE INDEX ix_name ON s.emp USING btree (name) TABLESPACE pg_default',
          },
        ],
      ],
      [/relkind = 'S'/, []],
    ])
    const si = await readSchema(exec, DbDialect.Vastbase, 's')
    const emp = si.tables[0]
    expect(emp.columns.map((c) => c.dataType)).toEqual(['integer', 'character varying(50)'])
    expect(emp.primaryKey).toEqual(['id'])
    expect(emp.comment).toBe('employees')
    expect(emp.checks).toEqual([{ name: 'ck', expr: '(id > 0)' }])
    expect((si.indexes ?? [])[0]).toMatchObject({ name: 'ix_name', columns: ['name'] })
  })
})

describe('MySQL reader (mock information_schema)', () => {
  it('reads columns / PK / FK / index', async () => {
    const exec = mockExec([
      [
        /FROM information_schema\.COLUMNS/,
        [
          { tbl: 'emp', col: 'id', typ: 'int(11)', nullable: 'NO' },
          { tbl: 'emp', col: 'dept_id', typ: 'int(11)', nullable: 'YES' },
          { tbl: 'emp', col: 'name', typ: 'varchar(50)', nullable: 'YES', cmt: '姓名' },
        ],
      ],
      [/FROM information_schema\.TABLES/, [{ tbl: 'emp', cmt: '员工' }]],
      [
        /KEY_COLUMN_USAGE/,
        [
          { cn: 'PRIMARY', tbl: 'emp', col: 'id', pos: 1 },
          { cn: 'fk_dept', tbl: 'emp', col: 'dept_id', pos: 1, rtbl: 'dept', rcol: 'id' },
        ],
      ],
      [/REFERENTIAL_CONSTRAINTS/, [{ cn: 'fk_dept', tbl: 'emp', dr: 'CASCADE' }]],
      [
        /TABLE_CONSTRAINTS/,
        [
          { cn: 'PRIMARY', tbl: 'emp', ct: 'PRIMARY KEY' },
          { cn: 'fk_dept', tbl: 'emp', ct: 'FOREIGN KEY' },
        ],
      ],
      [
        /FROM information_schema\.STATISTICS/,
        [{ idx: 'ix_name', tbl: 'emp', col: 'name', nu: 1, pos: 1 }],
      ],
    ])
    const si = await readSchema(exec, DbDialect.MySQL, 'app')
    const emp = si.tables[0]
    expect(emp.columns.map((c) => c.dataType)).toEqual(['int(11)', 'int(11)', 'varchar(50)'])
    expect(emp.primaryKey).toEqual(['id'])
    expect(emp.comment).toBe('员工')
    expect((si.foreignKeys ?? [])[0]).toMatchObject({
      name: 'fk_dept',
      refTable: 'dept',
      refColumns: ['id'],
      onDelete: 'CASCADE',
    })
    expect((si.indexes ?? [])[0]).toMatchObject({
      name: 'ix_name',
      columns: ['name'],
      unique: false,
    })
  })

  // 回归(live 在 MySQL 8 上发现):
  //  1) information_schema.COLUMNS 不分基表/视图 → 视图列不能当成表;
  //  2) 约束名只在表内唯一(两表主键都叫 PRIMARY、列都叫 id)→ 复合键避免串列。
  it('excludes views and keeps same-named PK constraints per-table', async () => {
    const exec = mockExec([
      [
        /FROM information_schema\.COLUMNS/,
        [
          { tbl: 'a', col: 'id', typ: 'int', nullable: 'NO' },
          { tbl: 'b', col: 'id', typ: 'int', nullable: 'NO' },
          { tbl: 'v_ab', col: 'id', typ: 'int', nullable: 'YES' }, // 视图列,应被排除
        ],
      ],
      // 只有 a、b 是 BASE TABLE;v_ab 是视图,不在此列表
      [/FROM information_schema\.TABLES/, [{ tbl: 'a' }, { tbl: 'b' }]],
      [
        /KEY_COLUMN_USAGE/,
        [
          { cn: 'PRIMARY', tbl: 'a', col: 'id', pos: 1 },
          { cn: 'PRIMARY', tbl: 'b', col: 'id', pos: 1 },
        ],
      ],
      [/REFERENTIAL_CONSTRAINTS/, []],
      [
        /TABLE_CONSTRAINTS/,
        [
          { cn: 'PRIMARY', tbl: 'a', ct: 'PRIMARY KEY' },
          { cn: 'PRIMARY', tbl: 'b', ct: 'PRIMARY KEY' },
        ],
      ],
      [/FROM information_schema\.STATISTICS/, []],
    ])
    const si = await readSchema(exec, DbDialect.MySQL, 'app')
    expect(si.tables.map((t) => t.name).sort()).toEqual(['a', 'b']) // 无 v_ab
    expect(si.tables.find((t) => t.name === 'a')?.primaryKey).toEqual(['id']) // 不是 ['id','id']
    expect(si.tables.find((t) => t.name === 'b')?.primaryKey).toEqual(['id'])
  })
})

describe('SQL Server reader (mock INFORMATION_SCHEMA)', () => {
  it('reads columns + PK + FK with reconstructed types', async () => {
    const exec = mockExec([
      [
        /INFORMATION_SCHEMA\.COLUMNS/,
        [
          { tbl: 'Emp', col: 'Id', data_type: 'int', nullable: 'NO' },
          {
            tbl: 'Emp',
            col: 'Name',
            data_type: 'nvarchar',
            character_maximum_length: 100,
            nullable: 'YES',
          },
          {
            tbl: 'Emp',
            col: 'Bio',
            data_type: 'nvarchar',
            character_maximum_length: -1,
            nullable: 'YES',
          },
          {
            tbl: 'Emp',
            col: 'Pay',
            data_type: 'decimal',
            numeric_precision: 12,
            numeric_scale: 2,
            nullable: 'YES',
          },
        ],
      ],
      [/KEY_COLUMN_USAGE/, [{ cn: 'PK_Emp', tbl: 'Emp', col: 'Id', pos: 1 }]],
      [/REFERENTIAL_CONSTRAINTS/, []],
      [/TABLE_CONSTRAINTS/, [{ cn: 'PK_Emp', tbl: 'Emp', ct: 'PRIMARY KEY' }]],
    ])
    const si = await readSchema(exec, DbDialect.SqlServer, 'dbo')
    const emp = si.tables[0]
    expect(emp.columns.map((c) => c.dataType)).toEqual([
      'int',
      'nvarchar(100)',
      'nvarchar(max)',
      'decimal(12,2)',
    ])
    expect(emp.primaryKey).toEqual(['Id'])
  })
})
