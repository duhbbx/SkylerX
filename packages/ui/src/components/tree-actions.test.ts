/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect, MetaNodeKind } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { actionsFor, isSystemMetaNode, isSystemSchemaName } from './tree-actions'
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

describe('new-query action — 表/视图目录(Group)节点', () => {
  function group(groupName: string): TreeNode {
    return { ...node(MetaNodeKind.Group, groupName, ['shop', groupName]), group: groupName }
  }
  const hasNewQuery = (n: TreeNode): boolean =>
    actionsFor(n, DbDialect.MySQL).some((a) => a.id === 'new-query')

  it('出现在「表」目录与「视图」目录节点上', () => {
    expect(hasNewQuery(group('tables'))).toBe(true)
    expect(hasNewQuery(group('views'))).toBe(true)
  })

  it('不出现在其它目录(函数/序列等)节点上', () => {
    expect(hasNewQuery(group('functions'))).toBe(false)
    expect(hasNewQuery(group('sequences'))).toBe(false)
  })

  it('仍出现在连接 / 库 / schema 节点上(回归)', () => {
    expect(hasNewQuery(node(MetaNodeKind.Connection, 'c', []))).toBe(true)
    expect(hasNewQuery(node(MetaNodeKind.Database, 'shop', ['shop']))).toBe(true)
    expect(hasNewQuery(node(MetaNodeKind.Schema, 'public', ['shop', 'public']))).toBe(true)
  })
})

describe('isSystemMetaNode / isSystemSchemaName (一键排除系统库/Schema)', () => {
  const m = (kind: string, name: string, system?: boolean) => ({ kind, name, detail: { system } })

  it('flags system databases (MySQL / PG / SQL Server)', () => {
    for (const n of [
      'mysql',
      'information_schema',
      'performance_schema',
      'sys',
      'postgres',
      'template0',
      'master',
      'msdb',
    ])
      expect(isSystemMetaNode(m('database', n))).toBe(true)
    expect(isSystemMetaNode(m('database', 'my_app'))).toBe(false)
  })
  it('flags system schemas incl. DM SYSAUDITOR/SYSSSO, PG pg_* prefix', () => {
    for (const n of [
      'pg_catalog',
      'pg_toast',
      'pg_temp_3',
      'SYS',
      'SYSAUDITOR',
      'SYSSSO',
      'dbe_perf',
      'db_owner',
      'INFORMATION_SCHEMA',
    ])
      expect(isSystemMetaNode(m('schema', n))).toBe(true)
  })
  it('does NOT flag user schemas (DM SYSDBA holds user objects; dbo/public/TEST are user)', () => {
    for (const n of ['SYSDBA', 'dbo', 'public', 'TEST', 'HR', 'app'])
      expect(isSystemMetaNode(m('schema', n))).toBe(false)
  })
  it('honors backend detail.system flag (e.g. Oracle oracle_maintained=Y)', () => {
    expect(isSystemMetaNode(m('schema', 'WEIRD_INTERNAL', true))).toBe(true)
  })
  it('isSystemSchemaName covers pg_* prefix', () => {
    expect(isSystemSchemaName('pg_temp_1')).toBe(true)
    expect(isSystemSchemaName('my_schema')).toBe(false)
  })
})
