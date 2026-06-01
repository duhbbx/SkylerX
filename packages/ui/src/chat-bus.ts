/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 极简事件总线，专门让 QueryPane 把「这条 SQL 执行完了」回传给 AiChatPanel。
 *
 * 用一条横切信号而不是 emit 链：因为执行链 QueryPane → QueryTabs → Workspace
 * → AiChatPanel 中 QueryTabs 是抽象的多 tab 容器，把执行结果一层层冒泡回去
 * 既污染 props 接口又难追踪。这里就一个事件，签名稳定即可。
 */
export interface ChatSqlExecutedEvent {
  /** 原文 SQL（与 AiChatPanel 里 runMarks 的 key 相同） */
  sql: string
  ok: boolean
  /** 失败时的错误信息（成功时为 null） */
  error: string | null
}

type Listener = (e: ChatSqlExecutedEvent) => void
const listeners = new Set<Listener>()

export function emitChatSqlExecuted(e: ChatSqlExecutedEvent): void {
  for (const l of listeners) {
    try {
      l(e)
    } catch {
      /* 监听器自己处理 */
    }
  }
}

export function onChatSqlExecuted(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/**
 * 错误弹框「✨ 问 AI」按钮事件：任何 alert 提供 askAi 字段即可触发,
 * 由 Workspace 接住,统一打开右侧 AI 聊天面板并预填问题。
 *
 * 字段尽量保持「原始上下文」语义,不要在这里做提示词拼接 —— 让消费方
 * (Workspace + AiChatPanel.askAboutError) 决定最终问 AI 的提示词,
 * 单一职责更稳。
 */
export interface ChatErrorAskEvent {
  /** 关联 SQL,没有就空字符串 */
  sql?: string
  /** 错误正文(必填) */
  error: string
  /** 数据库错误码(MySQL errno、PG SQLSTATE、Oracle ORA-xxx、MSSQL number 等) */
  errorCode?: string
  connId?: string
  connName?: string
  /** 方便 AI 给方言相关建议 */
  dialect?: string
}

type ErrorAskListener = (e: ChatErrorAskEvent) => void
const errorAskListeners = new Set<ErrorAskListener>()

export function emitChatErrorAsk(e: ChatErrorAskEvent): void {
  for (const l of errorAskListeners) {
    try {
      l(e)
    } catch {
      /* 监听器自己处理 */
    }
  }
}

export function onChatErrorAsk(l: ErrorAskListener): () => void {
  errorAskListeners.add(l)
  return () => {
    errorAskListeners.delete(l)
  }
}

/**
 * 结构变更信号：query tab 执行 / 提交了 DDL 后广播，导航树深刷新对应连接子树。
 *
 * 同样走横切事件总线而非 emit 链：执行链 QueryPane → QueryTabs → Workspace → NavTree，
 * 中间 QueryTabs 是抽象多 tab 容器，逐层冒泡污染 props 又难追踪。
 */
export interface SchemaChangedEvent {
  connId: string
  /** 执行时的 schema 上下文（execOptions().schema）；缺省 = 深刷新整连接已展开子树 */
  schema?: string
}

type SchemaChangedListener = (e: SchemaChangedEvent) => void
const schemaChangedListeners = new Set<SchemaChangedListener>()

export function emitSchemaChanged(e: SchemaChangedEvent): void {
  for (const l of schemaChangedListeners) {
    try {
      l(e)
    } catch {
      /* 监听器自己处理 */
    }
  }
}

export function onSchemaChanged(l: SchemaChangedListener): () => void {
  schemaChangedListeners.add(l)
  return () => {
    schemaChangedListeners.delete(l)
  }
}
