import type { DataClient } from '@db-tool/shared-types'
import { type InjectionKey, inject } from 'vue'

/** 共享 UI 经此注入获取数据客户端（桌面=IPC/window.api，Web=REST）。 */
export const DataClientKey: InjectionKey<DataClient> = Symbol('data-client')

/**
 * 取注入的数据客户端。迁移期/桌面端若未显式 provide，兜底用 window.api
 * （其形状与 DataClient 一致）。
 */
export function useDataClient(): DataClient {
  const injected = inject(DataClientKey, null)
  if (injected) return injected
  const w = (globalThis as { api?: DataClient }).api
  if (w) return w
  throw new Error('DataClient 未提供')
}
