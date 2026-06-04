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

/**
 * 聚焦:只保留名字命中 query(大小写不敏感子串)的表 + 它们的 N 跳外键邻居(双向)。
 * 大库 ER 图一团乱时,输个表名只看它周边。query 为空 → 原样返回。
 * externalRefs 重算为「命中集合连到集合外的边数」(= 被隐藏的关联数,UI 提示用)。
 */
export function focusModel(model: ErModel, query: string, hops = 1): ErModel {
  const q = query.trim().toLowerCase()
  if (!q) return model
  const adj = new Map<string, Set<string>>()
  for (const e of model.edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set())
    if (!adj.has(e.to)) adj.set(e.to, new Set())
    adj.get(e.from)?.add(e.to)
    adj.get(e.to)?.add(e.from)
  }
  const keep = new Set<string>()
  let frontier = model.nodes.filter((n) => n.id.toLowerCase().includes(q)).map((n) => n.id)
  for (const id of frontier) keep.add(id)
  for (let h = 0; h < hops; h++) {
    const next: string[] = []
    for (const id of frontier)
      for (const nb of adj.get(id) ?? [])
        if (!keep.has(nb)) {
          keep.add(nb)
          next.push(nb)
        }
    frontier = next
  }
  const nodes = model.nodes.filter((n) => keep.has(n.id))
  const edges = model.edges.filter((e) => keep.has(e.from) && keep.has(e.to))
  const externalRefs = model.edges.filter(
    (e) => keep.has(e.from) !== keep.has(e.to), // 一端在集合内、一端在外
  ).length
  return { nodes, edges, externalRefs }
}
