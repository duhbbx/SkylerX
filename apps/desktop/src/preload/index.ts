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
      ipcRenderer.invoke('connections:executeBatch', connId, statements, options),
    cancel: (connId: string): Promise<void> => ipcRenderer.invoke('connections:cancel', connId),
    history: (connId: string, limit?: number): Promise<QueryHistoryEntry[]> =>
      ipcRenderer.invoke('connections:history', connId, limit),
    historyClear: (connId: string): Promise<void> =>
      ipcRenderer.invoke('connections:historyClear', connId),
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
  },
  window: {
    /** #15 复制当前 SPA 到新 BrowserWindow，跟主窗口完全独立；
     *  常用于在两个连接 / 两条 SQL 之间做侧对照 */
    newSession: (): Promise<void> => ipcRenderer.invoke('window:newSession'),
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
}

contextBridge.exposeInMainWorld('api', api)

export type DesktopApi = typeof api
