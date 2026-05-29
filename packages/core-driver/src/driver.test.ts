/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { driverExtra } from './driver'

const base = {
  id: 'c1',
  name: 'local',
  dialect: DbDialect.MySQL,
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
}

describe('driverExtra', () => {
  it('returns undefined when no extra', () => {
    expect(driverExtra(base)).toBeUndefined()
  })
  it('returns undefined when extra only contains app-level keys', () => {
    expect(driverExtra({ ...base, extra: { env: 'prod', readOnly: true } })).toBeUndefined()
  })
  it('strips env / readOnly / agentId but keeps real driver options', () => {
    const out = driverExtra({
      ...base,
      extra: {
        env: 'prod',
        readOnly: true,
        agentId: 'a1',
        connectTimeout: 5000,
        charset: 'utf8mb4',
      },
    })
    expect(out).toEqual({ connectTimeout: 5000, charset: 'utf8mb4' })
  })
})
