/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DataClient, DbDialect } from '@db-tool/shared-types'

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

function family(d: DbDialect): 'mysql' | 'pg' | 'other' {
  if (['mysql', 'mariadb', 'oceanbase'].includes(d)) return 'mysql'
  if (['postgresql', 'kingbase', 'vastbase', 'mogdb', 'highgo'].includes(d)) return 'pg'
  return 'other'
}

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
 * 目前支持 MySQL / PostgreSQL 系；其余返回 supported:false。
 */
export async function loadErd(
  client: DataClient,
  connId: string,
  dialect: DbDialect,
  ctx: { database?: string; schema?: string },
): Promise<ErdData> {
  const exec = (sql: string) =>
    client.connections.execute(connId, sql, [], { database: ctx.database, schema: ctx.schema })
  const f = family(dialect)

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

  return { tables: [], fks: [], supported: false }
}
