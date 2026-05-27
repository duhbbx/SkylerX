import type { ConnectionConfig, ExecuteOptions, MetaScope } from '@db-tool/shared-types'
import { ipcMain } from 'electron'
import {
  createConnection,
  deleteConnection,
  getConnection,
  listConnections,
  updateConnection,
} from '../db/connectionStore.js'
import { clearHistory, listHistory, recordHistory } from '../db/historyStore.js'
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
} as const

/** 注册连接相关的全部 IPC handler。 */
export function registerConnectionIpc(): void {
  ipcMain.handle(IPC.list, () => listConnections())

  ipcMain.handle(IPC.get, (_e, id: string) => getConnection(id))

  ipcMain.handle(IPC.create, (_e, config: ConnectionConfig) => createConnection(config))

  ipcMain.handle(IPC.update, async (_e, config: ConnectionConfig) => {
    const updated = updateConnection(config)
    // 失效该连接的缓存连接（池），让新配置立即生效
    await getTransport().disconnect(config.id)
    return updated
  })

  ipcMain.handle(IPC.remove, async (_e, id: string) => {
    deleteConnection(id)
    await getTransport().disconnect(id)
  })

  ipcMain.handle(IPC.test, (_e, config: ConnectionConfig) =>
    getTransport().testConnection(config),
  )

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
}
