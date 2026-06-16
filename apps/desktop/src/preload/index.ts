/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  CommandRequest,
  CommandResult,
  ConnectionConfig,
  ExecuteOptions,
  MetaScope,
  MetadataNode,
  QueryHistoryEntry,
  QueryResult,
  TestResult,
} from '@db-tool/shared-types'
import { contextBridge, ipcRenderer } from 'electron'

/** 暴露给渲染进程的安全 API（经 contextBridge，渲染进程无 Node 权限）。 */
const api = {
  connections: {
    list: (): Promise<ConnectionConfig[]> => ipcRenderer.invoke('connections:list'),
    get: (id: string): Promise<ConnectionConfig> => ipcRenderer.invoke('connections:get', id),
    create: (config: ConnectionConfig): Promise<ConnectionConfig> =>
      ipcRenderer.invoke('connections:create', config),
    update: (config: ConnectionConfig): Promise<ConnectionConfig> =>
      ipcRenderer.invoke('connections:update', config),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('connections:remove', id),
    test: (config: ConnectionConfig): Promise<TestResult> =>
      ipcRenderer.invoke('connections:test', config),
    execute: (
      connId: string,
      sql: string,
      params?: unknown[],
      options?: ExecuteOptions,
    ): Promise<QueryResult> =>
      ipcRenderer.invoke('connections:execute', connId, sql, params, options),
    metadata: (connId: string, scope: MetaScope): Promise<MetadataNode[]> =>
      ipcRenderer.invoke('connections:metadata', connId, scope),
    executeBatch: (connId: string, statements: string[], options?: ExecuteOptions): Promise<void> =>
      // 防御：调用方可能传进 Vue 响应式 Proxy（数组/对象），结构化克隆会抛
      // "An object could not be cloned"。在 IPC 边界拍平成纯对象再发。
      ipcRenderer.invoke(
        'connections:executeBatch',
        connId,
        Array.from(statements, String),
        options ? { ...options } : options,
      ),
    cancel: (connId: string): Promise<void> => ipcRenderer.invoke('connections:cancel', connId),
    history: (connId: string, limit?: number): Promise<QueryHistoryEntry[]> =>
      ipcRenderer.invoke('connections:history', connId, limit),
    historyClear: (connId: string): Promise<void> =>
      ipcRenderer.invoke('connections:historyClear', connId),
    historySearch: (
      query: string,
      opts?: { connectionId?: string; limit?: number },
    ): Promise<QueryHistoryEntry[]> => ipcRenderer.invoke('connections:historySearch', query, opts),
    historyMeta: (
      id: number,
      patch: { tags?: string | null; note?: string | null; pinned?: number },
    ): Promise<void> => ipcRenderer.invoke('connections:historyMeta', id, patch),
    historyDelete: (id: number): Promise<void> =>
      ipcRenderer.invoke('connections:historyDelete', id),
    // ── 手动提交会话 ──
    beginSession: (connId: string, options?: ExecuteOptions): Promise<string> =>
      ipcRenderer.invoke('connections:beginSession', connId, options),
    executeInSession: (
      sessionId: string,
      sql: string,
      params?: unknown[],
      options?: ExecuteOptions,
    ): Promise<QueryResult> =>
      ipcRenderer.invoke('connections:executeInSession', sessionId, sql, params, options),
    commitSession: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('connections:commitSession', sessionId),
    rollbackSession: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('connections:rollbackSession', sessionId),
    endSession: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('connections:endSession', sessionId),
    // ── NoSQL 平行通道(MongoDB / Redis) ──
    executeCommand: (connId: string, command: CommandRequest): Promise<CommandResult> =>
      ipcRenderer.invoke('connections:executeCommand', connId, command),
  },
  files: {
    /** 弹保存对话框写入文本；返回路径，取消返回 null */
    saveText: (req: {
      defaultName: string
      content: string
      filters?: { name: string; extensions: string[] }[]
    }): Promise<string | null> => ipcRenderer.invoke('files:saveText', req),
    /** 弹打开对话框读取文本；返回 { name, content }，取消返回 null */
    openText: (
      filters?: { name: string; extensions: string[] }[],
    ): Promise<{ name: string; content: string } | null> =>
      ipcRenderer.invoke('files:openText', filters),
    /** 仅选文件路径（SQLite/DuckDB 数据库文件指定）；取消返回 null */
    selectFile: (req?: {
      filters?: { name: string; extensions: string[] }[]
      allowCreate?: boolean
      defaultPath?: string
    }): Promise<string | null> => ipcRenderer.invoke('files:selectFile', req),
    // ── 自定义 SaveFileDialog 用的原语 ───────────────────────────
    listDir: (
      dirPath: string,
    ): Promise<
      Array<{ name: string; isDirectory: boolean; size: number; mtime: number; isHidden: boolean }>
    > => ipcRenderer.invoke('files:listDir', dirPath),
    commonDirs: (): Promise<{
      home: string
      desktop: string
      documents: string
      downloads: string
      sep: string
    }> => ipcRenderer.invoke('files:commonDirs'),
    writeText: (filePath: string, content: string): Promise<string> =>
      ipcRenderer.invoke('files:writeText', filePath, content),
    writeBinary: (filePath: string, bytes: Uint8Array | ArrayBuffer): Promise<string> =>
      ipcRenderer.invoke('files:writeBinary', filePath, bytes),
    openPath: (p: string): Promise<string> => ipcRenderer.invoke('files:openPath', p),
    showInFolder: (p: string): Promise<void> => ipcRenderer.invoke('files:showInFolder', p),
    mkdir: (p: string): Promise<string> => ipcRenderer.invoke('files:mkdir', p),
    stat: (
      p: string,
    ): Promise<{ size: number; mtime: number; isFile: boolean; isDirectory: boolean } | null> =>
      ipcRenderer.invoke('files:stat', p),
    pathJoin: (...parts: string[]): Promise<string> =>
      ipcRenderer.invoke('files:pathJoin', ...parts),
    readText: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('files:readText', filePath),
  },
  ai: {
    /** 经主进程做 HTTP；避开渲染层 CORS（DeepSeek/OpenAI/Grok 直发会被预检卡）；
     *  请求 id 可选，传了之后可通过 ai.cancel(id) 真正中止主进程的 fetch。 */
    fetch: (req: {
      url: string
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
      headers?: Record<string, string>
      body?: string
      timeoutMs?: number
      reqId?: string
    }): Promise<{ ok: boolean; status: number; body: string; error?: string }> =>
      ipcRenderer.invoke('ai:fetch', req),
    /** 终止还在飞的请求；返回 true 表示找到并取消了 */
    cancel: (reqId: string): Promise<boolean> => ipcRenderer.invoke('ai:cancel', reqId),
    /** 流式：主进程逐块把 raw SSE 文本经 `ai:stream:<reqId>` 推回，onChunk 收；
     *  invoke 在流结束 / 出错时 resolve。SSE 解析在渲染层做。 */
    stream: (
      req: {
        url: string
        method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
        headers?: Record<string, string>
        body?: string
        timeoutMs?: number
        reqId: string
      },
      onChunk: (payload: { chunk: string }) => void,
    ): Promise<{ ok: boolean; status: number; error?: string }> => {
      const channel = `ai:stream:${req.reqId}`
      const listener = (_e: Electron.IpcRendererEvent, payload: { chunk: string }): void =>
        onChunk(payload)
      ipcRenderer.on(channel, listener)
      return ipcRenderer
        .invoke('ai:stream', req)
        .finally(() => ipcRenderer.removeListener(channel, listener))
    },
  },
  window: {
    /** #15 复制当前 SPA 到新 BrowserWindow，跟主窗口完全独立；
     *  常用于在两个连接 / 两条 SQL 之间做侧对照 */
    newSession: (): Promise<void> => ipcRenderer.invoke('window:newSession'),
  },
  system: {
    /** 主进程读取 package.json 的真实版本(替代 renderer 硬编码) */
    getVersion: (): Promise<string> => ipcRenderer.invoke('system:getVersion'),
    getEnvSummary: (): Promise<{
      appVersion: string
      platform: NodeJS.Platform
      arch: string
      electronVer: string
      nodeVer: string
      chromeVer: string
      locale: string
      timezone: string
      channel: 'github' | 'oss-cn'
      osRelease: string
    }> => ipcRenderer.invoke('system:getEnvSummary'),
    /**
     * Main-process proxy for "what's the latest published version?". Replaces
     * the renderer-side fetch to api.github.com that was 403'ing on
     * rate-limit / corporate proxies (#13).
     */
    peekLatestVersion: (): Promise<{
      tag: string
      source: 'oss' | 'github' | 'none'
      error?: string
    }> => ipcRenderer.invoke('system:peekLatestVersion'),
  },
  menu: {
    /**
     * 订阅主进程发来的菜单命令。主进程的非系统菜单项（"打开设置"、"切换 AI 聊天" 等）
     * 通过 'menu:command' channel 把 key 发过来，渲染层按 key 路由。
     * 返回反订阅函数。
     */
    onCommand: (handler: (key: string) => void): (() => void) => {
      const listener = (_e: unknown, key: string): void => handler(key)
      ipcRenderer.on('menu:command', listener)
      return () => ipcRenderer.removeListener('menu:command', listener)
    },
  },
  // 应用设置持久化(替代 renderer localStorage)
  // 整份 Settings JSON 在主进程经 safeStorage 加密后落 SQLite,强杀不丢、apiKey 不明文。
  settings: {
    /** 读整份 settings JSON;不存在(首次启动)返回 null */
    get: (): Promise<string | null> => ipcRenderer.invoke('settings:get'),
    /** 整份覆写 settings JSON */
    set: (json: string): Promise<void> => ipcRenderer.invoke('settings:set', json),
    /** 重置(测试 / 出问题用) */
    clear: (): Promise<void> => ipcRenderer.invoke('settings:clear'),
  },
  /**
   * 应用内自动更新(electron-updater 通道)。
   * dev 模式下 check/downloadAndInstall 返回 { devMode: true },renderer 据此降级到 GitHub 链接。
   */
  updates: {
    getStatus: (): Promise<unknown> => ipcRenderer.invoke('updates:getStatus'),
    check: (): Promise<{ devMode?: boolean; ok?: boolean; error?: string }> =>
      ipcRenderer.invoke('updates:check'),
    downloadAndInstall: (): Promise<{ devMode?: boolean; ok?: boolean; error?: string }> =>
      ipcRenderer.invoke('updates:downloadAndInstall'),
    install: (): Promise<{ devMode?: boolean; ok?: boolean }> =>
      ipcRenderer.invoke('updates:install'),
    /** 更新源 channel:'github' 默认 / 'oss-cn' 阿里云镜像;切完下次启动也会跟随 */
    getChannel: (): Promise<'github' | 'oss-cn'> => ipcRenderer.invoke('updates:getChannel'),
    setChannel: (c: 'github' | 'oss-cn'): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('updates:setChannel', c),
    /** 调试日志:历史 + 实时(updates:log) 给 about 弹框面板展示 */
    getLogs: (): Promise<Array<{ ts: number; level: string; msg: string }>> =>
      ipcRenderer.invoke('updates:getLogs'),
    onLog: (handler: (log: { ts: number; level: string; msg: string }) => void): (() => void) => {
      const listener = (_e: unknown, log: { ts: number; level: string; msg: string }): void =>
        handler(log)
      ipcRenderer.on('updates:log', listener)
      return () => ipcRenderer.removeListener('updates:log', listener)
    },
    /** 订阅状态推送;返回取消订阅函数 */
    onStatus: (handler: (s: unknown) => void): (() => void) => {
      const listener = (_e: unknown, s: unknown): void => handler(s)
      ipcRenderer.on('updates:status', listener)
      return () => ipcRenderer.removeListener('updates:status', listener)
    },
  },
}

contextBridge.exposeInMainWorld('api', api)

export type DesktopApi = typeof api
