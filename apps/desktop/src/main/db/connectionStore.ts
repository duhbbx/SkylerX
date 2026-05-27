import { randomUUID } from 'node:crypto'
import type { ConnectionConfig, ConnectionConfigStore, SshConfig } from '@db-tool/core-driver'
import { DbDialect } from '@db-tool/core-driver'
import { safeStorage } from 'electron'
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
}

/** 用系统钥匙串加密密码；不可用时降级为 base64（仅开发兜底，附前缀以便识别）。 */
function encryptPassword(plain?: string): string | null {
  if (!plain) return null
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(plain).toString('base64')
  }
  return 'plain:' + Buffer.from(plain, 'utf8').toString('base64')
}

function decryptPassword(stored: string | null): string | undefined {
  if (!stored) return undefined
  if (stored.startsWith('enc:')) {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
  }
  if (stored.startsWith('plain:')) {
    return Buffer.from(stored.slice(6), 'base64').toString('utf8')
  }
  return stored
}

/** SSH 配置含密码/私钥，整体加密存储。 */
function encryptSsh(ssh?: SshConfig): string | null {
  return ssh ? encryptPassword(JSON.stringify(ssh)) : null
}

/** 解出 SSH 配置；脱敏时（列表）剔除密码/私钥/口令。 */
function decryptSsh(stored: string | null, withSecrets: boolean): SshConfig | undefined {
  const dec = decryptPassword(stored)
  if (!dec) return undefined
  const ssh = JSON.parse(dec) as SshConfig
  return withSecrets ? ssh : { ...ssh, password: undefined, privateKey: undefined, passphrase: undefined }
}

function rowToConfig(row: ConnectionRow, withPassword: boolean): ConnectionConfig {
  return {
    id: row.id,
    name: row.name,
    dialect: row.dialect as DbDialect,
    host: row.host,
    port: row.port,
    user: row.username,
    password: withPassword ? decryptPassword(row.password_enc) : undefined,
    database: row.database ?? undefined,
    ssl: row.ssl_json ? JSON.parse(row.ssl_json) : undefined,
    // 仅在需要密码时（getConnection）才解密 SSH（含密钥）；列表脱敏，避免无谓的钥匙串读取
    ssh: withPassword ? decryptSsh(row.ssh_json, true) : undefined,
    group: row.group_name ?? undefined,
    extra: row.extra_json ? JSON.parse(row.extra_json) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 列出全部连接（脱敏，不含密码）。 */
export function listConnections(): ConnectionConfig[] {
  const rows = getDb().prepare('SELECT * FROM connections ORDER BY updated_at DESC').all() as ConnectionRow[]
  return rows.map((r) => rowToConfig(r, false))
}

/** 按 id 取单条连接，含解密后的密码（用于编辑表单回填 / 执行层解析）。 */
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
        (id, name, dialect, host, port, username, password_enc, database, ssl_json, ssh_json, group_name, extra_json, created_at, updated_at)
       VALUES (@id, @name, @dialect, @host, @port, @username, @password_enc, @database, @ssl_json, @ssh_json, @group_name, @extra_json, @created_at, @updated_at)`,
    )
    .run({
      id,
      name: input.name,
      dialect: input.dialect,
      host: input.host,
      port: input.port,
      username: input.user,
      password_enc: encryptPassword(input.password),
      database: input.database ?? null,
      ssl_json: input.ssl ? JSON.stringify(input.ssl) : null,
      ssh_json: encryptSsh(input.ssh),
      group_name: input.group?.trim() || null,
      extra_json: input.extra ? JSON.stringify(input.extra) : null,
      created_at: now,
      updated_at: now,
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

  const passwordEnc = input.password ? encryptPassword(input.password) : existing.password_enc
  db.prepare(
    `UPDATE connections SET
       name=@name, dialect=@dialect, host=@host, port=@port, username=@username,
       password_enc=@password_enc, database=@database, ssl_json=@ssl_json,
       ssh_json=@ssh_json, group_name=@group_name,
       extra_json=@extra_json, updated_at=@updated_at
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
    ssh_json: encryptSsh(input.ssh),
    group_name: input.group?.trim() || null,
    extra_json: input.extra ? JSON.stringify(input.extra) : null,
    updated_at: now,
  })
  const updated = db.prepare('SELECT * FROM connections WHERE id = ?').get(input.id) as ConnectionRow
  return rowToConfig(updated, false)
}

export function deleteConnection(id: string): void {
  getDb().prepare('DELETE FROM connections WHERE id = ?').run(id)
}

function toRow(input: ConnectionConfig, id: string, createdAt: number, updatedAt: number): ConnectionRow {
  return {
    id,
    name: input.name,
    dialect: input.dialect,
    host: input.host,
    port: input.port,
    username: input.user,
    password_enc: encryptPassword(input.password),
    database: input.database ?? null,
    ssl_json: input.ssl ? JSON.stringify(input.ssl) : null,
    ssh_json: encryptSsh(input.ssh),
    group_name: input.group?.trim() || null,
    extra_json: input.extra ? JSON.stringify(input.extra) : null,
    created_at: createdAt,
    updated_at: updatedAt,
  }
}

/**
 * 供 core-driver 的执行层按连接 id 解析出完整配置（含解密密码）。
 * 实现 ConnectionConfigStore 接口，注入到 LocalTransport。
 */
export const sqliteConfigStore: ConnectionConfigStore = {
  async resolve(connId: string): Promise<ConnectionConfig> {
    return getConnection(connId)
  },
}
