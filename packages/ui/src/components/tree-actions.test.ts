/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect, MetaNodeKind } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { actionsFor } from './tree-actions'
import type { TreeNode } from './treeNode'

function node(kind: MetaNodeKind, name: string, path: string[] = [name]): TreeNode {
  return {
    kind,
    name,
    path,
    hasChildren: false,
    expanded: false,
    loading: false,
    error: null,
    children: null,
  }
}

function hasDrop(kind: MetaNodeKind, dialect: DbDialect): boolean {
  return actionsFor(node(kind, 'X', ['HR', 'X']), dialect).some((a) => a.id === 'drop-object')
}

describe('drop-object action — Oracle/DM object kinds', () => {
  // synonym/package/type/sequence/trigger 都应出现在右键删除里(两步确认走通用弹窗)
  for (const dialect of [DbDialect.Oracle, DbDialect.DM]) {
    for (const kind of [
      MetaNodeKind.Synonym,
      MetaNodeKind.Package,
      MetaNodeKind.Type,
      MetaNodeKind.Sequence,
      MetaNodeKind.Trigger,
    ]) {
      it(`${dialect} ${kind} → drop-object available`, () => {
        expect(hasDrop(kind, dialect)).toBe(true)
      })
    }
  }

  it('system schema → no drop-object', () => {
    const sys = node(MetaNodeKind.Schema, 'SYS', ['SYS'])
    expect(actionsFor(sys, DbDialect.Oracle).some((a) => a.id === 'drop-object')).toBe(false)
  })
})
