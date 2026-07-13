/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type DbDialect, MetaNodeKind, type MetadataNode } from '@db-tool/shared-types'
import { familyOf, type TableContext } from './ddl'

export interface QueryContextState {
  topKind: 'database' | 'schema' | null
  dbOptions: string[]
  schemaOptions: string[]
  selectedDb: string
  selectedSchema: string
  execOptions: {
    database?: string
    schema?: string
  }
}

export function resolveQueryContextState(input: {
  dialect: DbDialect
  connectionDatabase?: string
  connectionUser?: string
  initialCtx?: TableContext
  topNodes: MetadataNode[]
  schemaNodes: MetadataNode[]
}): QueryContextState {
  const family = familyOf(input.dialect)
  const topSchemas = input.topNodes.filter((n) => n.kind === MetaNodeKind.Schema).map((n) => n.name)
  const topDatabases = input.topNodes
    .filter((n) => n.kind === MetaNodeKind.Database)
    .map((n) => n.name)
  const childSchemas = input.schemaNodes
    .filter((n) => n.kind === MetaNodeKind.Schema)
    .map((n) => n.name)

  if (family === 'oracle') {
    const fallbackSchema = input.initialCtx?.schema ?? input.connectionUser ?? input.connectionDatabase ?? ''
    const schemaOptions = uniqueNonEmpty([...topSchemas, fallbackSchema])
    const selectedSchema = pickExisting(schemaOptions, fallbackSchema)
    return {
      topKind: 'schema',
      dbOptions: [],
      schemaOptions,
      selectedDb: '',
      selectedSchema,
      execOptions: compactExecOptions({ schema: selectedSchema }),
    }
  }

  const fallbackDb = input.initialCtx?.database ?? input.connectionDatabase ?? ''
  const dbOptions = uniqueNonEmpty([...topDatabases, fallbackDb])
  const selectedDb = pickExisting(dbOptions, fallbackDb)
  const fallbackSchema = input.initialCtx?.schema ?? ''
  const schemaOptions = uniqueNonEmpty([...childSchemas, fallbackSchema])
  const selectedSchema = pickExisting(schemaOptions, fallbackSchema)

  return {
    topKind: 'database',
    dbOptions,
    schemaOptions,
    selectedDb,
    selectedSchema,
    execOptions: compactExecOptions({
      database: selectedDb,
      schema: selectedSchema,
    }),
  }
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)))
}

function pickExisting(options: string[], preferred: string): string {
  const v = preferred.trim()
  if (!v) return ''
  return options.includes(v) ? v : ''
}

function compactExecOptions(options: { database?: string; schema?: string }): {
  database?: string
  schema?: string
} {
  return {
    ...(options.database ? { database: options.database } : {}),
    ...(options.schema ? { schema: options.schema } : {}),
  }
}
