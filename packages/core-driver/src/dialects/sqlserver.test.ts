/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * SQL Server 导航对象分组 —— mock pool 验证接线(分组键 / 子节点 kind / catalog 引用)。
 * ⚠ 无本机 SQL Server 实例,SQL 未真库活验;用的是标准、稳定的系统视图
 * (INFORMATION_SCHEMA.ROUTINES / sys.triggers / sys.sequences / sys.types / sys.synonyms)。
 */
import { MetaNodeKind, type MetadataNode } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { MssqlConnection } from './sqlserver'

/** 记录收到的 SQL;count 查询返回 [{c}],其它返回 [{name}]。 */
function mockPool(captured: string[]) {
  const pool = {
    request() {
      const req = {
        input: () => req,
        query: async (sql: string) => {
          captured.push(sql)
          return { recordset: /COUNT\(\*\)/.test(sql) ? [{ c: 2 }] : [{ name: 'obj1' }] }
        },
      }
      return req
    },
  }
  return pool as unknown as ConstructorParameters<typeof MssqlConnection>[0]
}

describe('SQL Server nav object groups (mock; not live-verified)', () => {
  it('schemaGroups exposes all 8 object types in order', async () => {
    const conn = new MssqlConnection(mockPool([]))
    const groups = (await conn.fetchMetadata({
      parentKind: MetaNodeKind.Schema,
      path: ['mydb', 'dbo'],
    })) as MetadataNode[]
    expect(groups.map((g) => g.group)).toEqual([
      'tables',
      'views',
      'functions',
      'procedures',
      'triggers',
      'sequences',
      'types',
      'synonyms',
    ])
    expect(groups.map((g) => g.name)).toEqual([
      '表',
      '视图',
      '函数',
      '存储过程',
      '触发器',
      '序列',
      '类型',
      '同义词',
    ])
  })

  it('each new group lists children with the correct kind + references the right catalog', async () => {
    // FUNCTION/PROCEDURE 走绑定参数(@t),不在 SQL 文本里;故只校验 catalog 引用,
    // 函数/过程的区分由上面的 kind 断言保证。
    const cases: Array<[string, MetaNodeKind, RegExp]> = [
      ['functions', MetaNodeKind.Function, /INFORMATION_SCHEMA\.ROUTINES/],
      ['procedures', MetaNodeKind.Procedure, /INFORMATION_SCHEMA\.ROUTINES/],
      ['triggers', MetaNodeKind.Trigger, /sys\.triggers/],
      ['sequences', MetaNodeKind.Sequence, /sys\.sequences/],
      ['types', MetaNodeKind.Type, /sys\.types.*is_user_defined=1/s],
      ['synonyms', MetaNodeKind.Synonym, /sys\.synonyms/],
    ]
    for (const [group, kind, catalog] of cases) {
      const captured: string[] = []
      const conn = new MssqlConnection(mockPool(captured))
      const nodes = (await conn.fetchMetadata({
        parentKind: MetaNodeKind.Group,
        path: ['mydb', 'dbo'],
        group,
      })) as MetadataNode[]
      expect(nodes[0]?.kind, group).toBe(kind)
      expect(nodes[0]?.name).toBe('obj1')
      expect(nodes[0]?.sqlName).toBe('[mydb].[dbo].[obj1]') // 3-part 限定名
      expect(
        captured.some((s) => catalog.test(s)),
        `${group} catalog`,
      ).toBe(true)
    }
  })
})
