/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DataClient } from '@db-tool/shared-types'
import { type InjectionKey, inject } from 'vue'

/** 共享 UI 经此注入获取数据客户端（桌面=IPC/window.api，Web=REST）。 */
export const DataClientKey: InjectionKey<DataClient> = Symbol('data-client')

let cached: DataClient | null = null

/**
 * 取注入的数据客户端。迁移期/桌面端若未显式 provide，兜底用 window.api
 * （其形状与 DataClient 一致）。
 *
 * ⚠ files.saveText 在此层被 wrap 成自定义 SaveFileDialog —— 所有调用方无须改动。
 * 想走 OS 原生(极少数场景),可直接走 window.api.files.saveText。
 */
export function useDataClient(): DataClient {
  if (cached) return cached
  const injected = inject(DataClientKey, null)
  const real = injected ?? (globalThis as { api?: DataClient }).api
  if (!real) throw new Error('DataClient 未提供')
  cached = wrap(real)
  return cached
}

/** 用自定义 SaveFileDialog 覆盖原生 saveText / selectFile,保持其它接口透传。 */
function wrap(real: DataClient): DataClient {
  return {
    ...real,
    files: {
      ...real.files,
      saveText: async (req) => {
        // 惰性 import 避免循环依赖(saveFile.ts → SaveFileDialog → useDataClient)
        const { saveFileWithDialog } = await import('./saveFile')
        return saveFileWithDialog(req)
      },
      selectFile: async (req) => {
        // SQLite/DuckDB 选库文件路径(allowCreate=true 时允许新名)、或代码库关联选目录
        // (directory=true → pick-directory 模式):统一走自定义 SaveFileDialog,跨平台一致。
        const { selectFileWithDialog } = await import('./saveFile')
        return selectFileWithDialog(req ?? {})
      },
    },
  }
}
