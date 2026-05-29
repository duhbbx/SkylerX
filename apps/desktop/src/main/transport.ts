/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { LocalTransport, registerBuiltinDrivers } from '@db-tool/core-driver'
import type { ConnectionConfigStore, SqlTransport } from '@db-tool/core-driver'
import { sqliteConfigStore } from './db/connectionStore.js'
import { closeAllTunnels, ensureTunnel } from './ssh-tunnel.js'

let transport: SqlTransport | null = null

/**
 * 解析配置时若启用 SSH 隧道：先建立（或复用）隧道，把 host/port 改写为本地转发端点，
 * 驱动遂经跳板机连内网库。未启用则原样透传（与无隧道行为一致）。
 */
const tunneledConfigStore: ConnectionConfigStore = {
  async resolve(connId: string) {
    const cfg = await sqliteConfigStore.resolve(connId)
    if (cfg.ssh?.enabled && cfg.ssh.host) {
      const ep = await ensureTunnel(connId, cfg)
      return { ...cfg, host: ep.host, port: ep.port }
    }
    return cfg
  },
}

/**
 * 桌面端的执行通道：恒为 LocalTransport（用户机器直连目标库），
 * 配置由本地 SQLite 解析（启用 SSH 时经隧道）。注册内置方言驱动后返回单例。
 */
export function getTransport(): SqlTransport {
  if (transport) return transport
  registerBuiltinDrivers()
  transport = new LocalTransport(tunneledConfigStore)
  return transport
}

/** 退出时释放所有连接池 + 关闭 SSH 隧道。 */
export async function disposeTransport(): Promise<void> {
  if (transport instanceof LocalTransport) await transport.dispose()
  closeAllTunnels()
  transport = null
}
