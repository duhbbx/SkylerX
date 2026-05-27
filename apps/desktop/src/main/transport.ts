import { LocalTransport, registerBuiltinDrivers } from '@db-tool/core-driver'
import type { SqlTransport } from '@db-tool/core-driver'
import { sqliteConfigStore } from './db/connectionStore.js'

let transport: SqlTransport | null = null

/**
 * 桌面端的执行通道：恒为 LocalTransport（用户机器直连目标库），
 * 配置由本地 SQLite 解析。注册内置方言驱动后返回单例。
 */
export function getTransport(): SqlTransport {
  if (transport) return transport
  registerBuiltinDrivers()
  transport = new LocalTransport(sqliteConfigStore)
  return transport
}

/** 退出时释放所有连接池。 */
export async function disposeTransport(): Promise<void> {
  if (transport instanceof LocalTransport) await transport.dispose()
  transport = null
}
