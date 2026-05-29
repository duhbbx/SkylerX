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
