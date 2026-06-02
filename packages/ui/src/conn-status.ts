/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { reactive } from 'vue'

/**
 * 连接可达性状态（轻量,纯前端内存）：在已发生的连接活动(展开导航树 / 测试连接)上
 * 顺带记录,不主动探测。导航树连接节点据此显示一个小圆点：🟢 上次连上 / 🔴 上次出错。
 * 未尝试过的连接不显示圆点(避免噪音)。
 */
export type ConnStatus = 'ok' | 'error'

const statusMap = reactive(new Map<string, ConnStatus>())

export function setConnStatus(id: string, s: ConnStatus): void {
  statusMap.set(id, s)
}

/** 响应式读取（模板里调用会随状态变化自动更新）。未知返回 undefined。 */
export function connStatus(id: string): ConnStatus | undefined {
  return statusMap.get(id)
}
