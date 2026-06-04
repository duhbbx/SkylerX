/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DataClient, DbDialect } from '@db-tool/shared-types'
import { familyOf } from './ddl'

export interface ErdColumn {
  name: string
  type: string
  pk: boolean
}
export interface ErdTable {
  name: string
  columns: ErdColumn[]
}
export interface ErdFk {
  fromTable: string
  fromCol: string
  toTable: string
  toCol: string
}
export interface ErdData {
  tables: ErdTable[]
  fks: ErdFk[]
  supported: boolean
}

type Row = Record<string, unknown>


function buildErd(colRows: Row[], fkRows: Row[], pkFromKey: boolean): ErdData {
  const map = new Map<string, ErdTable>()
  for (const r of colRows) {
    const t = String(r.t)
    let tbl = map.get(t)
    if (!tbl) {
      tbl = { name: t, columns: [] }
      map.set(t, tbl)
    }
    tbl.columns.push({
      name: String(r.c),
      type: String(r.ty ?? ''),
      pk: pkFromKey ? r.k === 'PRI' : false,
    })
  }
  const fks: ErdFk[] = fkRows.map((r) => ({
    fromTable: String(r.ft),
    fromCol: String(r.fc),
    toTable: String(r.tt),
    toCol: String(r.tc),
  }))
  return { tables: [...map.values()], fks, supported: true }
}

/**
 * 反向工程：拉取某库/schema 的表、列、外键，供 ER 图渲染。
 * 支持 MySQL 系 / PG 系 / Oracle·DM / SQL Server;其余返回 supported:false。
 */
export async function loadErd(
  client: DataClient,
  connId: string,
  dialect: DbDialect,
  ctx: { database?: string; schema?: string },
): Promise<ErdData> {
  const exec = (sql: string) =>
    client.connections.execute(connId, sql, [], { database: ctx.database, schema: ctx.schema })
  const f = familyOf(dialect)

  if (f === 'mysql') {
    const db = (ctx.database ?? '').replace(/'/g, "''")
    const cols = await exec(
      `SELECT table_name AS t, column_name AS c, column_type AS ty, column_key AS k
         FROM information_schema.columns WHERE table_schema='${db}'
        ORDER BY table_name, ordinal_position`,
    )
    const fks = await exec(
      `SELECT table_name AS ft, column_name AS fc, referenced_table_name AS tt, referenced_column_name AS tc
         FROM information_schema.key_column_usage
        WHERE table_schema='${db}' AND referenced_table_name IS NOT NULL`,
    )
    return buildErd(cols.rows, fks.rows, true)
  }

  if (f === 'pg') {
    const sc = (ctx.schema ?? 'public').replace(/'/g, "''")
    const cols = await exec(
      `SELECT table_name AS t, column_name AS c, data_type AS ty
         FROM information_schema.columns WHERE table_schema='${sc}'
        ORDER BY table_name, ordinal_position`,
    )
    const fks = await exec(
      `SELECT tc.table_name AS ft, kcu.column_name AS fc, ccu.table_name AS tt, ccu.column_name AS tc
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name=tc.constraint_name AND ccu.table_schema=tc.table_schema
        WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='${sc}'`,
    )
    return buildErd(cols.rows, fks.rows, false)
  }

  if (f === 'oracle') {
    // Oracle / DM:owner = schema。排除视图(只取 all_tables 里的基表);FK 自连接按列位置配对。
    const sc = (ctx.schema ?? ctx.database ?? '').replace(/'/g, "''")
    const cols = await exec(
      `SELECT table_name AS t, column_name AS c, data_type AS ty
         FROM all_tab_columns
        WHERE owner = '${sc}'
          AND table_name IN (SELECT table_name FROM all_tables WHERE owner = '${sc}')
        ORDER BY table_name, column_id`,
    )
    const fks = await exec(
      `SELECT ac.table_name AS ft, acc.column_name AS fc, rac.table_name AS tt, racc.column_name AS tc
         FROM all_constraints ac
         JOIN all_cons_columns acc ON acc.owner = ac.owner AND acc.constraint_name = ac.constraint_name
         JOIN all_constraints rac ON rac.owner = ac.r_owner AND rac.constraint_name = ac.r_constraint_name
         JOIN all_cons_columns racc ON racc.owner = rac.owner AND racc.constraint_name = rac.constraint_name AND racc.position = acc.position
        WHERE ac.owner = '${sc}' AND ac.constraint_type = 'R'`,
    )
    return buildErd(cols.rows, fks.rows, false)
  }

  if (f === 'sqlserver') {
    // SQL Server:execute 会按 ctx.database 先 USE 库;schema = TABLE_SCHEMA(dbo 等)。基表 only。
    const sc = (ctx.schema ?? 'dbo').replace(/'/g, "''")
    const cols = await exec(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS ty
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '${sc}'
          AND TABLE_NAME IN (SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = '${sc}')
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    )
    const fks = await exec(
      `SELECT tc.TABLE_NAME AS ft, kcu.COLUMN_NAME AS fc, ccu.TABLE_NAME AS tt, ccu.COLUMN_NAME AS tc
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
         JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
           ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
         JOIN INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu
           ON ccu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
        WHERE tc.CONSTRAINT_TYPE = 'FOREIGN KEY' AND tc.TABLE_SCHEMA = '${sc}'`,
    )
    return buildErd(cols.rows, fks.rows, false)
  }

  return { tables: [], fks: [], supported: false }
}
