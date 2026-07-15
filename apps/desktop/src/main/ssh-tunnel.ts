/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Server, createServer } from 'node:net'
import type { ConnectionConfig, SshConfig } from '@db-tool/core-driver'
import { Client } from 'ssh2'

interface Tunnel {
  server: Server
  client: Client
  localPort: number
}

type SshClientLike = {
  on(event: 'ready' | 'error' | 'close', listener: (...args: unknown[]) => void): SshClientLike
  connect(options: unknown): void
  end(): void
}

type SshClientFactory = () => SshClientLike

/** 每连接一条隧道，按 connId 复用；连接断开/更新时关闭。 */
const tunnels = new Map<string, Tunnel>()
type TunnelCloseListener = (connId: string) => void
const closeListeners = new Set<TunnelCloseListener>()

export function onTunnelClosed(listener: TunnelCloseListener): () => void {
  closeListeners.add(listener)
  return () => closeListeners.delete(listener)
}

function notifyTunnelClosed(connId: string): void {
  for (const listener of closeListeners) {
    try {
      listener(connId)
    } catch {
      /* ignore listener failures */
    }
  }
}

async function connectSshClient(
  ssh: SshConfig,
  createClient: SshClientFactory = () => new Client(),
): Promise<SshClientLike> {
  const client = createClient()
  await new Promise<void>((resolve, reject) => {
    client.on('ready', () => resolve())
    client.on('error', (e) => reject(new Error(`SSH 连接失败：${(e as Error).message}`)))
    client.connect({
      host: ssh.host,
      port: ssh.port || 22,
      username: ssh.user,
      password: ssh.password || undefined,
      privateKey: ssh.privateKey || undefined,
      passphrase: ssh.passphrase || undefined,
      readyTimeout: 15000,
    })
  })
  return client
}

export async function testSshConnection(
  cfg: ConnectionConfig,
  createClient?: SshClientFactory,
): Promise<void> {
  const ssh = cfg.ssh
  if (!ssh) throw new Error('缺少 SSH 配置')
  const client = await connectSshClient(ssh, createClient)
  client.end()
}

/**
 * 确保该连接的 SSH 隧道已建立，返回本地转发端点（127.0.0.1:port）。
 * 驱动改为连此本地端口，流量经跳板机转发到目标库。
 */
export async function ensureTunnel(
  connId: string,
  cfg: ConnectionConfig,
): Promise<{ host: string; port: number }> {
  const existing = tunnels.get(connId)
  if (existing) return { host: '127.0.0.1', port: existing.localPort }

  const ssh = cfg.ssh
  if (!ssh) throw new Error('缺少 SSH 配置')

  const client = (await connectSshClient(ssh)) as Client

  const dstHost = cfg.host
  const dstPort = cfg.port
  const server = createServer((sock) => {
    client.forwardOut(
      sock.remoteAddress ?? '127.0.0.1',
      sock.remotePort ?? 0,
      dstHost,
      dstPort,
      (err, stream) => {
        if (err) {
          sock.destroy()
          return
        }
        sock.pipe(stream).pipe(sock)
      },
    )
  })

  const localPort = await new Promise<number>((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') resolve(addr.port)
      else reject(new Error('无法分配本地端口'))
    })
  })

  client.on('close', () => closeTunnel(connId))
  tunnels.set(connId, { server, client, localPort })
  return { host: '127.0.0.1', port: localPort }
}

/** 关闭某连接的隧道（连接更新/删除/断开时调用）。 */
export function closeTunnel(connId: string): void {
  const t = tunnels.get(connId)
  if (!t) return
  tunnels.delete(connId)
  notifyTunnelClosed(connId)
  try {
    t.server.close()
  } catch {
    /* ignore */
  }
  try {
    t.client.end()
  } catch {
    /* ignore */
  }
}

/** 退出时关闭全部隧道。 */
export function closeAllTunnels(): void {
  for (const id of [...tunnels.keys()]) closeTunnel(id)
}
