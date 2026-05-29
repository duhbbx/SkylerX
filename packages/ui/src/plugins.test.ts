/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { MetaNodeKind } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { actionsFor } from './components/tree-actions'
import type { TreeNode } from './components/treeNode'
import {
  pluginBuiltinSnippets,
  pluginTreeActions,
  registerBuiltinSnippet,
  registerTreeAction,
} from './plugins'

const tableNode: TreeNode = {
  kind: MetaNodeKind.Table,
  name: 'users',
  sqlName: '`users`',
  path: ['db', 'users'],
  hasChildren: true,
  expanded: false,
  loading: false,
  error: null,
  children: null,
}

describe('plugins.registerTreeAction', () => {
  it('appends to actionsFor and unregister removes it', () => {
    const before = actionsFor(tableNode).length
    const unregister = registerTreeAction({
      id: 'test:hello',
      label: 'Hello',
      kinds: [MetaNodeKind.Table],
      run: () => {},
    })
    expect(actionsFor(tableNode).length).toBe(before + 1)
    expect(pluginTreeActions().some((a) => a.id === 'test:hello')).toBe(true)
    unregister()
    expect(actionsFor(tableNode).length).toBe(before)
  })

  it('respects per-action kind filtering', () => {
    const unreg = registerTreeAction({
      id: 'test:db-only',
      label: 'DB only',
      kinds: [MetaNodeKind.Database],
      run: () => {},
    })
    expect(actionsFor(tableNode).some((a) => a.id === 'test:db-only')).toBe(false)
    unreg()
  })
})

describe('plugins.registerBuiltinSnippet', () => {
  it('exposes registered snippets via pluginBuiltinSnippets', () => {
    const unreg = registerBuiltinSnippet({ name: 'pingdb', sql: 'SELECT 1' })
    expect(pluginBuiltinSnippets().some((s) => s.name === 'pingdb')).toBe(true)
    unreg()
    expect(pluginBuiltinSnippets().some((s) => s.name === 'pingdb')).toBe(false)
  })
})
