/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ConnectionScope } from '@db-tool/shared-types'

const cryptoLike = globalThis.crypto as { randomUUID?: () => string } | undefined
const windowScopeId =
  cryptoLike?.randomUUID?.() ?? `w${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export function navConnectionScope(): ConnectionScope {
  return { id: `nav:${windowScopeId}`, kind: 'navigation' }
}

export function queryTabConnectionScope(tabId: number): ConnectionScope {
  return { id: `tab:${windowScopeId}:${tabId}`, kind: 'query-tab' }
}
