/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 存储容量趋势 —— 快照持久化(localStorage,按连接)。
 * 每个连接存一串 (时间, 字节) 点;封顶保留最近 N 条,避免无限增长。
 */
import type { SizeSnapshot } from './project'

const PREFIX = 'skylerx.storage-trend.'
const CAP = 730 // 最多留两年的日快照

type Storage = Pick<typeof globalThis.localStorage, 'getItem' | 'setItem' | 'removeItem'>
function store(s?: Storage): Storage | null {
  return s ?? (typeof globalThis !== 'undefined' ? (globalThis.localStorage ?? null) : null)
}

export function loadSnapshots(connId: string, s?: Storage): SizeSnapshot[] {
  const st = store(s)
  if (!st) return []
  try {
    const arr = JSON.parse(st.getItem(`${PREFIX}${connId}`) ?? '[]') as SizeSnapshot[]
    return Array.isArray(arr)
      ? arr.filter((x) => Number.isFinite(x?.at) && Number.isFinite(x?.bytes))
      : []
  } catch {
    return []
  }
}

/** 追加一个快照(按时间排序、封顶);返回新列表。 */
export function addSnapshot(connId: string, snap: SizeSnapshot, s?: Storage): SizeSnapshot[] {
  const st = store(s)
  const list = [...loadSnapshots(connId, s), snap].sort((a, b) => a.at - b.at).slice(-CAP)
  if (st) {
    try {
      st.setItem(`${PREFIX}${connId}`, JSON.stringify(list))
    } catch {
      /* quota 满:静默,不影响主流程 */
    }
  }
  return list
}

export function clearSnapshots(connId: string, s?: Storage): void {
  store(s)?.removeItem(`${PREFIX}${connId}`)
}
