/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect } from '@db-tool/shared-types'
import { beforeEach, describe, expect, it } from 'vitest'
import { favorites, isFavorite, removeFavorite, toggleFavorite } from './favorites'

const base = {
  connId: 'c1',
  connName: 'local',
  dialect: DbDialect.MySQL,
  schema: 'shop',
  name: 'users',
  sqlName: '`shop`.`users`',
  kind: 'table',
}

describe('favorites', () => {
  beforeEach(() => {
    favorites.splice(0, favorites.length)
  })

  it('toggles add/remove and reflects in isFavorite', () => {
    expect(isFavorite('c1', '`shop`.`users`')).toBe(false)
    expect(toggleFavorite(base)).toBe(true)
    expect(isFavorite('c1', '`shop`.`users`')).toBe(true)
    expect(favorites).toHaveLength(1)
    expect(toggleFavorite(base)).toBe(false)
    expect(isFavorite('c1', '`shop`.`users`')).toBe(false)
    expect(favorites).toHaveLength(0)
  })

  it('keys by connId + sqlName (same name, different conn = distinct)', () => {
    toggleFavorite(base)
    toggleFavorite({ ...base, connId: 'c2', connName: 'prod' })
    expect(favorites).toHaveLength(2)
    expect(isFavorite('c2', '`shop`.`users`')).toBe(true)
  })

  it('removeFavorite drops by id', () => {
    toggleFavorite(base)
    removeFavorite('c1|`shop`.`users`')
    expect(favorites).toHaveLength(0)
  })
})
