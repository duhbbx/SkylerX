/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DbDialect } from '@db-tool/shared-types'
import type { DatabaseDriver } from './driver.js'

/**
 * 方言驱动注册中心。
 *
 * 各方言驱动（mysql / pg / oracle...）在自己的模块里调用 registerDriver 注册，
 * LocalTransport 按 dialect 取用。这样新增一种数据库只需新增一个驱动文件并注册，
 * 不必改动 transport 或上层调用方。
 */
const drivers = new Map<DbDialect, DatabaseDriver>()

export function registerDriver(driver: DatabaseDriver): void {
  drivers.set(driver.dialect, driver)
}

export function getDriver(dialect: DbDialect): DatabaseDriver {
  const driver = drivers.get(dialect)
  if (!driver) {
    throw new Error(
      `尚未注册方言 "${dialect}" 的驱动。请在 dialects/ 下实现并调用 registerDriver()。`,
    )
  }
  return driver
}

export function hasDriver(dialect: DbDialect): boolean {
  return drivers.has(dialect)
}

export function registeredDialects(): DbDialect[] {
  return [...drivers.keys()]
}
