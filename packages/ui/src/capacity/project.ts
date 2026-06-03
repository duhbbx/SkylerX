/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 存储容量趋势 —— 线性回归预测。
 *
 * 给一串 (时间, 字节) 快照,用最小二乘拟合出增长速率(字节/天),
 * 预测 7/30/90 天后的大小,以及(给了阈值时)多少天后到阈值。纯函数,可单测。
 */

export interface SizeSnapshot {
  /** epoch 毫秒 */
  at: number
  bytes: number
}

export interface Projection {
  /** 增长速率:字节/天(可能为负=在缩)。 */
  perDayBytes: number
  /** 最近一次快照的大小。 */
  current: number
  /** 预测 +7 / +30 / +90 天后的大小(不小于 0)。 */
  in7d: number
  in30d: number
  in90d: number
  /** 给了阈值且在增长时:还有多少天到阈值;已超过=0;不增长=undefined。 */
  etaDays?: number
}

const DAY = 86_400_000

/**
 * 由快照预测。少于 2 个点无法拟合,返回 null。
 * @param opts.thresholdBytes 容量阈值(到阈值的 ETA)
 * @param opts.nowMs 当前时间(注入便于测试;缺省用最后一个快照时间)
 */
export function project(
  snapshots: SizeSnapshot[],
  opts: { thresholdBytes?: number; nowMs?: number } = {},
): Projection | null {
  const pts = [...snapshots].filter((s) => Number.isFinite(s.at) && Number.isFinite(s.bytes))
  if (pts.length < 2) return null
  pts.sort((a, b) => a.at - b.at)

  // x = 距首个快照的天数,y = 字节;最小二乘斜率
  const x0 = pts[0].at
  const xs = pts.map((p) => (p.at - x0) / DAY)
  const ys = pts.map((p) => p.bytes)
  const n = pts.length
  const sx = xs.reduce((a, b) => a + b, 0)
  const sy = ys.reduce((a, b) => a + b, 0)
  const sxx = xs.reduce((a, b) => a + b * b, 0)
  const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0)
  const denom = n * sxx - sx * sx
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom // 字节/天
  const intercept = (sy - slope * sx) / n

  const now = opts.nowMs ?? pts[pts.length - 1].at
  const nowDay = (now - x0) / DAY
  const at = (day: number): number => Math.max(0, intercept + slope * day)
  const current = at(nowDay)

  let etaDays: number | undefined
  if (opts.thresholdBytes != null && slope > 0) {
    if (current >= opts.thresholdBytes) etaDays = 0
    else etaDays = (opts.thresholdBytes - current) / slope
  }

  return {
    perDayBytes: slope,
    current,
    in7d: at(nowDay + 7),
    in30d: at(nowDay + 30),
    in90d: at(nowDay + 90),
    etaDays,
  }
}
