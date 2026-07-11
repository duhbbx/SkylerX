/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { getDialectIcon } from './dialect-icon'

function iconSrc(dialect: DbDialect): string {
  return (getDialectIcon(dialect) as { src?: string }).src ?? ''
}

describe('dialect PNG icons', () => {
  it('returns bundled PNG assets for dialects with provided icons', () => {
    expect(iconSrc(DbDialect.MySQL)).toMatch(/mysql\.png$/)
    expect(iconSrc(DbDialect.PostgreSQL)).toMatch(/postgresql\.png$/)
    expect(iconSrc(DbDialect.ClickHouse)).toMatch(/clickhouse\.png$/)
    expect(iconSrc(DbDialect.DM)).toMatch(/dameng\.png$/)
    expect(iconSrc(DbDialect.Elasticsearch)).toMatch(/elastic\.png$/)
    expect(iconSrc(DbDialect.MongoDB)).toMatch(/mongo\.png$/)
  })

  it('maps wire-compatible variants to their closest database family icon', () => {
    expect(iconSrc(DbDialect.GaussDB)).toMatch(/opengauss\.png$/)
    expect(iconSrc(DbDialect.TimescaleDB)).toMatch(/postgresql\.png$/)
    expect(iconSrc(DbDialect.GreatSQL)).toMatch(/mysql\.png$/)
    expect(iconSrc(DbDialect.PolarDBX)).toMatch(/mysql\.png$/)
  })
})
