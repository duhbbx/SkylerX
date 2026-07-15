/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto'
import type { ConnectionConfig, ConnectionConfigStore, SshConfig } from '@db-tool/core-driver'
import type { DbDialect } from '@db-tool/core-driver'
import { getDb } from './sqlite.js'

interface ConnectionRow {
  id: string
  name: string
  dialect: string
  host: string
  port: number
  username: string
  password_enc: string | null
  database: string | null
  ssl_json: string | null
  ssh_json: string | null
  group_name: string | null
  extra_json: string | null
  created_at: number
  updated_at: number
  sort_index: number | null
}

/** 裸存 secret。base64 只是避免特殊字符影响存储,不是加密。 */
function encodeSecret(plain?: string): string | null {
  if (!plain) return null
  return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`
}

function decodeSecret(stored: string | null): string | undefined {
  if (!stored) return undefined
  if (stored.startsWith('enc:')) {
    // 旧版本系统加密密文。按新策略不碰系统钥匙串,返回空让用户重输一次。
    return undefined
  }
  if (stored.startsWith('plain:')) {
    return Buffer.from(stored.slice(6), 'base64').toString('utf8')
  }
  return stored
}

/** SSH 配置含密码/私钥，整体裸存。 */
function encodeSsh(ssh?: SshConfig): string | null {
  return ssh ? encodeSecret(JSON.stringify(ssh)) : null
}

/** 读出 SSH 配置；脱敏时（列表）剔除密码/私钥/口令。 */
function decodeSsh(stored: string | null, withSecrets: boolean): SshConfig | undefined {
  const dec = decodeSecret(stored)
  if (!dec) return undefined
  const ssh = JSON.parse(dec) as SshConfig
  return withSecrets
    ? ssh
    : { ...ssh, password: undefined, privateKey: undefined, passphrase: undefined }
}

function rowToConfig(row: ConnectionRow, withPassword: boolean): ConnectionConfig {
  return {
    id: row.id,
    name: row.name,
    dialect: row.dialect as DbDialect,
    host: row.host,
    port: row.port,
    user: row.username,
    password: withPassword ? decodeSecret(row.password_enc) : undefined,
    database: row.database ?? undefined,
    ssl: row.ssl_json ? JSON.parse(row.ssl_json) : undefined,
    // 仅在需要密码时（getConnection）才读取 SSH（含密钥）；列表脱敏，避免 secrets 进连接列表
    ssh: withPassword ? decodeSsh(row.ssh_json, true) : undefined,
    group: row.group_name ?? undefined,
    extra: row.extra_json ? JSON.parse(row.extra_json) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sortIndex: row.sort_index ?? undefined,
  }
}

/**
 * 列出全部连接（脱敏，不含密码）。
 *
 * 排序：优先用户拖拽分配过 sort_index 的连接 (ASC)，没拖过的 (sort_index NULL)
 * 排在它们后面，按 created_at ASC 兜底（早创建在前，跟 DBeaver/Navicat 一致）。
 *
 * 之前用 `ORDER BY updated_at DESC` + NavTree 拖动时同步 `updatedAt = Date.now()`，
 * 结果拖动的连接 updated_at 总是当下最大值 → 永远跑到第 1 位
 * (用户报告: 把第 3 个拖到第 2 个, 结果落到第 1)。
 */
export function listConnections(): ConnectionConfig[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM connections ORDER BY (sort_index IS NULL), sort_index ASC, created_at ASC',
    )
    .all() as ConnectionRow[]
  return rows.map((r) => rowToConfig(r, false))
}

/** 按 id 取单条连接，含密码（用于编辑表单回填 / 执行层解析）。 */
export function getConnection(id: string): ConnectionConfig {
  const row = getDb().prepare('SELECT * FROM connections WHERE id = ?').get(id) as
    | ConnectionRow
    | undefined
  if (!row) throw new Error(`连接不存在: ${id}`)
  return rowToConfig(row, true)
}

/** 新建连接，返回脱敏后的记录。 */
export function createConnection(input: ConnectionConfig): ConnectionConfig {
  const now = Date.now()
  const id = input.id || randomUUID()
  getDb()
    .prepare(
      `INSERT INTO connections
        (id, name, dialect, host, port, username, password_enc, database, ssl_json, ssh_json, group_name, extra_json, created_at, updated_at, sort_index)
       VALUES (@id, @name, @dialect, @host, @port, @username, @password_enc, @database, @ssl_json, @ssh_json, @group_name, @extra_json, @created_at, @updated_at, @sort_index)`,
    )
    .run({
      id,
      name: input.name,
      dialect: input.dialect,
      host: input.host,
      port: input.port,
      username: input.user,
      password_enc: encodeSecret(input.password),
      database: input.database ?? null,
      ssl_json: input.ssl ? JSON.stringify(input.ssl) : null,
      ssh_json: encodeSsh(input.ssh),
      group_name: input.group?.trim() || null,
      extra_json: input.extra ? JSON.stringify(input.extra) : null,
      created_at: now,
      updated_at: now,
      sort_index: input.sortIndex ?? null,
    })
  return { ...rowToConfig({ ...toRow(input, id, now, now) }, false) }
}

/** 更新连接；password 为空字符串/undefined 时保留原密码。 */
export function updateConnection(input: ConnectionConfig): ConnectionConfig {
  const now = Date.now()
  const db = getDb()
  const existing = db.prepare('SELECT * FROM connections WHERE id = ?').get(input.id) as
    | ConnectionRow
    | undefined
  if (!existing) throw new Error(`连接不存在: ${input.id}`)

  const passwordEnc = input.password ? encodeSecret(input.password) : existing.password_enc
  db.prepare(
    `UPDATE connections SET
       name=@name, dialect=@dialect, host=@host, port=@port, username=@username,
       password_enc=@password_enc, database=@database, ssl_json=@ssl_json,
       ssh_json=@ssh_json, group_name=@group_name,
       extra_json=@extra_json, updated_at=@updated_at, sort_index=@sort_index
     WHERE id=@id`,
  ).run({
    id: input.id,
    name: input.name,
    dialect: input.dialect,
    host: input.host,
    port: input.port,
    username: input.user,
    password_enc: passwordEnc,
    database: input.database ?? null,
    ssl_json: input.ssl ? JSON.stringify(input.ssl) : null,
    ssh_json: encodeSsh(input.ssh),
    group_name: input.group?.trim() || null,
    extra_json: input.extra ? JSON.stringify(input.extra) : null,
    updated_at: now,
    sort_index: input.sortIndex ?? null,
  })
  const updated = db
    .prepare('SELECT * FROM connections WHERE id = ?')
    .get(input.id) as ConnectionRow
  return rowToConfig(updated, false)
}

export function deleteConnection(id: string): void {
  getDb().prepare('DELETE FROM connections WHERE id = ?').run(id)
}

function toRow(
  input: ConnectionConfig,
  id: string,
  createdAt: number,
  updatedAt: number,
): ConnectionRow {
  return {
    id,
    name: input.name,
    dialect: input.dialect,
    host: input.host,
    port: input.port,
    username: input.user,
    password_enc: encodeSecret(input.password),
    database: input.database ?? null,
    ssl_json: input.ssl ? JSON.stringify(input.ssl) : null,
    ssh_json: encodeSsh(input.ssh),
    group_name: input.group?.trim() || null,
    extra_json: input.extra ? JSON.stringify(input.extra) : null,
    created_at: createdAt,
    updated_at: updatedAt,
    sort_index: input.sortIndex ?? null,
  }
}

/**
 * 供 core-driver 的执行层按连接 id 解析出完整配置（含密码）。
 * 实现 ConnectionConfigStore 接口，注入到 LocalTransport。
 */
export const sqliteConfigStore: ConnectionConfigStore = {
  async resolve(connId: string): Promise<ConnectionConfig> {
    return getConnection(connId)
  },
}
