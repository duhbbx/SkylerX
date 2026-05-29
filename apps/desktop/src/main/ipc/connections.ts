/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  CommandRequest,
  ConnectionConfig,
  ExecuteOptions,
  MetaScope,
} from '@db-tool/shared-types'
import { ipcMain } from 'electron'
import {
  createConnection,
  deleteConnection,
  getConnection,
  listConnections,
  updateConnection,
} from '../db/connectionStore.js'
import { clearHistory, listHistory, recordHistory } from '../db/historyStore.js'
import { closeTunnel, ensureTunnel } from '../ssh-tunnel.js'
import { getTransport } from '../transport.js'

/** IPC 通道名集中定义，preload 侧需保持一致。 */
export const IPC = {
  list: 'connections:list',
  get: 'connections:get',
  create: 'connections:create',
  update: 'connections:update',
  remove: 'connections:remove',
  test: 'connections:test',
  execute: 'connections:execute',
  metadata: 'connections:metadata',
  executeBatch: 'connections:executeBatch',
  cancel: 'connections:cancel',
  history: 'connections:history',
  historyClear: 'connections:historyClear',
  beginSession: 'connections:beginSession',
  executeInSession: 'connections:executeInSession',
  commitSession: 'connections:commitSession',
  rollbackSession: 'connections:rollbackSession',
  endSession: 'connections:endSession',
  // NoSQL 平行通道
  executeCommand: 'connections:executeCommand',
} as const

/** 注册连接相关的全部 IPC handler。 */
export function registerConnectionIpc(): void {
  ipcMain.handle(IPC.list, () => listConnections())

  ipcMain.handle(IPC.get, (_e, id: string) => getConnection(id))

  ipcMain.handle(IPC.create, (_e, config: ConnectionConfig) => createConnection(config))

  ipcMain.handle(IPC.update, async (_e, config: ConnectionConfig) => {
    const updated = updateConnection(config)
    // 失效该连接的缓存连接（池）+ 关闭旧 SSH 隧道，让新配置立即生效
    await getTransport().disconnect(config.id)
    closeTunnel(config.id)
    return updated
  })

  ipcMain.handle(IPC.remove, async (_e, id: string) => {
    deleteConnection(id)
    await getTransport().disconnect(id)
    closeTunnel(id)
  })

  ipcMain.handle(IPC.test, async (_e, config: ConnectionConfig) => {
    if (config.ssh?.enabled && config.ssh.host) {
      const key = config.id || `test:${config.ssh.host}:${config.host}:${config.port}`
      const ep = await ensureTunnel(key, config)
      return getTransport().testConnection({ ...config, host: ep.host, port: ep.port })
    }
    return getTransport().testConnection(config)
  })

  ipcMain.handle(
    IPC.execute,
    async (_e, connId: string, sql: string, params?: unknown[], options?: ExecuteOptions) => {
      const start = Date.now()
      try {
        const result = await getTransport().execute({ id: connId }, sql, params, options)
        recordHistory(connId, sql, Date.now() - start, true)
        return result
      } catch (e) {
        recordHistory(connId, sql, Date.now() - start, false)
        throw e
      }
    },
  )

  ipcMain.handle(IPC.metadata, (_e, connId: string, scope: MetaScope) =>
    getTransport().fetchMetadata({ id: connId }, scope),
  )

  ipcMain.handle(
    IPC.executeBatch,
    (_e, connId: string, statements: string[], options?: ExecuteOptions) =>
      getTransport().executeBatch({ id: connId }, statements, options),
  )

  ipcMain.handle(IPC.cancel, (_e, connId: string) => getTransport().cancel({ id: connId }))

  ipcMain.handle(IPC.history, (_e, connId: string, limit?: number) => listHistory(connId, limit))

  ipcMain.handle(IPC.historyClear, (_e, connId: string) => clearHistory(connId))

  // ── 手动提交会话 ──
  ipcMain.handle(IPC.beginSession, (_e, connId: string, options?: ExecuteOptions) =>
    getTransport().beginSession({ id: connId }, options),
  )
  ipcMain.handle(
    IPC.executeInSession,
    async (_e, sessionId: string, sql: string, params?: unknown[], options?: ExecuteOptions) => {
      // session 内的执行也写历史；从 sessionId 取不到 connId，约定 sessionId 形如 `${dialect}-s${seq}-${ts}`
      // 此处简化：不写历史（手动提交场景下一条事务里多条 stmt，记起来意义不大；后续要的话再补 connId 旁挂表）
      return getTransport().executeInSession(sessionId, sql, params, options)
    },
  )
  ipcMain.handle(IPC.commitSession, (_e, sessionId: string) =>
    getTransport().commitSession(sessionId),
  )
  ipcMain.handle(IPC.rollbackSession, (_e, sessionId: string) =>
    getTransport().rollbackSession(sessionId),
  )
  ipcMain.handle(IPC.endSession, (_e, sessionId: string) => getTransport().endSession(sessionId))

  // ── NoSQL 平行通道 ──
  // 写历史:NoSQL 命令也记一条,sql 字段塞 `${op} ${JSON.stringify(args)}`
  // 方便用户在历史里翻找(后续可考虑给 history 表加 kind 列)
  ipcMain.handle(IPC.executeCommand, async (_e, connId: string, command: CommandRequest) => {
    const start = Date.now()
    const sqlLike = `${command.op}${command.args ? ` ${safeStringify(command.args)}` : ''}`
    try {
      const result = await getTransport().executeCommand({ id: connId }, command)
      recordHistory(connId, sqlLike, Date.now() - start, true)
      return result
    } catch (e) {
      recordHistory(connId, sqlLike, Date.now() - start, false)
      throw e
    }
  })
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
