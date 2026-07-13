/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { DbDialect, MetaNodeKind, type MetadataNode } from '@db-tool/shared-types'
import { describe, expect, it } from 'vitest'
import { resolveQueryContextState } from './queryContext'

const db = (name: string): MetadataNode => ({
  kind: MetaNodeKind.Database,
  name,
  path: [name],
  hasChildren: true,
})

const schema = (name: string): MetadataNode => ({
  kind: MetaNodeKind.Schema,
  name,
  path: [name],
  hasChildren: true,
})

describe('query context state', () => {
  it('uses metadata database options and preselects the connection default database', () => {
    const state = resolveQueryContextState({
      dialect: DbDialect.MySQL,
      connectionDatabase: 'app',
      topNodes: [db('mysql'), db('app')],
      schemaNodes: [],
    })

    expect(state.topKind).toBe('database')
    expect(state.dbOptions).toEqual(['mysql', 'app'])
    expect(state.selectedDb).toBe('app')
    expect(state.execOptions).toEqual({ database: 'app' })
  })

  it('keeps a database selector from the connection default when metadata is unavailable', () => {
    const state = resolveQueryContextState({
      dialect: DbDialect.MySQL,
      connectionDatabase: 'app',
      topNodes: [],
      schemaNodes: [],
    })

    expect(state.topKind).toBe('database')
    expect(state.dbOptions).toEqual(['app'])
    expect(state.selectedDb).toBe('app')
    expect(state.execOptions).toEqual({ database: 'app' })
  })

  it('preselects schema options for two-level database dialects', () => {
    const state = resolveQueryContextState({
      dialect: DbDialect.PostgreSQL,
      connectionDatabase: 'postgres',
      initialCtx: { database: 'postgres', schema: 'shop' },
      topNodes: [db('postgres')],
      schemaNodes: [schema('public'), schema('shop')],
    })

    expect(state.topKind).toBe('database')
    expect(state.selectedDb).toBe('postgres')
    expect(state.schemaOptions).toEqual(['public', 'shop'])
    expect(state.selectedSchema).toBe('shop')
    expect(state.execOptions).toEqual({ database: 'postgres', schema: 'shop' })
  })

  it('uses the connection user as the Oracle-family schema fallback', () => {
    const state = resolveQueryContextState({
      dialect: DbDialect.Oracle,
      connectionUser: 'HR',
      topNodes: [schema('SYS'), schema('HR')],
      schemaNodes: [],
    })

    expect(state.topKind).toBe('schema')
    expect(state.schemaOptions).toEqual(['SYS', 'HR'])
    expect(state.selectedSchema).toBe('HR')
    expect(state.execOptions).toEqual({ schema: 'HR' })
  })
})
