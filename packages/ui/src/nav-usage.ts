/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * NavTree 节点使用频率统计（用户报告 #7）：
 *  - 记录用户「展开 / 双击 / 选中」每个数据库或 schema 节点的次数
 *  - NavTree 排序时高频项靠前（仅 Database / Schema 两层，table 列保持字典序）
 *  - 默认关，由 settings.navSortByUsage 触发
 *
 * 存储：localStorage 一个 JSON map（`connId\tpath` → count）
 * 响应性：每次 bump 后 navUsageVersion++，触发 TreeItem 的 computed 重算
 */

import { ref } from 'vue'

const KEY = 'skylerx.nav.usage'
type UsageMap = Record<string, number>

function load(): UsageMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as UsageMap
  } catch {
    return {}
  }
}

function save(map: UsageMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* 配额 / 隐私模式 → 静默 */
  }
}

let cache = load()

/**
 * 修改时间戳：TreeItem 的 computed 依赖此 ref 触发响应式重算。
 * 直接把 cache 做成 reactive 不划算——cache 可能含成百上千个 key，
 * 这里只需要"有变化就重排"的粒度。
 */
export const navUsageVersion = ref(0)

function k(connId: string, parts: string[]): string {
  // 用 \t 做分隔（path 段里不会出现）
  return `${connId}\t${parts.join('/')}`
}

/** 累加一次使用计数（用户展开 / 双击 / 选中节点时调）。 */
export function bumpUsage(connId: string, path: string[]): void {
  if (!connId || !path.length) return
  const key = k(connId, path)
  cache[key] = (cache[key] || 0) + 1
  save(cache)
  navUsageVersion.value++
}

/** 取节点的使用计数，没有则 0。 */
export function getUsage(connId: string, path: string[]): number {
  if (!connId || !path.length) return 0
  return cache[k(connId, path)] || 0
}

/** 清空（设置页提供「重置」按钮用）。 */
export function clearUsage(): void {
  cache = {}
  save(cache)
  navUsageVersion.value++
}
