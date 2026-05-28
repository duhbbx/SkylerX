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
  }
}

type Family = 'mysql' | 'pg' | 'sqlserver' | 'oracle'

function familyOf(dialect: DbDialect): Family {
  switch (dialect) {
    case DbDialect.MySQL:
    case DbDialect.MariaDB:
    case DbDialect.OceanBase:
      return 'mysql'
    case DbDialect.PostgreSQL:
    case DbDialect.KingbaseES:
      return 'pg'
    case DbDialect.SqlServer:
      return 'sqlserver'
    case DbDialect.Oracle:
    case DbDialect.DM:
      return 'oracle'
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

/** 取对象定义 DDL 的查询 + 结果解析方式（支持 MySQL / PG 的 视图/函数/过程）。 */
export interface ObjectDdlFetch {
  sql: string
  mode: 'showCreate' | 'viewdef' | 'funcdef'
  /** viewdef 模式：拼到 pg_get_viewdef 结果前的前缀 */
  prefix?: string
}

export function objectDdlQuery(
  dialect: DbDialect,
  kind: ObjectKind,
  ref: string,
): ObjectDdlFetch | null {
  const fam = familyOf(dialect)
  if (fam === 'mysql') {
    const kw = kind === 'view' ? 'VIEW' : kind === 'function' ? 'FUNCTION' : kind === 'procedure' ? 'PROCEDURE' : null
    return kw ? { sql: `SHOW CREATE ${kw} ${ref}`, mode: 'showCreate' } : null
  }
  if (fam === 'pg') {
    if (kind === 'view')
      return { sql: `SELECT pg_get_viewdef('${ref}'::regclass, true) AS ddl`, mode: 'viewdef', prefix: `CREATE OR REPLACE VIEW ${ref} AS\n` }
    if (kind === 'function' || kind === 'procedure')
      return { sql: `SELECT pg_get_functiondef('${ref}'::regproc) AS ddl`, mode: 'funcdef' }
    return null
  }
  return null
}

/** 查看「触发器 / 序列」定义：取定义的查询 + 解析方式（MySQL 触发器、PG 触发器/序列）。 */
export interface DefinitionFetch {
  sql: string
  mode: 'mysql-trigger' | 'pg-trigger' | 'pg-sequence'
}

export function definitionQuery(dialect: DbDialect, node: TreeNode): DefinitionFetch | null {
  const fam = familyOf(dialect)
  const p = node.path
  const name = p[p.length - 1]
  const esc = (s: string) => s.replace(/'/g, "''")
  if (node.kind === MetaNodeKind.Trigger) {
    if (fam === 'mysql') return { sql: `SHOW CREATE TRIGGER ${quoteId(dialect, name)}`, mode: 'mysql-trigger' }
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
      return (
        `CREATE INDEX ${q(idxName)} ON ${tableRef} (${firstCol});\n-- 唯一索引：CREATE UNIQUE INDEX ${q(idxName)} ON ${tableRef} (${firstCol});\n-- 复合索引：在括号内追加更多列，逗号分隔。`
      )
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
export function tableStatsQuery(dialect: DbDialect, ctx: TableContext, table: string): string | null {
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
  mysql: ['INT', 'BIGINT', 'TINYINT', 'VARCHAR', 'CHAR', 'TEXT', 'DECIMAL', 'DOUBLE', 'FLOAT', 'DATE', 'DATETIME', 'TIMESTAMP', 'JSON', 'BLOB'],
  pg: ['int4', 'int8', 'serial', 'varchar', 'char', 'text', 'numeric', 'float8', 'boolean', 'date', 'timestamp', 'timestamptz', 'uuid', 'jsonb'],
  sqlserver: ['INT', 'BIGINT', 'BIT', 'NVARCHAR', 'VARCHAR', 'DECIMAL', 'FLOAT', 'DATE', 'DATETIME2', 'UNIQUEIDENTIFIER'],
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
export type ObjectKind = 'table' | 'view' | 'function' | 'procedure'

export const OBJECT_LABEL: Record<ObjectKind, string> = {
  table: '新建表',
  view: '新建视图',
  function: '新建函数',
  procedure: '新建存储过程',
}

/** 视图/函数/存储过程的起始 DDL 模板（按方言）。表用结构化设计器，不走这里。 */
export function objectTemplate(dialect: DbDialect, kind: ObjectKind, _ctx: TableContext): string {
  const fam = familyOf(dialect)
  const q = (id: string) => quoteId(dialect, id)
  if (kind === 'view') {
    return `CREATE VIEW ${q('new_view')} AS\nSELECT 1 AS col;`
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
const splitCols = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

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
    case 'function':
      return { sql: `DROP FUNCTION ${q(name)}${cs}`, ctx }
    case 'procedure':
      return { sql: `DROP PROCEDURE ${q(name)}`, ctx }
    case 'sequence':
      return { sql: `DROP SEQUENCE ${node.sqlName ?? q(name)}${cs}`, ctx }
    case 'trigger': {
      if (fam === 'mysql') return { sql: `DROP TRIGGER ${q(name)}`, ctx }
      // PG/Oracle：DROP TRIGGER name ON 表（表取自 path 倒数第二段）
      const tbl = node.path[node.path.length - 2]
      return tbl ? { sql: `DROP TRIGGER ${q(name)} ON ${q(tbl)}${cs}`, ctx } : null
    }
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
    if (fam === 'mysql' && c.charset?.trim()) s += ` CHARACTER SET ${c.charset.trim()}`
    if (fam === 'mysql' && c.collation?.trim()) s += ` COLLATE ${c.collation.trim()}`
    s += c.nullable ? ' NULL' : ' NOT NULL'
    if (fam === 'mysql' && c.autoIncrement) s += ' AUTO_INCREMENT'
    if (c.defaultValue.trim()) s += ` DEFAULT ${c.defaultValue.trim()}`
    if (fam === 'mysql' && c.onUpdateNow) s += ' ON UPDATE CURRENT_TIMESTAMP'
    if (c.comment.trim() && fam === 'mysql') s += ` COMMENT '${esc(c.comment.trim())}'`
    return s
  })

  const pks = cols.filter((c) => c.primaryKey).map((c) => q(c.name))
  if (pks.length) lines.push(`  PRIMARY KEY (${pks.join(', ')})`)

  for (const u of spec.uniques) {
    const c = splitCols(u.columns)
    if (!c.length) continue
    lines.push(`  ${u.name.trim() ? `CONSTRAINT ${q(u.name.trim())} ` : ''}UNIQUE (${c.map(q).join(', ')})`)
  }
  for (const ck of spec.checks) {
    if (!ck.expression.trim()) continue
    lines.push(`  ${ck.name.trim() ? `CONSTRAINT ${q(ck.name.trim())} ` : ''}CHECK (${ck.expression.trim()})`)
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
      statements.push(
        `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${q(idx.name.trim() || `idx_${tbl}_${baseNames.join('_')}`)} ON ${name}${using} (${colExpr});`,
      )
    }
  }
  // PG / Oracle：表与列注释用 COMMENT ON
  if (fam === 'pg' || fam === 'oracle') {
    if (spec.comment.trim()) statements.push(`COMMENT ON TABLE ${name} IS '${esc(spec.comment.trim())}';`)
    for (const c of cols) {
      if (c.comment.trim()) statements.push(`COMMENT ON COLUMN ${name}.${q(c.name)} IS '${esc(c.comment.trim())}';`)
    }
  }

  return statements.join('\n')
}

/**
 * 由「原始列快照 + 当前表规格」diff 出 ALTER 语句（MySQL / PostgreSQL 系）。
 * - 列：按 originalName 配对 → 识别 新增 / 删除 / 改名 / 改类型·空否·默认·注释。
 * - 约束/索引：改表模式下设计器约束页从空白开始，凡填写者均视为「新增」→ ALTER ADD / CREATE INDEX。
 * - 主键变更、删除既有约束本版不处理（请用 SQL 编辑器）。
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
        if (c.charset?.trim()) s += ` CHARACTER SET ${c.charset.trim()}`
        if (c.collation?.trim()) s += ` COLLATE ${c.collation.trim()}`
        s += c.nullable ? ' NULL' : ' NOT NULL'
        if (c.defaultValue.trim()) s += ` DEFAULT ${c.defaultValue.trim()}`
        if (c.comment.trim()) s += ` COMMENT '${esc(c.comment.trim())}'`
        stmts.push(s)
      } else {
        let s = `ALTER TABLE ${tableRef} ADD COLUMN ${q(c.name)} ${t}${c.nullable ? '' : ' NOT NULL'}`
        if (c.defaultValue.trim()) s += ` DEFAULT ${c.defaultValue.trim()}`
        stmts.push(s)
        if (c.comment.trim()) stmts.push(`COMMENT ON COLUMN ${tableRef}.${q(c.name)} IS '${esc(c.comment.trim())}'`)
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
      if (renamed || typeChanged || nullChanged || defChanged || commentChanged || charsetChanged || collationChanged) {
        let s = `ALTER TABLE ${tableRef} CHANGE ${q(c.originalName)} ${q(c.name)} ${t}`
        if (c.unsigned) s += ' UNSIGNED'
        if (c.charset?.trim()) s += ` CHARACTER SET ${c.charset.trim()}`
        if (c.collation?.trim()) s += ` COLLATE ${c.collation.trim()}`
        s += c.nullable ? ' NULL' : ' NOT NULL'
        if (c.defaultValue.trim()) s += ` DEFAULT ${c.defaultValue.trim()}`
        if (c.comment.trim()) s += ` COMMENT '${esc(c.comment.trim())}'`
        stmts.push(s)
      }
    } else {
      if (renamed) stmts.push(`ALTER TABLE ${tableRef} RENAME COLUMN ${q(c.originalName)} TO ${q(c.name)}`)
      const col = q(c.name)
      if (typeChanged) stmts.push(`ALTER TABLE ${tableRef} ALTER COLUMN ${col} TYPE ${t}`)
      if (nullChanged) stmts.push(`ALTER TABLE ${tableRef} ALTER COLUMN ${col} ${c.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`)
      if (defChanged)
        stmts.push(`ALTER TABLE ${tableRef} ALTER COLUMN ${col} ${c.defaultValue.trim() ? `SET DEFAULT ${c.defaultValue.trim()}` : 'DROP DEFAULT'}`)
      if (commentChanged) stmts.push(`COMMENT ON COLUMN ${tableRef}.${col} IS '${esc(c.comment.trim())}'`)
    }
  }

  // 新增约束 / 索引（改表模式约束页从空白开始 → 视为新增）
  for (const u of spec.uniques) {
    const cols = splitCols(u.columns)
    if (!cols.length) continue
    stmts.push(`ALTER TABLE ${tableRef} ADD ${u.name.trim() ? `CONSTRAINT ${q(u.name.trim())} ` : ''}UNIQUE (${cols.map(q).join(', ')})`)
  }
  for (const ck of spec.checks) {
    if (!ck.expression.trim()) continue
    stmts.push(`ALTER TABLE ${tableRef} ADD ${ck.name.trim() ? `CONSTRAINT ${q(ck.name.trim())} ` : ''}CHECK (${ck.expression.trim()})`)
  }
  // ── 外键：diff 出新增 / 删除（按名字；定义变化 = 先删后加）──
  const fkSig = (f: ForeignKeyDef) =>
    `${splitCols(f.columns).join(',')}>${f.refTable.trim()}(${splitCols(f.refColumns).join(',')})|${f.onDelete}|${f.onUpdate}`
  const origFks = originalExtras.foreignKeys ?? []
  const specFkByName = new Map(spec.foreignKeys.filter((f) => f.name.trim()).map((f) => [f.name.trim(), f]))
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
  const idxSig = (ix: IndexDef) => `${splitCols(ix.columns).join(',')}|${ix.unique ? 1 : 0}|${ix.type ?? ''}`
  const origIdx = originalExtras.indexes ?? []
  const specIdxByName = new Map(spec.indexes.filter((i) => i.name.trim()).map((i) => [i.name.trim(), i]))
  const dropIdx = (name: string) =>
    fam === 'mysql' ? `ALTER TABLE ${tableRef} DROP INDEX ${q(name)}` : `DROP INDEX IF EXISTS ${q(name)}`
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
    stmts.push(
      `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${q(idx.name.trim() || `idx_${baseNames.join('_')}`)} ON ${tableRef}${using} (${colExpr})`,
    )
  }

  return stmts
}

/** 现有索引查询（排除主键）；MySQL / PG，返回 {name, columns(逗号), unique}。其余 null。 */
export function existingIndexesQuery(dialect: DbDialect, ctx: TableContext, table: string): string | null {
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
      return `SELECT TABLE_NAME AS srctab, CONSTRAINT_NAME AS name,
        GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) AS cols
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE REFERENCED_TABLE_SCHEMA = '${esc(ctx.database ?? '')}' AND REFERENCED_TABLE_NAME = '${esc(table)}'
        GROUP BY TABLE_NAME, CONSTRAINT_NAME`
    case 'pg':
      return `SELECT t.relname AS srctab, con.conname AS name,
        (SELECT string_agg(a.attname, ',') FROM pg_attribute a WHERE a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)) AS cols
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
