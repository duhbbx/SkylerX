/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * ER 关系图模型:把 introspect 读出的 SchemaInput 压成「表节点 + 外键边」。
 * 纯函数、可单测;UI(ErDiagramDialog)只负责把它喂给 echarts 有向图。
 */
import type { SchemaInput } from '../migrate/convert'

export interface ErNode {
  id: string
  /** 列数(节点大小/提示用) */
  columns: number
  /** 主键列 */
  pk: string[]
  comment?: string
  /** 出边数(本表作为外键持有方,引用了几张表) */
  fkOut: number
}

export interface ErEdge {
  /** 持有外键的表(子) */
  from: string
  /** 被引用的表(父) */
  to: string
  /** 外键列 */
  columns: string[]
}

export interface ErModel {
  nodes: ErNode[]
  edges: ErEdge[]
  /** 指向本 schema 之外(refTable 不在表集合里)的外键数,UI 提示用 */
  externalRefs: number
}

/** 由 SchemaInput 构建 ER 模型。只保留两端都在本 schema 的外键边,跨库引用单独计数。 */
export function erModel(input: SchemaInput): ErModel {
  const known = new Set(input.tables.map((t) => t.name))
  const fkOut = new Map<string, number>()
  const edges: ErEdge[] = []
  let externalRefs = 0
  for (const fk of input.foreignKeys ?? []) {
    if (!known.has(fk.refTable)) {
      externalRefs++
      continue // 引用了本 schema 外的表,图里没有对应节点,跳过连线
    }
    fkOut.set(fk.table, (fkOut.get(fk.table) ?? 0) + 1)
    edges.push({ from: fk.table, to: fk.refTable, columns: fk.columns })
  }
  const nodes = input.tables.map((t) => ({
    id: t.name,
    columns: t.columns.length,
    pk: t.primaryKey ?? [],
    comment: t.comment,
    fkOut: fkOut.get(t.name) ?? 0,
  }))
  return { nodes, edges, externalRefs }
}
