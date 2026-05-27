import { DbDialect } from '@db-tool/shared-types'
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
}
export interface ForeignKeyDef {
  name: string
  columns: string
  refTable: string
  refColumns: string
  onDelete: string
  onUpdate: string
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

export function quoteId(dialect: DbDialect, id: string): string {
  switch (familyOf(dialect)) {
    case 'mysql':
      return '`' + id.replace(/`/g, '``') + '`'
    case 'sqlserver':
      return '[' + id.replace(/]/g, ']]') + ']'
    default:
      return '"' + id.replace(/"/g, '""') + '"'
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
    let s = `  ${q(c.name)} ${colType(c)}`
    s += c.nullable ? ' NULL' : ' NOT NULL'
    if (c.defaultValue.trim()) s += ` DEFAULT ${c.defaultValue.trim()}`
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
    let s = `  ${fk.name.trim() ? `CONSTRAINT ${q(fk.name.trim())} ` : ''}FOREIGN KEY (${lc.map(q).join(', ')}) REFERENCES ${q(fk.refTable.trim())} (${rc.map(q).join(', ')})`
    if (fk.onDelete) s += ` ON DELETE ${fk.onDelete}`
    if (fk.onUpdate) s += ` ON UPDATE ${fk.onUpdate}`
    lines.push(s)
  }
  // MySQL 索引可内联
  if (fam === 'mysql') {
    for (const idx of spec.indexes) {
      const c = splitCols(idx.columns)
      if (!c.length) continue
      lines.push(`  ${idx.unique ? 'UNIQUE ' : ''}INDEX ${q(idx.name.trim() || `idx_${c.join('_')}`)} (${c.map(q).join(', ')})`)
    }
  }

  let create = `CREATE TABLE ${name} (\n${lines.join(',\n')}\n)`
  if (fam === 'mysql') {
    const opts: string[] = []
    if (spec.engine.trim()) opts.push(`ENGINE=${spec.engine.trim()}`)
    if (spec.charset.trim()) opts.push(`DEFAULT CHARSET=${spec.charset.trim()}`)
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
      statements.push(
        `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${q(idx.name.trim() || `idx_${tbl}_${c.join('_')}`)} ON ${name} (${c.map(q).join(', ')});`,
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
