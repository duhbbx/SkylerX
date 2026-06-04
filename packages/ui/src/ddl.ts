/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect, MetaNodeKind } from '@db-tool/shared-types'
import type { TreeNode } from './components/treeNode'

/** 表设计器里的一列定义。 */
export interface ColumnDef {
  name: string
  type: string
  length: string
  /** 小数位 / 比例（如 DECIMAL(10,2) 的 2） */
  scale: string
  nullable: boolean
  primaryKey: boolean
  defaultValue: string
  comment: string
  /** MySQL：无符号数值 */
  unsigned?: boolean
  /** MySQL：自增 */
  autoIncrement?: boolean
  /** MySQL：ZEROFILL（隐含 UNSIGNED） */
  zerofill?: boolean
  /** MySQL：时间戳列 ON UPDATE CURRENT_TIMESTAMP */
  onUpdateNow?: boolean
  /** MySQL：字段级字符集（如 utf8mb4） */
  charset?: string
  /** MySQL：字段级排序规则（如 utf8mb4_unicode_ci） */
  collation?: string
  /** 生成列表达式（MySQL/PG：GENERATED ALWAYS AS (expr) STORED）；空=普通列 */
  generated?: string
  /** 改表模式：该列加载时的原始名（用于识别改名/删除/修改）；新增列为 undefined */
  originalName?: string
}

/** 解析数据库返回的类型串为 type/length/scale（如 "varchar(255)" / "decimal(10,2)"）。 */
export function parseType(full: string): { type: string; length: string; scale: string } {
  const m = /^(.+?)\(([^)]+)\)\s*$/.exec((full ?? '').trim())
  if (!m) return { type: (full ?? '').trim(), length: '', scale: '' }
  const inner = m[2].split(',').map((s) => s.trim())
  return { type: m[1].trim(), length: inner[0] ?? '', scale: inner[1] ?? '' }
}

export function emptyColumn(): ColumnDef {
  return {
    name: '',
    type: '',
    length: '',
    scale: '',
    nullable: true,
    primaryKey: false,
    defaultValue: '',
    comment: '',
  }
}

export interface IndexDef {
  name: string
  columns: string
  unique: boolean
  /** 索引方法/类型：MySQL BTREE/HASH/FULLTEXT/SPATIAL；PG btree/hash/gin/gist。空=默认 */
  type?: string
  /** PG：部分索引谓词（写入 WHERE (expr)；含括号会自动包裹） */
  where?: string
  /** PG：在线建索引（CREATE INDEX CONCURRENTLY，不锁表） */
  concurrent?: boolean
}
export interface ForeignKeyDef {
  name: string
  columns: string
  refTable: string
  refColumns: string
  onDelete: string
  onUpdate: string
  /** PG：MATCH FULL/PARTIAL/SIMPLE */
  match?: string
  /** PG：可延迟约束 DEFERRABLE INITIALLY DEFERRED */
  deferrable?: boolean
}

/** 外键尾缀：MATCH / ON DELETE / ON UPDATE / DEFERRABLE（MATCH·DEFERRABLE 仅 PG）。 */
function fkSuffix(fk: ForeignKeyDef, fam: Family): string {
  let s = ''
  if (fam === 'pg' && fk.match?.trim()) s += ` MATCH ${fk.match.trim()}`
  if (fk.onDelete) s += ` ON DELETE ${fk.onDelete}`
  if (fk.onUpdate) s += ` ON UPDATE ${fk.onUpdate}`
  if (fam === 'pg' && fk.deferrable) s += ' DEFERRABLE INITIALLY DEFERRED'
  return s
}
export interface UniqueDef {
  name: string
  columns: string
}
export interface CheckDef {
  name: string
  expression: string
}

/** 完整表规格（设计器各 tab 汇总）。 */
export interface TableSpec {
  columns: ColumnDef[]
  indexes: IndexDef[]
  foreignKeys: ForeignKeyDef[]
  uniques: UniqueDef[]
  checks: CheckDef[]
  comment: string
  /** MySQL 选项 */
  engine: string
  charset: string
  /** MySQL 默认排序规则 */
  collation: string
  /** MySQL：行格式（DYNAMIC / COMPRESSED / COMPACT / REDUNDANT） */
  rowFormat: string
  /** MySQL：自增起始值（写入 AUTO_INCREMENT=N） */
  autoIncStart: string
  /** PG：表空间 */
  tablespace: string
  /** PG：填充因子（WITH (fillfactor=N)） */
  fillfactor: string
  /** PG：继承的父表（INHERITS (parent)） */
  inherits: string
}

export function emptyTableSpec(): TableSpec {
  return {
    columns: [{ ...emptyColumn(), name: 'id', primaryKey: true, nullable: false }],
    indexes: [],
    foreignKeys: [],
    uniques: [],
    checks: [],
    comment: '',
    engine: '',
    charset: '',
    collation: '',
    rowFormat: '',
    autoIncStart: '',
    tablespace: '',
    fillfactor: '',
    inherits: '',
  }
}

type Family = 'mysql' | 'pg' | 'sqlserver' | 'oracle'

/**
 * 把方言归到一个 SQL 家族（共享 DDL/查询模板）；NoSQL 方言（Mongo/Redis）
 * 不属于任何 SQL 家族，调用方在调本函数前应当先 dialectKind() 分流。
 * 出于实用兼容，遇到 NoSQL 也回退到 'mysql'（语法最常见），避免崩；
 * 实际不应该走到这里。
 */
/**
 * 该方言的 database 下面是否还有 schema 一层(两层结构)。
 * PG 系 / SQL Server 是 database → schema 两层;MySQL 系、ClickHouse 等是 database → 表 单层
 * (database 即命名空间);Oracle/DM 顶层直接是 schema、根本没有 database 节点。
 * 用于「配置可见库/Schema」对话框:单层方言不显示库的展开 ▸。
 */
export function databaseHasSchemas(dialect: DbDialect): boolean {
  const fam = familyOf(dialect)
  return fam === 'pg' || fam === 'sqlserver'
}

export function familyOf(dialect: DbDialect): Family {
  switch (dialect) {
    case DbDialect.MySQL:
    case DbDialect.MariaDB:
    case DbDialect.OceanBase:
    case DbDialect.GBase8a:
    case DbDialect.TiDB:
    case DbDialect.Doris:
    case DbDialect.StarRocks:
    case DbDialect.PolarDBX:
    case DbDialect.GreatSQL:
    case DbDialect.TDSQLC:
      return 'mysql'
    case DbDialect.PostgreSQL:
    case DbDialect.KingbaseES:
    case DbDialect.CockroachDB:
    case DbDialect.Greenplum:
    case DbDialect.OpenGauss:
    case DbDialect.Vastbase:
    case DbDialect.MogDB:
    case DbDialect.Panweidb:
    case DbDialect.HighGo:
    case DbDialect.H2:
    case DbDialect.Redshift:
    case DbDialect.PolarDBPG:
    case DbDialect.GaussDB:
    case DbDialect.TimescaleDB:
    case DbDialect.QuestDB:
    case DbDialect.Materialize:
    case DbDialect.RisingWave:
    case DbDialect.Hologres:
      return 'pg'
    case DbDialect.SqlServer:
      return 'sqlserver'
    case DbDialect.Oracle:
    case DbDialect.DM:
      return 'oracle'
    default:
      // NoSQL（Mongo/Redis）等：本不该走到 SQL 家族里，退而求其次
      return 'mysql'
  }
}

/** 对象（视图/函数/过程）的限定引用：优先 node.sqlName，否则按方言由 path 构造。 */
export function objectRef(dialect: DbDialect, node: TreeNode): string {
  if (node.sqlName) return node.sqlName
  const q = (s: string) => quoteId(dialect, s)
  const p = node.path
  const name = p[p.length - 1]
  switch (familyOf(dialect)) {
    case 'mysql':
      return q(name) // 靠执行上下文 USE db
    case 'pg':
    case 'sqlserver':
    case 'oracle':
      return `${q(p[p.length - 2])}.${q(name)}` // schema.name
  }
}

/** 取对象定义 DDL 的查询 + 结果解析方式（支持 MySQL / PG / Oracle 的 视图/函数/过程/触发器）。 */
export interface ObjectDdlFetch {
  sql: string
  mode: 'showCreate' | 'viewdef' | 'funcdef' | 'oracle-ddl'
  /** viewdef 模式：拼到 pg_get_viewdef 结果前的前缀 */
  prefix?: string
  /**
   * oracle-ddl 模式专用：包/类型有 spec + body 两段。
   * 主 sql 取 spec；bodySql 取 body（PACKAGE_BODY / TYPE_BODY）。
   * body 可能不存在（spec-only 包、无 body 的简单类型）——消费方执行 bodySql 时
   * 必须 try/catch，缺 body 时静默忽略，只用 spec。
   */
  bodySql?: string
}

/**
 * @param ref 对 mysql 是 quoteId(name);对 pg/oracle 是 quoteId(schema).quoteId(name)
 * @param node 可选;Oracle 用 node.path 拿大写的 schema/name(dbms_metadata 区分大小写)
 */
export function objectDdlQuery(
  dialect: DbDialect,
  kind: ObjectKind,
  ref: string,
  node?: TreeNode,
): ObjectDdlFetch | null {
  const fam = familyOf(dialect)
  if (fam === 'mysql') {
    const kw =
      kind === 'view'
        ? 'VIEW'
        : kind === 'function'
          ? 'FUNCTION'
          : kind === 'procedure'
            ? 'PROCEDURE'
            : kind === 'trigger'
              ? 'TRIGGER'
              : null
    return kw ? { sql: `SHOW CREATE ${kw} ${ref}`, mode: 'showCreate' } : null
  }
  if (fam === 'pg') {
    if (kind === 'view' || kind === 'materialized_view')
      return {
        sql: `SELECT pg_get_viewdef('${ref}'::regclass, true) AS ddl`,
        mode: 'viewdef',
        prefix:
          kind === 'materialized_view'
            ? `CREATE MATERIALIZED VIEW ${ref} AS\n`
            : `CREATE OR REPLACE VIEW ${ref} AS\n`,
      }
    if (kind === 'function' || kind === 'procedure')
      return { sql: `SELECT pg_get_functiondef('${ref}'::regproc) AS ddl`, mode: 'funcdef' }
    return null
  }
  if (fam === 'oracle') {
    // dbms_metadata.get_ddl 返回 CLOB; oracle.ts 设了 fetchAsString=[CLOB] 后能直接读 string.
    //
    // 名字大小写处理 (#12, #26):
    //   Oracle 默认把未加引号的标识符 fold 成大写 (CREATE VIEW emp_view → 存 EMP_VIEW).
    //   带双引号的保持原样 (CREATE VIEW "emp_view" → 存 emp_view).
    //   all_views.view_name / all_objects.object_name 返回的就是 Oracle 内部的存储形式,
    //   也就是 node.path 里我们存的形式. 直接 pass-through 给 get_ddl 即可 —
    //   之前 .toUpperCase() 把 "emp_view" 强制变 EMP_VIEW, 反而找不到对应的
    //   quoted-identifier 对象 (报 ORA-31603 NEW_VIEW not found of type VIEW).
    const oraType =
      kind === 'view'
        ? 'VIEW'
        : kind === 'function'
          ? 'FUNCTION'
          : kind === 'procedure'
            ? 'PROCEDURE'
            : kind === 'trigger'
              ? 'TRIGGER'
              : kind === 'sequence'
                ? 'SEQUENCE'
                : kind === 'synonym'
                  ? 'SYNONYM'
                  : kind === 'package'
                    ? 'PACKAGE'
                    : kind === 'type'
                      ? // DM 的对象类型在数据字典里是 CLASS;dbms_metadata 也只认 'CLASS'
                        // ('TYPE' 报 -20008)。Oracle 仍用 'TYPE'。
                        dialect === DbDialect.DM
                        ? 'CLASS'
                        : 'TYPE'
                      : null
    if (!oraType) return null
    // 优先从 node.path 拿 schema/name(精确大小写);没有 node 时反解析 ref
    let schema: string
    let name: string
    if (node?.path && node.path.length >= 2) {
      schema = node.path[node.path.length - 2]
      name = node.path[node.path.length - 1]
    } else {
      // ref = "S"."N",去引号
      const m = ref.match(/^"?([^".]+)"?\.\s*"?([^".]+)"?$/)
      schema = m?.[1] ?? ''
      name = m?.[2] ?? ref
    }
    // 只 escape 单引号 (不动大小写). 名字按 Oracle 实际存储形式查.
    const esc = (s: string) => s.replace(/'/g, "''")
    const getDdl = (t: string) =>
      `SELECT dbms_metadata.get_ddl('${t}', '${esc(name)}', '${esc(schema)}') AS "ddl" FROM dual`
    // 包 / 对象类型有 spec + body 两段；body 由消费方单独执行（可能不存在）。
    // DM 的类型体在 dbms_metadata 里是 'CLASS_BODY'(注意是下划线,'CLASS BODY' 报 -20001)。
    const bodyType =
      kind === 'package'
        ? 'PACKAGE_BODY'
        : kind === 'type'
          ? dialect === DbDialect.DM
            ? 'CLASS_BODY'
            : 'TYPE_BODY'
          : null
    return {
      sql: getDdl(oraType),
      mode: 'oracle-ddl',
      ...(bodyType ? { bodySql: getDdl(bodyType) } : {}),
    }
  }
  return null
}

/** 查看「触发器 / 序列 / 事件」定义：取定义的查询 + 解析方式（MySQL 触发器/事件、PG 触发器/序列）。 */
export interface DefinitionFetch {
  sql: string
  mode: 'mysql-trigger' | 'pg-trigger' | 'pg-sequence' | 'mysql-event'
}

export function definitionQuery(dialect: DbDialect, node: TreeNode): DefinitionFetch | null {
  const fam = familyOf(dialect)
  const p = node.path
  const name = p[p.length - 1]
  const esc = (s: string) => s.replace(/'/g, "''")
  if (node.kind === MetaNodeKind.Trigger) {
    if (fam === 'mysql')
      return { sql: `SHOW CREATE TRIGGER ${quoteId(dialect, name)}`, mode: 'mysql-trigger' }
    if (fam === 'pg') {
      const schema = p[p.length - 3]
      const table = p[p.length - 2]
      return {
        sql: `SELECT pg_get_triggerdef(t.oid) AS ddl FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='${esc(schema)}' AND c.relname='${esc(table)}' AND t.tgname='${esc(name)}'`,
        mode: 'pg-trigger',
      }
    }
    return null
  }
  if (node.kind === MetaNodeKind.Sequence && fam === 'pg') {
    const schema = p[p.length - 2]
    return {
      sql: `SELECT * FROM information_schema.sequences WHERE sequence_schema='${esc(schema)}' AND sequence_name='${esc(name)}'`,
      mode: 'pg-sequence',
    }
  }
  if (node.kind === MetaNodeKind.Event && fam === 'mysql') {
    return {
      sql: `SHOW CREATE EVENT ${quoteId(dialect, name)}`,
      mode: 'mysql-event',
    }
  }
  return null
}

export function extractDefinition(
  dialect: DbDialect,
  node: TreeNode,
  mode: DefinitionFetch['mode'],
  row: Record<string, unknown>,
): string {
  if (mode === 'mysql-trigger') {
    const k = Object.keys(row).find((key) => /statement|create/i.test(key))
    return String(row[k ?? ''] ?? '')
  }
  if (mode === 'pg-trigger') return String(row.ddl ?? '')
  if (mode === 'mysql-event') {
    // SHOW CREATE EVENT 返回多列，含 'Create Event' / 'sql_mode' / 'time_zone' / 'event' 等
    const k = Object.keys(row).find((key) => /^create event$/i.test(key))
    return String(row[k ?? ''] ?? '')
  }
  // pg-sequence：由参数重建 CREATE SEQUENCE
  const q = (s: string) => quoteId(dialect, s)
  return `CREATE SEQUENCE ${q(node.name)}\n  INCREMENT BY ${row.increment}\n  MINVALUE ${row.minimum_value}\n  MAXVALUE ${row.maximum_value}\n  START WITH ${row.start_value};`
}

/** 生成「解释执行计划」SQL（目前支持 MySQL / PostgreSQL 系；其余返回 null）。 */
export function explainSql(dialect: DbDialect, sql: string): string | null {
  const s = sql.trim().replace(/;\s*$/, '')
  if (!s) return null
  switch (familyOf(dialect)) {
    case 'mysql':
    case 'pg':
      return `EXPLAIN ${s}`
    default:
      return null
  }
}

export type SqlTemplateKind =
  | 'select'
  | 'insert'
  | 'update'
  | 'delete'
  | 'createlike'
  | 'createindex'
  | 'comment'

export const SQL_TEMPLATE_LABEL: Record<SqlTemplateKind, string> = {
  select: '生成 SELECT',
  insert: '生成 INSERT',
  update: '生成 UPDATE',
  delete: '生成 DELETE',
  createlike: '复制表结构',
  createindex: '新建索引',
  comment: '编辑注释',
}

/** 由列信息生成 SELECT/INSERT/UPDATE/DELETE 模板（WHERE 优先用主键，否则取首列占位）。 */
export function buildSqlTemplate(
  dialect: DbDialect,
  kind: SqlTemplateKind,
  tableRef: string,
  cols: { name: string; pk: boolean }[],
): string {
  const q = (s: string) => quoteId(dialect, s)
  const names = cols.map((c) => q(c.name))
  const keyCols = cols.filter((c) => c.pk)
  const whereSrc = keyCols.length ? keyCols : cols.slice(0, 1)
  const where = whereSrc.map((c) => `${q(c.name)} = NULL`).join(' AND ') || '1 = 1'
  switch (kind) {
    case 'select':
      return `SELECT ${names.join(', ')}\nFROM ${tableRef};`
    case 'insert':
      return `INSERT INTO ${tableRef}\n  (${names.join(', ')})\nVALUES\n  (${cols.map(() => 'NULL').join(', ')});`
    case 'update':
      return `UPDATE ${tableRef} SET\n${cols.map((c) => `  ${q(c.name)} = NULL`).join(',\n')}\nWHERE ${where};`
    case 'delete':
      return `DELETE FROM ${tableRef}\nWHERE ${where};`
    case 'createlike': {
      // 复制表结构（把 new_table_copy 改成目标名后执行）
      const fam = familyOf(dialect)
      if (fam === 'mysql') return `CREATE TABLE new_table_copy LIKE ${tableRef};`
      if (fam === 'pg') return `CREATE TABLE new_table_copy (LIKE ${tableRef} INCLUDING ALL);`
      if (fam === 'sqlserver') return `SELECT * INTO new_table_copy FROM ${tableRef} WHERE 1 = 0;`
      return `CREATE TABLE new_table_copy AS SELECT * FROM ${tableRef} WHERE 1 = 0;` // oracle
    }
    case 'createindex': {
      // 新建索引模板：把列、索引名按需改写后执行；唯一索引去掉行首注释。
      const firstCol = names[0] ?? q('column_name')
      const idxName = `idx_${tableRef.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}_${cols[0]?.name ?? 'col'}`
      return `CREATE INDEX ${q(idxName)} ON ${tableRef} (${firstCol});\n-- 唯一索引：CREATE UNIQUE INDEX ${q(idxName)} ON ${tableRef} (${firstCol});\n-- 复合索引：在括号内追加更多列，逗号分隔。`
    }
    case 'comment': {
      // 表/列注释模板（方言写法差异较大）。
      const c0 = names[0] ?? q('column_name')
      const fam = familyOf(dialect)
      if (fam === 'mysql')
        return `ALTER TABLE ${tableRef} COMMENT = '表注释';\n-- 列注释需带完整列定义：\n-- ALTER TABLE ${tableRef} MODIFY ${c0} <类型> COMMENT '列注释';`
      if (fam === 'sqlserver')
        return (
          '-- SQL Server 用扩展属性记录注释：\n' +
          'EXEC sys.sp_addextendedproperty\n' +
          `  @name = N'MS_Description', @value = N'表注释',\n` +
          `  @level0type = N'SCHEMA', @level0name = N'dbo',\n` +
          `  @level1type = N'TABLE',  @level1name = N'表名';`
        )
      // pg / oracle
      return `COMMENT ON TABLE ${tableRef} IS '表注释';\n${cols.map((col) => `COMMENT ON COLUMN ${tableRef}.${q(col.name)} IS '列注释';`).join('\n')}`
    }
  }
}

/** 「查询前 N 行」的方言正确写法（SQL Server 无 LIMIT；Oracle/达梦用 FETCH FIRST）。 */
export function previewSql(dialect: DbDialect, tableRef: string, n = 200): string {
  switch (familyOf(dialect)) {
    case 'mysql':
    case 'pg':
      return `SELECT * FROM ${tableRef} LIMIT ${n};`
    case 'sqlserver':
      return `SELECT TOP ${n} * FROM ${tableRef};`
    case 'oracle':
      return `SELECT * FROM ${tableRef} FETCH FIRST ${n} ROWS ONLY;`
  }
}

export interface TableStats {
  rows: number
  dataBytes: number
  indexBytes: number
}

/** 表统计查询（行数 + 数据/索引占用）；仅 MySQL / PG 系，其余返回 null。 */
export function tableStatsQuery(
  dialect: DbDialect,
  ctx: TableContext,
  table: string,
): string | null {
  const esc = (s: string) => s.replace(/'/g, "''")
  switch (familyOf(dialect)) {
    case 'mysql':
      return `SELECT TABLE_ROWS AS row_cnt, DATA_LENGTH AS data_len, INDEX_LENGTH AS index_len
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = '${esc(ctx.database ?? '')}' AND TABLE_NAME = '${esc(table)}'`
    case 'pg':
      return `SELECT c.reltuples::bigint AS row_cnt, pg_table_size(c.oid) AS data_len, pg_indexes_size(c.oid) AS index_len
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = '${esc(ctx.schema ?? 'public')}' AND c.relname = '${esc(table)}'`
    default:
      return null
  }
}

export function parseTableStats(row: Record<string, unknown>): TableStats {
  const g = (k: string) => Number(row[k] ?? 0)
  return { rows: g('row_cnt'), dataBytes: g('data_len'), indexBytes: g('index_len') }
}

/** 字节数转可读单位。 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 2 : 0)} ${units[i]}`
}

export function quoteId(dialect: DbDialect, id: string): string {
  switch (familyOf(dialect)) {
    case 'mysql':
      return `\`${id.replace(/`/g, '``')}\``
    case 'sqlserver':
      return `[${id.replace(/]/g, ']]')}]`
    default:
      return `"${id.replace(/"/g, '""')}"`
  }
}

const TYPES: Record<Family, string[]> = {
  mysql: [
    'INT',
    'BIGINT',
    'TINYINT',
    'VARCHAR',
    'CHAR',
    'TEXT',
    'DECIMAL',
    'DOUBLE',
    'FLOAT',
    'DATE',
    'DATETIME',
    'TIMESTAMP',
    'JSON',
    'BLOB',
  ],
  pg: [
    'int4',
    'int8',
    'serial',
    'varchar',
    'char',
    'text',
    'numeric',
    'float8',
    'boolean',
    'date',
    'timestamp',
    'timestamptz',
    'uuid',
    'jsonb',
  ],
  sqlserver: [
    'INT',
    'BIGINT',
    'BIT',
    'NVARCHAR',
    'VARCHAR',
    'DECIMAL',
    'FLOAT',
    'DATE',
    'DATETIME2',
    'UNIQUEIDENTIFIER',
  ],
  oracle: ['NUMBER', 'VARCHAR2', 'CHAR', 'CLOB', 'DATE', 'TIMESTAMP', 'FLOAT', 'BLOB'],
}

export function typeOptions(dialect: DbDialect): string[] {
  return TYPES[familyOf(dialect)]
}

export interface TableContext {
  database?: string
  schema?: string
}

/** 从「表目录(Group)」或「表(Table)」节点推断目标库/schema。 */
export function deriveContext(dialect: DbDialect, node: TreeNode): TableContext {
  const container = node.kind === 'group' ? node.path : node.path.slice(0, -1)
  switch (familyOf(dialect)) {
    case 'mysql':
      return { database: container[0] }
    case 'pg':
    case 'sqlserver':
      return { database: container[0], schema: container[1] }
    case 'oracle':
      return { schema: container[0] }
  }
}

/**
 * 从「容器节点本身」（连接 / 库 / schema / 分组）推断库 + schema，
 * 用于新建查询时预选上下文 —— 这类节点的 path 就是其所在层级。
 * 连接节点 path 为空 → 返回空上下文（落到默认库）。
 */
export function contextOfNode(dialect: DbDialect, node: TreeNode): TableContext {
  const container = node.path
  switch (familyOf(dialect)) {
    case 'mysql':
      return { database: container[0] }
    case 'pg':
    case 'sqlserver':
      return { database: container[0], schema: container[1] }
    case 'oracle':
      return { schema: container[0] }
  }
}

/** ER 图：由「库 / schema」节点自身推断目标 database/schema。 */
export function erdContext(dialect: DbDialect, node: TreeNode): TableContext {
  const p = node.path
  switch (familyOf(dialect)) {
    case 'mysql':
      return { database: p[0] }
    case 'pg':
    case 'sqlserver':
      return { database: p[0], schema: p[1] ?? node.name }
    case 'oracle':
      return { schema: p[0] }
  }
}

/** 可在 Tab 中新建的对象类型。 */
export type ObjectKind =
  | 'table'
  | 'view'
  | 'materialized_view'
  | 'function'
  | 'procedure'
  | 'trigger'
  | 'sequence'
  | 'package'
  | 'type'
  | 'synonym'

export const OBJECT_LABEL: Record<ObjectKind, string> = {
  table: '新建表',
  view: '新建视图',
  materialized_view: '新建物化视图',
  function: '新建函数',
  procedure: '新建存储过程',
  trigger: '新建触发器',
  sequence: '新建序列',
  package: '新建包',
  type: '新建类型',
  synonym: '新建同义词',
}

/** 视图/函数/存储过程的起始 DDL 模板（按方言）。表用结构化设计器，不走这里。 */
export function objectTemplate(dialect: DbDialect, kind: ObjectKind, _ctx: TableContext): string {
  const fam = familyOf(dialect)
  const q = (id: string) => quoteId(dialect, id)
  if (kind === 'view') {
    return `CREATE VIEW ${q('new_view')} AS\nSELECT 1 AS col;`
  }
  if (kind === 'trigger') {
    switch (fam) {
      case 'mysql':
        return `CREATE TRIGGER ${q('trg_name')}\nBEFORE INSERT ON ${q('your_table')}\nFOR EACH ROW\nBEGIN\n  -- new.col := ...;\nEND`
      case 'pg':
        return `-- PG 触发器需先有触发函数：\nCREATE OR REPLACE FUNCTION ${q('trg_fn')}() RETURNS trigger AS $$\nBEGIN\n  RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql;\n\nCREATE TRIGGER ${q('trg_name')}\nBEFORE INSERT ON ${q('your_table')}\nFOR EACH ROW EXECUTE FUNCTION ${q('trg_fn')}();`
      case 'sqlserver':
        return `CREATE TRIGGER ${q('trg_name')} ON ${q('your_table')}\nAFTER INSERT AS\nBEGIN\n  SET NOCOUNT ON;\nEND;`
      case 'oracle':
        return `CREATE OR REPLACE TRIGGER ${q('TRG_NAME')}\nBEFORE INSERT ON ${q('YOUR_TABLE')}\nFOR EACH ROW\nBEGIN\n  NULL;\nEND;`
    }
  }
  if (kind === 'function') {
    switch (fam) {
      case 'mysql':
        return `CREATE FUNCTION ${q('new_func')}() RETURNS INT DETERMINISTIC\nBEGIN\n  RETURN 0;\nEND`
      case 'pg':
        return `CREATE FUNCTION ${q('new_func')}() RETURNS integer AS $$\nBEGIN\n  RETURN 0;\nEND;\n$$ LANGUAGE plpgsql;`
      case 'sqlserver':
        return `CREATE FUNCTION ${q('new_func')}() RETURNS INT AS\nBEGIN\n  RETURN 0;\nEND;`
      case 'oracle':
        return `CREATE FUNCTION ${q('NEW_FUNC')} RETURN NUMBER AS\nBEGIN\n  RETURN 0;\nEND;`
    }
  }
  // procedure
  switch (fam) {
    case 'mysql':
      return `CREATE PROCEDURE ${q('new_proc')}()\nBEGIN\n  SELECT 1;\nEND`
    case 'pg':
      return `CREATE PROCEDURE ${q('new_proc')}()\nLANGUAGE plpgsql AS $$\nBEGIN\nEND;\n$$;`
    case 'sqlserver':
      return `CREATE PROCEDURE ${q('new_proc')} AS\nBEGIN\n  SELECT 1;\nEND;`
    case 'oracle':
      return `CREATE PROCEDURE ${q('NEW_PROC')} AS\nBEGIN\n  NULL;\nEND;`
  }
}

const esc = (s: string) => s.replace(/'/g, "''")
const splitCols = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)

/**
 * DEFAULT 值的智能引号：数字、布尔、NULL、CURRENT_TIMESTAMP / NOW() 等保持原样；
 * 已被引号包裹（'…' / "…" / `…`）也原样；否则按字符串字面量加单引号并转义。
 * 修复了用户在设计器里直接写 `张三` 这类裸字时被原样拼成 `DEFAULT 张三` 报错的 bug。
 */
export function quoteDefaultValue(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^['"`]/.test(s)) return s
  if (/^-?\d+(\.\d+)?$/.test(s)) return s
  if (/^(NULL|TRUE|FALSE|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|LOCALTIMESTAMP)$/i.test(s))
    return s
  // 函数调用形式（NOW() / UUID() / gen_random_uuid() / GETDATE() …）保持原样
  if (/^[A-Za-z_][\w]*\s*\([^)]*\)$/.test(s)) return s
  return `'${s.replace(/'/g, "''")}'`
}

/**
 * 解析索引列项：支持 `name`、`name(10)`（MySQL 前缀长度）、`name DESC`、`name(10) DESC` 等组合。
 * 返回 { name, suffix }，suffix 已含 `(N)` 与 ` ASC/DESC` 顺序。
 */
function parseIdxCol(raw: string): { name: string; suffix: string } {
  const m = /^([^\s(]+)(\s*\([^)]*\))?\s*(asc|desc)?\s*$/i.exec(raw.trim())
  if (!m) return { name: raw.trim(), suffix: '' }
  const len = (m[2] ?? '').replace(/\s+/g, '')
  const ord = m[3] ? ` ${m[3].toUpperCase()}` : ''
  return { name: m[1], suffix: `${len}${ord}` }
}
function quoteIdxCol(dialect: DbDialect, raw: string): string {
  const p = parseIdxCol(raw)
  return `${quoteId(dialect, p.name)}${p.suffix}`
}

function colType(c: ColumnDef): string {
  const len = c.length.trim()
  const scale = c.scale.trim()
  if (len && scale) return `${c.type}(${len},${scale})`
  if (len) return `${c.type}(${len})`
  return c.type
}

const DROP_LABEL: Record<string, string> = {
  table: '表',
  view: '视图',
  function: '函数',
  procedure: '存储过程',
  sequence: '序列',
  trigger: '触发器',
  package: '包',
  type: '类型',
  synonym: '同义词',
  event: '事件',
  database: '数据库',
  schema: 'Schema',
}

export function objectKindLabel(kind: string): string {
  return DROP_LABEL[kind] ?? kind
}

/** 级联删除的方言语法后缀（不支持则空）。 */
function cascadeSuffix(fam: Family, kind: string, cascade: boolean): string {
  if (!cascade) return ''
  if (fam === 'pg' && ['schema', 'table', 'view', 'function'].includes(kind)) return ' CASCADE'
  if (fam === 'oracle' && kind === 'table') return ' CASCADE CONSTRAINTS'
  return ''
}

/** 该对象在该方言下是否支持级联删除（决定是否显示「级联」选项）。 */
export function dropSupportsCascade(dialect: DbDialect, kind: string): boolean {
  return cascadeSuffix(familyOf(dialect), kind, true) !== ''
}

/**
 * Group of items that share the same `(connId, ctx, kind, batchable)` slot →
 * one SQL statement per group when the dialect supports comma-separated
 * targets; one statement per item when it doesn't.
 *
 * Returned by buildBulkDrop / buildBulkTruncate so the caller can execute
 * each chunk inside a single round-trip + transaction (#25).
 */
export interface BulkSqlChunk {
  /** Statement to execute (may target multiple objects in one go). */
  sql: string
  /** Execution context: database + schema for routing/SET search_path. */
  ctx: TableContext
  /** Number of objects covered by this single SQL statement (for progress). */
  count: number
  /** Object names included (for per-item ✓/✗ UI when count > 1). */
  names: string[]
}

/**
 * Which (family, kind) pairs let us list multiple targets in one DROP
 * statement. Listed pairs save N-1 round trips per bulk action.
 *
 * - mysql:    DROP TABLE/VIEW/TRIGGER/EVENT/INDEX (comma-separated)
 *             DROP FUNCTION/PROCEDURE only takes one name → sequential.
 * - pg:       DROP TABLE/VIEW/SEQUENCE/INDEX/FUNCTION/PROCEDURE/TRIGGER
 *             all support comma-separated targets.
 * - sqlserver: DROP TABLE/VIEW/PROCEDURE/TRIGGER comma-separated;
 *             DROP FUNCTION one-at-a-time (different signature handling).
 * - oracle/dm: no multi-target DROP at all — always sequential.
 */
function dropSupportsMultiTarget(fam: Family, kind: string): boolean {
  if (fam === 'mysql') return ['table', 'view', 'trigger', 'event', 'sequence'].includes(kind)
  if (fam === 'pg')
    return ['table', 'view', 'sequence', 'function', 'procedure', 'trigger'].includes(kind)
  if (fam === 'sqlserver') return ['table', 'view', 'procedure', 'trigger'].includes(kind)
  return false // oracle / dm and anything else: sequential
}

/**
 * Build a minimal set of DROP statements for a batch of nodes.
 *
 * Strategy:
 *  1. Group items by (connId, ctx, kind) — within a group, all rows share
 *     schema + dialect + object kind, so a single multi-target DROP works
 *     when the family allows it.
 *  2. For families that allow `DROP TABLE a, b, c [CASCADE]` style, emit
 *     ONE chunk per group → one round trip executes the whole group.
 *  3. For Oracle / DM / SQLite and the mysql-DROP-FUNCTION case, emit one
 *     chunk per node — caller loops with fail-fast semantics (#25 spec).
 *
 * Skipped items (unsupported `node.kind`, no schema for triggers, ...) are
 * silently dropped from the output; caller can diff input vs sum-of-counts
 * to surface them in the UI.
 */
export function buildBulkDrop(
  dialect: DbDialect,
  items: { connId: string; node: TreeNode }[],
  cascade = false,
): { connId: string; chunk: BulkSqlChunk }[] {
  const fam = familyOf(dialect)
  const q = (id: string) => quoteId(dialect, id)
  const cs = (kind: string): string => cascadeSuffix(fam, kind, cascade)

  // Step 1: bucket by (connId | kind | schema | database). Keep the original
  // node refs so the per-item names list reflects input order.
  type Bucket = {
    connId: string
    kind: string
    ctx: TableContext
    nodes: TreeNode[]
  }
  const buckets = new Map<string, Bucket>()
  for (const it of items) {
    if (!buildDrop(dialect, it.node, cascade)) continue // skip undroppable
    const ctx = deriveContext(dialect, it.node)
    const key = [
      it.connId,
      it.node.kind,
      ctx.database ?? '',
      ctx.schema ?? '',
      // Triggers carry their owning table in path[-2] — keep buckets per-table
      it.node.kind === 'trigger' ? (it.node.path[it.node.path.length - 2] ?? '') : '',
    ].join('|')
    let b = buckets.get(key)
    if (!b) {
      b = { connId: it.connId, kind: it.node.kind, ctx, nodes: [] }
      buckets.set(key, b)
    }
    b.nodes.push(it.node)
  }

  const out: { connId: string; chunk: BulkSqlChunk }[] = []
  for (const b of buckets.values()) {
    const names = b.nodes.map((n) => n.name)
    if (dropSupportsMultiTarget(fam, b.kind) && b.nodes.length > 1) {
      // Native multi-target DROP. PG / MySQL / SQL Server.
      const targets = b.nodes.map((n) => n.sqlName ?? q(n.name)).join(', ')
      const prefix =
        b.kind === 'trigger' && fam === 'pg'
          ? // PG: DROP TRIGGER name ON table → can't batch across triggers on different tables
            // (we bucketed by owning table already). Build per-table batched DROP.
            (() => {
              const tbl = b.nodes[0].path[b.nodes[0].path.length - 2]
              return `DROP TRIGGER ${b.nodes.map((n) => q(n.name)).join(', ')} ON ${q(tbl)}`
            })()
          : `DROP ${kindKeyword(b.kind, fam)} ${targets}`
      out.push({
        connId: b.connId,
        chunk: { sql: `${prefix}${cs(b.kind)}`, ctx: b.ctx, count: b.nodes.length, names },
      })
    } else {
      // Sequential fallback — one chunk per node.
      for (const n of b.nodes) {
        const r = buildDrop(dialect, n, cascade)
        if (!r) continue
        out.push({
          connId: b.connId,
          chunk: { sql: r.sql, ctx: r.ctx, count: 1, names: [n.name] },
        })
      }
    }
  }
  return out
}

/** SQL keyword for a node kind, varies per dialect for a few. */
function kindKeyword(kind: string, _fam: Family): string {
  switch (kind) {
    case 'table':
      return 'TABLE'
    case 'view':
      return 'VIEW'
    case 'sequence':
      return 'SEQUENCE'
    case 'function':
      return 'FUNCTION'
    case 'procedure':
      return 'PROCEDURE'
    case 'trigger':
      return 'TRIGGER'
    case 'event':
      return 'EVENT'
    default:
      return kind.toUpperCase()
  }
}

/**
 * Build TRUNCATE statements for a batch of table nodes.
 *
 * - PG supports `TRUNCATE TABLE a, b, c [CASCADE]` natively → one round trip
 *   per (connId, schema). CASCADE optional.
 * - MySQL only truncates one table per statement → sequential.
 * - SQL Server only truncates one per statement → sequential.
 * - Oracle: `TRUNCATE TABLE name` one at a time → sequential.
 * - SQLite: no TRUNCATE; emit `DELETE FROM name` (no row-count returned but
 *   removes everything; same semantic for our UI).
 *
 * Non-table nodes are silently skipped.
 */
export function buildBulkTruncate(
  dialect: DbDialect,
  items: { connId: string; node: TreeNode }[],
  cascade = false,
): { connId: string; chunk: BulkSqlChunk }[] {
  const fam = familyOf(dialect)
  const q = (id: string) => quoteId(dialect, id)
  const onlyTables = items.filter((it) => it.node.kind === 'table')
  if (!onlyTables.length) return []

  // Bucket by (connId, ctx) so PG can emit one TRUNCATE per (schema, db)
  type Bucket = { connId: string; ctx: TableContext; nodes: TreeNode[] }
  const buckets = new Map<string, Bucket>()
  for (const it of onlyTables) {
    const ctx = deriveContext(dialect, it.node)
    const key = [it.connId, ctx.database ?? '', ctx.schema ?? ''].join('|')
    let b = buckets.get(key)
    if (!b) {
      b = { connId: it.connId, ctx, nodes: [] }
      buckets.set(key, b)
    }
    b.nodes.push(it.node)
  }

  const out: { connId: string; chunk: BulkSqlChunk }[] = []
  for (const b of buckets.values()) {
    const names = b.nodes.map((n) => n.name)
    if (fam === 'pg' && b.nodes.length > 1) {
      const targets = b.nodes.map((n) => n.sqlName ?? q(n.name)).join(', ')
      const suffix = cascade ? ' CASCADE' : ''
      out.push({
        connId: b.connId,
        chunk: {
          sql: `TRUNCATE TABLE ${targets}${suffix}`,
          ctx: b.ctx,
          count: b.nodes.length,
          names,
        },
      })
      continue
    }
    // Sequential fallback (mysql, sqlserver, oracle, dm, sqlite)
    for (const n of b.nodes) {
      const ref = n.sqlName ?? q(n.name)
      const sql = dialect === DbDialect.SQLite ? `DELETE FROM ${ref}` : `TRUNCATE TABLE ${ref}`
      out.push({ connId: b.connId, chunk: { sql, ctx: b.ctx, count: 1, names: [n.name] } })
    }
  }
  return out
}

/** 生成某节点的 DROP 语句 + 执行上下文；不可删除的节点返回 null。 */
export function buildDrop(
  dialect: DbDialect,
  node: TreeNode,
  cascade = false,
): { sql: string; ctx: TableContext } | null {
  const q = (id: string) => quoteId(dialect, id)
  const fam = familyOf(dialect)
  const ctx = deriveContext(dialect, node)
  const name = node.name
  const cs = cascadeSuffix(fam, node.kind, cascade)
  switch (node.kind) {
    case 'table':
      return { sql: `DROP TABLE ${node.sqlName ?? q(name)}${cs}`, ctx }
    case 'view':
      return { sql: `DROP VIEW ${node.sqlName ?? q(name)}${cs}`, ctx }
    case 'materialized_view':
      return { sql: `DROP MATERIALIZED VIEW ${node.sqlName ?? q(name)}${cs}`, ctx }
    case 'function':
      return { sql: `DROP FUNCTION ${q(name)}${cs}`, ctx }
    case 'procedure':
      return { sql: `DROP PROCEDURE ${q(name)}`, ctx }
    case 'sequence':
      return { sql: `DROP SEQUENCE ${node.sqlName ?? q(name)}${cs}`, ctx }
    case 'trigger': {
      if (fam === 'mysql') return { sql: `DROP TRIGGER ${q(name)}`, ctx }
      // Oracle/DM: 触发器是 schema 级对象 → DROP TRIGGER schema.name（不带 ON 表）。
      // 之前用 path 倒数第二段当"表"，但 Oracle/DM 下那是 schema → 生成的语句报错。
      if (fam === 'oracle') return { sql: `DROP TRIGGER ${node.sqlName ?? q(name)}`, ctx }
      // PG：DROP TRIGGER name ON 表（表取自 path 倒数第二段）
      const tbl = node.path[node.path.length - 2]
      return tbl ? { sql: `DROP TRIGGER ${q(name)} ON ${q(tbl)}${cs}`, ctx } : null
    }
    case 'package':
      return { sql: `DROP PACKAGE ${node.sqlName ?? q(name)}`, ctx }
    case 'synonym':
      return { sql: `DROP SYNONYM ${node.sqlName ?? q(name)}`, ctx }
    case 'type':
      // cascade → FORCE：类型被表/列引用时强制删除（Oracle/DM 语义）。
      return { sql: `DROP TYPE ${node.sqlName ?? q(name)}${cascade ? ' FORCE' : ''}`, ctx }
    case 'event':
      return fam === 'mysql' ? { sql: `DROP EVENT ${q(name)}`, ctx } : null
    case 'database':
      return { sql: `DROP DATABASE ${q(name)}`, ctx: {} }
    case 'schema':
      return fam === 'mysql'
        ? { sql: `DROP DATABASE ${q(name)}`, ctx: {} }
        : { sql: `DROP SCHEMA ${q(name)}${cs}`, ctx }
    default:
      return null
  }
}

/** 由完整表规格生成 DDL（可能多条语句：CREATE TABLE + 索引 + 注释）。 */
export function buildCreateTable(
  dialect: DbDialect,
  ctx: TableContext,
  tableName: string,
  spec: TableSpec,
): string {
  const q = (id: string) => quoteId(dialect, id)
  const fam = familyOf(dialect)
  const tbl = tableName.trim() || 'new_table'
  // SQL Server 用 USE 切库后仍需 schema 限定；其余靠执行上下文(search_path/USE/CURRENT_SCHEMA)
  const name = fam === 'sqlserver' && ctx.schema ? `${q(ctx.schema)}.${q(tbl)}` : q(tbl)

  const cols = spec.columns.filter((c) => c.name.trim() && c.type.trim())
  const lines = cols.map((c) => {
    // 生成列：GENERATED ALWAYS AS (expr) STORED（不带 NULL/DEFAULT）
    if (c.generated?.trim()) {
      let g = `  ${q(c.name)} ${colType(c)} GENERATED ALWAYS AS (${c.generated.trim()}) STORED`
      if (c.comment.trim() && fam === 'mysql') g += ` COMMENT '${esc(c.comment.trim())}'`
      return g
    }
    let s = `  ${q(c.name)} ${colType(c)}`
    if (fam === 'mysql' && c.unsigned) s += ' UNSIGNED'
    if (fam === 'mysql' && c.zerofill) s += ' ZEROFILL'
    if (fam === 'mysql' && c.charset?.trim()) s += ` CHARACTER SET ${c.charset.trim()}`
    if (fam === 'mysql' && c.collation?.trim()) s += ` COLLATE ${c.collation.trim()}`
    s += c.nullable ? ' NULL' : ' NOT NULL'
    if (fam === 'mysql' && c.autoIncrement) s += ' AUTO_INCREMENT'
    if (c.defaultValue.trim()) s += ` DEFAULT ${quoteDefaultValue(c.defaultValue)}`
    if (fam === 'mysql' && c.onUpdateNow) s += ' ON UPDATE CURRENT_TIMESTAMP'
    if (c.comment.trim() && fam === 'mysql') s += ` COMMENT '${esc(c.comment.trim())}'`
    return s
  })

  const pks = cols.filter((c) => c.primaryKey).map((c) => q(c.name))
  if (pks.length) lines.push(`  PRIMARY KEY (${pks.join(', ')})`)

  for (const u of spec.uniques) {
    const c = splitCols(u.columns)
    if (!c.length) continue
    lines.push(
      `  ${u.name.trim() ? `CONSTRAINT ${q(u.name.trim())} ` : ''}UNIQUE (${c.map(q).join(', ')})`,
    )
  }
  for (const ck of spec.checks) {
    if (!ck.expression.trim()) continue
    lines.push(
      `  ${ck.name.trim() ? `CONSTRAINT ${q(ck.name.trim())} ` : ''}CHECK (${ck.expression.trim()})`,
    )
  }
  for (const fk of spec.foreignKeys) {
    const lc = splitCols(fk.columns)
    const rc = splitCols(fk.refColumns)
    if (!lc.length || !fk.refTable.trim() || !rc.length) continue
    const s = `  ${fk.name.trim() ? `CONSTRAINT ${q(fk.name.trim())} ` : ''}FOREIGN KEY (${lc.map(q).join(', ')}) REFERENCES ${q(fk.refTable.trim())} (${rc.map(q).join(', ')})${fkSuffix(fk, fam)}`
    lines.push(s)
  }
  // MySQL 索引可内联
  if (fam === 'mysql') {
    for (const idx of spec.indexes) {
      const c = splitCols(idx.columns)
      if (!c.length) continue
      const ty = (idx.type ?? '').toUpperCase()
      const prefix = ty === 'FULLTEXT' || ty === 'SPATIAL' ? `${ty} ` : ''
      const using = ty === 'BTREE' || ty === 'HASH' ? ` USING ${ty}` : ''
      const uniq = idx.unique && !prefix ? 'UNIQUE ' : ''
      const colExpr = c.map((r) => quoteIdxCol(dialect, r)).join(', ')
      const idxName = q(idx.name.trim() || `idx_${c.map((r) => parseIdxCol(r).name).join('_')}`)
      lines.push(`  ${uniq}${prefix}INDEX ${idxName} (${colExpr})${using}`)
    }
  }

  let create = `CREATE TABLE ${name} (\n${lines.join(',\n')}\n)`
  if (fam === 'mysql') {
    const opts: string[] = []
    if (spec.engine.trim()) opts.push(`ENGINE=${spec.engine.trim()}`)
    if (spec.charset.trim()) opts.push(`DEFAULT CHARSET=${spec.charset.trim()}`)
    if (spec.collation.trim()) opts.push(`COLLATE=${spec.collation.trim()}`)
    if (spec.rowFormat.trim()) opts.push(`ROW_FORMAT=${spec.rowFormat.trim()}`)
    if (spec.autoIncStart.trim()) opts.push(`AUTO_INCREMENT=${spec.autoIncStart.trim()}`)
    if (spec.comment.trim()) opts.push(`COMMENT='${esc(spec.comment.trim())}'`)
    if (opts.length) create += ` ${opts.join(' ')}`
  }
  if (fam === 'pg') {
    if (spec.inherits.trim()) create += ` INHERITS (${q(spec.inherits.trim())})`
    if (spec.fillfactor.trim()) create += ` WITH (fillfactor=${spec.fillfactor.trim()})`
    if (spec.tablespace.trim()) create += ` TABLESPACE ${q(spec.tablespace.trim())}`
  }
  create += ';'

  const statements = [create]

  // 非 MySQL：索引单独 CREATE INDEX
  if (fam !== 'mysql') {
    for (const idx of spec.indexes) {
      const c = splitCols(idx.columns)
      if (!c.length) continue
      const using = idx.type?.trim() ? ` USING ${idx.type.trim()}` : ''
      const baseNames = c.map((r) => parseIdxCol(r).name)
      const colExpr = c.map((r) => quoteIdxCol(dialect, r)).join(', ')
      const where = idx.where?.trim()
      const whereSuffix = where ? ` WHERE ${where.startsWith('(') ? where : `(${where})`}` : ''
      const conc = idx.concurrent && fam === 'pg' ? 'CONCURRENTLY ' : ''
      statements.push(
        `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${conc}${q(idx.name.trim() || `idx_${tbl}_${baseNames.join('_')}`)} ON ${name}${using} (${colExpr})${whereSuffix};`,
      )
    }
  }
  // PG / Oracle：表与列注释用 COMMENT ON
  if (fam === 'pg' || fam === 'oracle') {
    if (spec.comment.trim())
      statements.push(`COMMENT ON TABLE ${name} IS '${esc(spec.comment.trim())}';`)
    for (const c of cols) {
      if (c.comment.trim())
        statements.push(`COMMENT ON COLUMN ${name}.${q(c.name)} IS '${esc(c.comment.trim())}';`)
    }
  }

  return statements.join('\n')
}

/**
 * 由「原始列快照 + 当前表规格」diff 出 ALTER 语句（MySQL / PostgreSQL 系）。
 * - 列：按 originalName 配对 → 识别 新增 / 删除 / 改名 / 改类型·空否·默认·注释。
 * - 主键：对比原始列 PK 集合 vs 当前列 PK 集合 → DROP/ADD PRIMARY KEY。
 * - 约束/索引：改表模式下设计器约束页从空白开始，凡填写者均视为「新增」→ ALTER ADD / CREATE INDEX。
 * - 删除既有约束（UNIQUE/CHECK）本版不处理（请用 SQL 编辑器）。
 * 返回不带分号的语句数组；调用方拼接预览或逐条执行（executeBatch 事务）。
 */
export function buildAlterTable(
  dialect: DbDialect,
  tableRef: string,
  original: ColumnDef[],
  spec: TableSpec,
  /** 改表模式载入的现有索引 / 外键快照；用于 diff 出新增与删除（缺省视为全新增） */
  originalExtras: { indexes?: IndexDef[]; foreignKeys?: ForeignKeyDef[] } = {},
): string[] {
  const q = (id: string) => quoteId(dialect, id)
  const fam = familyOf(dialect)
  const stmts: string[] = []
  const current = spec.columns.filter((c) => c.name.trim() && c.type.trim())
  const kept = new Set(current.filter((c) => c.originalName).map((c) => c.originalName as string))

  // 删除：原有列在当前已不存在
  for (const o of original) {
    if (!kept.has(o.name)) stmts.push(`ALTER TABLE ${tableRef} DROP COLUMN ${q(o.name)}`)
  }

  const origByName = new Map(original.map((o) => [o.name, o]))
  for (const c of current) {
    const t = colType(c)
    if (!c.originalName) {
      // 新增列
      if (fam === 'mysql') {
        let s = `ALTER TABLE ${tableRef} ADD COLUMN ${q(c.name)} ${t}`
        if (c.unsigned) s += ' UNSIGNED'
        if (c.zerofill) s += ' ZEROFILL'
        if (c.charset?.trim()) s += ` CHARACTER SET ${c.charset.trim()}`
        if (c.collation?.trim()) s += ` COLLATE ${c.collation.trim()}`
        s += c.nullable ? ' NULL' : ' NOT NULL'
        if (c.defaultValue.trim()) s += ` DEFAULT ${quoteDefaultValue(c.defaultValue)}`
        if (c.comment.trim()) s += ` COMMENT '${esc(c.comment.trim())}'`
        stmts.push(s)
      } else if (fam === 'oracle') {
        // Oracle / DM: ALTER TABLE t ADD (col DEF) — parens required, no
        // 'COLUMN' keyword (#21: 'COLUMN' is reserved in Oracle, so the
        // generic 'ADD COLUMN' shape failed with ORA-3050).
        let s = `ALTER TABLE ${tableRef} ADD (${q(c.name)} ${t}${c.nullable ? '' : ' NOT NULL'}`
        if (c.defaultValue.trim()) s += ` DEFAULT ${quoteDefaultValue(c.defaultValue)}`
        s += ')'
        stmts.push(s)
        if (c.comment.trim())
          stmts.push(`COMMENT ON COLUMN ${tableRef}.${q(c.name)} IS '${esc(c.comment.trim())}'`)
      } else if (fam === 'sqlserver') {
        // SQL Server: ALTER TABLE t ADD col DEF — no 'COLUMN' keyword either.
        let s = `ALTER TABLE ${tableRef} ADD ${q(c.name)} ${t}${c.nullable ? '' : ' NOT NULL'}`
        if (c.defaultValue.trim()) s += ` DEFAULT ${quoteDefaultValue(c.defaultValue)}`
        stmts.push(s)
      } else {
        // PG family (postgresql, kingbase, cockroachdb, greenplum, opengauss, h2)
        let s = `ALTER TABLE ${tableRef} ADD COLUMN ${q(c.name)} ${t}${c.nullable ? '' : ' NOT NULL'}`
        if (c.defaultValue.trim()) s += ` DEFAULT ${quoteDefaultValue(c.defaultValue)}`
        stmts.push(s)
        if (c.comment.trim())
          stmts.push(`COMMENT ON COLUMN ${tableRef}.${q(c.name)} IS '${esc(c.comment.trim())}'`)
      }
      continue
    }
    // 既有列：比对原始快照
    const o = origByName.get(c.originalName)
    if (!o) continue
    const renamed = c.name !== c.originalName
    const typeChanged = colType(o) !== t
    const nullChanged = o.nullable !== c.nullable
    const defChanged = o.defaultValue.trim() !== c.defaultValue.trim()
    const commentChanged = o.comment.trim() !== c.comment.trim()
    const charsetChanged = (o.charset ?? '').trim() !== (c.charset ?? '').trim()
    const collationChanged = (o.collation ?? '').trim() !== (c.collation ?? '').trim()
    if (fam === 'mysql') {
      // CHANGE 一步完成改名 + 重定义
      if (
        renamed ||
        typeChanged ||
        nullChanged ||
        defChanged ||
        commentChanged ||
        charsetChanged ||
        collationChanged
      ) {
        let s = `ALTER TABLE ${tableRef} CHANGE ${q(c.originalName)} ${q(c.name)} ${t}`
        if (c.unsigned) s += ' UNSIGNED'
        if (c.zerofill) s += ' ZEROFILL'
        if (c.charset?.trim()) s += ` CHARACTER SET ${c.charset.trim()}`
        if (c.collation?.trim()) s += ` COLLATE ${c.collation.trim()}`
        s += c.nullable ? ' NULL' : ' NOT NULL'
        if (c.defaultValue.trim()) s += ` DEFAULT ${quoteDefaultValue(c.defaultValue)}`
        if (c.comment.trim()) s += ` COMMENT '${esc(c.comment.trim())}'`
        stmts.push(s)
      }
    } else if (fam === 'oracle') {
      // Oracle / DM:
      //   RENAME → ALTER TABLE t RENAME COLUMN c1 TO c2
      //   MODIFY → ALTER TABLE t MODIFY (col DEF)   (parens, not ALTER COLUMN)
      //   COMMENT → COMMENT ON COLUMN t.col IS '...'
      if (renamed)
        stmts.push(`ALTER TABLE ${tableRef} RENAME COLUMN ${q(c.originalName)} TO ${q(c.name)}`)
      const col = q(c.name)
      if (typeChanged || nullChanged || defChanged) {
        let modify = `ALTER TABLE ${tableRef} MODIFY (${col} ${t}`
        // Oracle MODIFY needs NOT NULL re-stated if it was already NOT NULL and we're changing other things;
        // safest is to always reflect the desired nullability.
        modify += c.nullable ? '' : ' NOT NULL'
        if (c.defaultValue.trim()) modify += ` DEFAULT ${quoteDefaultValue(c.defaultValue)}`
        modify += ')'
        stmts.push(modify)
      }
      if (commentChanged)
        stmts.push(`COMMENT ON COLUMN ${tableRef}.${col} IS '${esc(c.comment.trim())}'`)
    } else if (fam === 'sqlserver') {
      // SQL Server:
      //   RENAME → EXEC sp_rename 'schema.t.c1', 'c2', 'COLUMN'
      //   MODIFY → ALTER TABLE t ALTER COLUMN col DEF (no TYPE keyword; SQL Server fuses type+null)
      if (renamed)
        stmts.push(`EXEC sp_rename '${tableRef}.${c.originalName}', '${c.name}', 'COLUMN'`)
      const col = q(c.name)
      if (typeChanged || nullChanged)
        stmts.push(
          `ALTER TABLE ${tableRef} ALTER COLUMN ${col} ${t}${c.nullable ? ' NULL' : ' NOT NULL'}`,
        )
      if (defChanged && c.defaultValue.trim())
        stmts.push(
          `ALTER TABLE ${tableRef} ADD DEFAULT ${quoteDefaultValue(c.defaultValue)} FOR ${col}`,
        )
    } else {
      // PG family
      if (renamed)
        stmts.push(`ALTER TABLE ${tableRef} RENAME COLUMN ${q(c.originalName)} TO ${q(c.name)}`)
      const col = q(c.name)
      if (typeChanged) stmts.push(`ALTER TABLE ${tableRef} ALTER COLUMN ${col} TYPE ${t}`)
      if (nullChanged)
        stmts.push(
          `ALTER TABLE ${tableRef} ALTER COLUMN ${col} ${c.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`,
        )
      if (defChanged)
        stmts.push(
          `ALTER TABLE ${tableRef} ALTER COLUMN ${col} ${c.defaultValue.trim() ? `SET DEFAULT ${quoteDefaultValue(c.defaultValue)}` : 'DROP DEFAULT'}`,
        )
      if (commentChanged)
        stmts.push(`COMMENT ON COLUMN ${tableRef}.${col} IS '${esc(c.comment.trim())}'`)
    }
  }

  // ── 主键 diff ─────────────────────────────────────────────
  // 用户报告:改表设计器里勾上某列的 PK,保存时 ALTER 语句为空 → 没修改主键.
  // 修法:对比 原始列 PK 集合 vs 当前列 PK 集合,有变化就生成 DROP + ADD.
  // 各方言差异:
  //   - MySQL: DROP PRIMARY KEY / ADD PRIMARY KEY (...)
  //   - PG 系: DROP CONSTRAINT IF EXISTS "<table>_pkey" / ADD PRIMARY KEY (...)
  //            (PG 默认 pk 约束名是 <裸表名>_pkey,用 IF EXISTS 保险)
  //   - Oracle/DM: DROP PRIMARY KEY / ADD PRIMARY KEY (...)  (Oracle 也支持)
  //   - SqlServer: DROP CONSTRAINT 需约束名,简单走 PK_<table> 约定 + IF EXISTS
  const oldPkCols = original.filter((o) => o.primaryKey).map((o) => o.name)
  const newPkCols = current.filter((c) => c.primaryKey).map((c) => c.name)
  const pkChanged =
    oldPkCols.length !== newPkCols.length || oldPkCols.some((n, i) => n !== newPkCols[i])
  if (pkChanged) {
    if (oldPkCols.length) {
      if (fam === 'mysql' || fam === 'oracle') {
        stmts.push(`ALTER TABLE ${tableRef} DROP PRIMARY KEY`)
      } else if (fam === 'pg') {
        // 取裸表名(去掉 "schema". 引号)拼 _pkey,IF EXISTS 容错
        const baseName = tableRef.replace(/^.*\./, '').replace(/['"`\[\]]/g, '')
        stmts.push(`ALTER TABLE ${tableRef} DROP CONSTRAINT IF EXISTS ${q(`${baseName}_pkey`)}`)
      } else if (fam === 'sqlserver') {
        const baseName = tableRef.replace(/^.*\./, '').replace(/['"`\[\]]/g, '')
        stmts.push(`ALTER TABLE ${tableRef} DROP CONSTRAINT IF EXISTS ${q(`PK_${baseName}`)}`)
      }
    }
    if (newPkCols.length) {
      stmts.push(`ALTER TABLE ${tableRef} ADD PRIMARY KEY (${newPkCols.map(q).join(', ')})`)
    }
  }

  // 新增约束 / 索引（改表模式约束页从空白开始 → 视为新增）
  for (const u of spec.uniques) {
    const cols = splitCols(u.columns)
    if (!cols.length) continue
    stmts.push(
      `ALTER TABLE ${tableRef} ADD ${u.name.trim() ? `CONSTRAINT ${q(u.name.trim())} ` : ''}UNIQUE (${cols.map(q).join(', ')})`,
    )
  }
  for (const ck of spec.checks) {
    if (!ck.expression.trim()) continue
    stmts.push(
      `ALTER TABLE ${tableRef} ADD ${ck.name.trim() ? `CONSTRAINT ${q(ck.name.trim())} ` : ''}CHECK (${ck.expression.trim()})`,
    )
  }
  // ── 外键：diff 出新增 / 删除（按名字；定义变化 = 先删后加）──
  const fkSig = (f: ForeignKeyDef) =>
    `${splitCols(f.columns).join(',')}>${f.refTable.trim()}(${splitCols(f.refColumns).join(',')})|${f.onDelete}|${f.onUpdate}`
  const origFks = originalExtras.foreignKeys ?? []
  const specFkByName = new Map(
    spec.foreignKeys.filter((f) => f.name.trim()).map((f) => [f.name.trim(), f]),
  )
  const dropFk = (name: string) =>
    fam === 'mysql'
      ? `ALTER TABLE ${tableRef} DROP FOREIGN KEY ${q(name)}`
      : `ALTER TABLE ${tableRef} DROP CONSTRAINT ${q(name)}`
  for (const o of origFks) {
    const s = o.name ? specFkByName.get(o.name) : undefined
    if (!s || fkSig(s) !== fkSig(o)) stmts.push(dropFk(o.name))
  }
  const origFkByName = new Map(origFks.map((f) => [f.name, f]))
  for (const fk of spec.foreignKeys) {
    const lc = splitCols(fk.columns)
    const rc = splitCols(fk.refColumns)
    if (!lc.length || !fk.refTable.trim() || !rc.length) continue
    const o = fk.name.trim() ? origFkByName.get(fk.name.trim()) : undefined
    if (o && fkSig(o) === fkSig(fk)) continue // 未变化，跳过
    const s = `ALTER TABLE ${tableRef} ADD ${fk.name.trim() ? `CONSTRAINT ${q(fk.name.trim())} ` : ''}FOREIGN KEY (${lc.map(q).join(', ')}) REFERENCES ${q(fk.refTable.trim())} (${rc.map(q).join(', ')})${fkSuffix(fk, fam)}`
    stmts.push(s)
  }

  // ── 索引：diff 出新增 / 删除（按名字；列或唯一性变化 = 先删后建）──
  const idxSig = (ix: IndexDef) =>
    `${splitCols(ix.columns).join(',')}|${ix.unique ? 1 : 0}|${ix.type ?? ''}|${(ix.where ?? '').trim()}|${ix.concurrent ? 1 : 0}`
  const origIdx = originalExtras.indexes ?? []
  const specIdxByName = new Map(
    spec.indexes.filter((i) => i.name.trim()).map((i) => [i.name.trim(), i]),
  )
  const dropIdx = (name: string) =>
    fam === 'mysql'
      ? `ALTER TABLE ${tableRef} DROP INDEX ${q(name)}`
      : `DROP INDEX IF EXISTS ${q(name)}`
  for (const o of origIdx) {
    const s = o.name ? specIdxByName.get(o.name) : undefined
    if (!s || idxSig(s) !== idxSig(o)) stmts.push(dropIdx(o.name))
  }
  const origIdxByName = new Map(origIdx.map((i) => [i.name, i]))
  for (const idx of spec.indexes) {
    const cols = splitCols(idx.columns)
    if (!cols.length) continue
    const o = idx.name.trim() ? origIdxByName.get(idx.name.trim()) : undefined
    if (o && idxSig(o) === idxSig(idx)) continue // 未变化，跳过
    const using = idx.type?.trim() ? ` USING ${idx.type.trim()}` : ''
    const baseNames = cols.map((r) => parseIdxCol(r).name)
    const colExpr = cols.map((r) => quoteIdxCol(dialect, r)).join(', ')
    const where = idx.where?.trim()
    const whereSuffix = where ? ` WHERE ${where.startsWith('(') ? where : `(${where})`}` : ''
    const conc = idx.concurrent && fam === 'pg' ? 'CONCURRENTLY ' : ''
    stmts.push(
      `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${conc}${q(idx.name.trim() || `idx_${baseNames.join('_')}`)} ON ${tableRef}${using} (${colExpr})${whereSuffix}`,
    )
  }

  return stmts
}

/** 现有索引查询（排除主键）；MySQL / PG，返回 {name, columns(逗号), unique}。其余 null。 */
export function existingIndexesQuery(
  dialect: DbDialect,
  ctx: TableContext,
  table: string,
): string | null {
  const esc = (s: string) => s.replace(/'/g, "''")
  switch (familyOf(dialect)) {
    case 'mysql':
      return `SELECT INDEX_NAME AS name, (1 - MIN(NON_UNIQUE)) AS uniq,
        GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = '${esc(ctx.database ?? '')}' AND TABLE_NAME = '${esc(table)}' AND INDEX_NAME <> 'PRIMARY'
        GROUP BY INDEX_NAME`
    case 'pg':
      return `SELECT i.relname AS name, ix.indisunique AS uniq,
        (SELECT string_agg(a.attname, ',') FROM pg_attribute a WHERE a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)) AS cols
        FROM pg_index ix
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = '${esc(ctx.schema ?? 'public')}' AND t.relname = '${esc(table)}' AND NOT ix.indisprimary`
    default:
      return null
  }
}

/** 入向外键：哪些表通过外键引用了本表（依赖反向）。MySQL / PG，返回 {srctab, name, cols}。其余 null。 */
export function incomingForeignKeysQuery(
  dialect: DbDialect,
  ctx: TableContext,
  table: string,
): string | null {
  const esc = (s: string) => s.replace(/'/g, "''")
  switch (familyOf(dialect)) {
    case 'mysql':
      // 同时返回源列 cols 与对应被引用列 refcols（按 ORDINAL_POSITION 同序聚合），
      // 用于单元格上「反向外键导航」精确定位到「被本行某列引用」的源表行。
      return `SELECT TABLE_NAME AS srctab, CONSTRAINT_NAME AS name,
        GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) AS cols,
        GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION) AS refcols
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE REFERENCED_TABLE_SCHEMA = '${esc(ctx.database ?? '')}' AND REFERENCED_TABLE_NAME = '${esc(table)}'
        GROUP BY TABLE_NAME, CONSTRAINT_NAME`
    case 'pg':
      return `SELECT t.relname AS srctab, con.conname AS name,
        (SELECT string_agg(a.attname, ',') FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)) AS cols,
        (SELECT string_agg(a.attname, ',') FROM pg_attribute a WHERE a.attrelid = con.confrelid AND a.attnum = ANY(con.confkey)) AS refcols
        FROM pg_constraint con
        JOIN pg_class t ON t.oid = con.conrelid
        JOIN pg_class rt ON rt.oid = con.confrelid
        JOIN pg_namespace rn ON rn.oid = rt.relnamespace
        WHERE con.contype = 'f' AND rn.nspname = '${esc(ctx.schema ?? 'public')}' AND rt.relname = '${esc(table)}'`
    default:
      return null
  }
}

/** 现有外键查询；MySQL / PG，返回 {name, columns, refTable, refColumns}。其余 null。 */
export function existingForeignKeysQuery(
  dialect: DbDialect,
  ctx: TableContext,
  table: string,
): string | null {
  const esc = (s: string) => s.replace(/'/g, "''")
  switch (familyOf(dialect)) {
    case 'mysql':
      return `SELECT CONSTRAINT_NAME AS name, GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) AS cols,
        REFERENCED_TABLE_NAME AS reftab, GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION) AS refcols
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = '${esc(ctx.database ?? '')}' AND TABLE_NAME = '${esc(table)}' AND REFERENCED_TABLE_NAME IS NOT NULL
        GROUP BY CONSTRAINT_NAME, REFERENCED_TABLE_NAME`
    case 'pg':
      return `SELECT con.conname AS name,
        (SELECT string_agg(a.attname, ',') FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)) AS cols,
        cl.relname AS reftab,
        (SELECT string_agg(a.attname, ',') FROM pg_attribute a WHERE a.attrelid = con.confrelid AND a.attnum = ANY(con.confkey)) AS refcols
        FROM pg_constraint con
        JOIN pg_class t ON t.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_class cl ON cl.oid = con.confrelid
        WHERE n.nspname = '${esc(ctx.schema ?? 'public')}' AND t.relname = '${esc(table)}' AND con.contype = 'f'`
    default:
      return null
  }
}

/**
 * 对象依赖查询（影响分析）：返回「被谁依赖 dependents」+「依赖什么 dependsOn」两条 SQL。
 * 输出列统一别名 sch / nm / ty（避开各方言保留字 schema/name/type）。不支持的方言返回 null。
 *  - Oracle/DM：all_dependencies（最全，覆盖视图/函数/过程/包/触发器等对象级依赖）
 *  - PG 系 / MySQL 系：information_schema.view_table_usage（SQL 标准，视图↔表;MySQL 需 8.0.13+）
 *  - SQLite/DuckDB/ClickHouse/Snowflake 等无对应目录：null
 */
export function dependencyQueries(
  dialect: DbDialect,
  ctx: TableContext,
  name: string,
): { dependents: string; dependsOn: string } | null {
  const esc = (s: string) => s.replace(/'/g, "''")
  const nm = esc(name)
  if (
    dialect === DbDialect.SQLite ||
    dialect === DbDialect.DuckDB ||
    dialect === DbDialect.ClickHouse ||
    dialect === DbDialect.Snowflake
  )
    return null
  switch (familyOf(dialect)) {
    case 'oracle': {
      const sch = esc(ctx.schema ?? '')
      return {
        dependents: `SELECT owner AS "sch", name AS "nm", type AS "ty"
          FROM all_dependencies
          WHERE referenced_owner = '${sch}' AND referenced_name = '${nm}'
          ORDER BY owner, name`,
        dependsOn: `SELECT referenced_owner AS "sch", referenced_name AS "nm", referenced_type AS "ty"
          FROM all_dependencies
          WHERE owner = '${sch}' AND name = '${nm}' AND referenced_owner IS NOT NULL
          ORDER BY referenced_owner, referenced_name`,
      }
    }
    case 'pg': {
      const sch = esc(ctx.schema ?? 'public')
      return {
        dependents: `SELECT view_schema AS sch, view_name AS nm, 'VIEW' AS ty
          FROM information_schema.view_table_usage
          WHERE table_schema = '${sch}' AND table_name = '${nm}'
          ORDER BY 1, 2`,
        dependsOn: `SELECT table_schema AS sch, table_name AS nm, 'TABLE' AS ty
          FROM information_schema.view_table_usage
          WHERE view_schema = '${sch}' AND view_name = '${nm}'
          ORDER BY 1, 2`,
      }
    }
    case 'mysql': {
      const db = esc(ctx.database ?? '')
      return {
        dependents: `SELECT VIEW_SCHEMA AS sch, VIEW_NAME AS nm, 'VIEW' AS ty
          FROM information_schema.VIEW_TABLE_USAGE
          WHERE TABLE_SCHEMA = '${db}' AND TABLE_NAME = '${nm}'
          ORDER BY 1, 2`,
        dependsOn: `SELECT TABLE_SCHEMA AS sch, TABLE_NAME AS nm, 'TABLE' AS ty
          FROM information_schema.VIEW_TABLE_USAGE
          WHERE VIEW_SCHEMA = '${db}' AND VIEW_NAME = '${nm}'
          ORDER BY 1, 2`,
      }
    }
    default:
      return null
  }
}
