/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TableContext } from '../ddl'

const SEP = '␟' // unit separator,容器各段之间的分隔符(不会出现在库名/路径里)

/** 由 contextOfNode 得到的容器(database/schema)拼成稳定键:PG 含两段、MySQL 一段、Oracle 一段。 */
export function containerKey(ctx: TableContext): string {
  return `${ctx.database ?? ''}${SEP}${ctx.schema ?? ''}`
}

/** RAG store 用的索引键(最终 localStorage 落在 `skylerx.rag.` + 此键)。 */
export function codeIndexKey(connId: string, container: string): string {
  return `code:${connId}${SEP}${container}`
}

type ConnLike = { extra?: Record<string, unknown> }
type RepoMap = Record<string, { path: string }>

/** 读连接上某容器绑定的代码库路径(未绑定 → undefined)。 */
export function getRepoPath(conn: ConnLike | null | undefined, container: string): string | undefined {
  const repos = conn?.extra?.codeRepos as RepoMap | undefined
  return repos?.[container]?.path || undefined
}

/**
 * 返回一个新的连接对象,在 extra.codeRepos[container] 写入/清除路径(纯函数,不改入参)。
 * 空路径 = 解除绑定(删除该 container 项;codeRepos 空了则删掉整个键)。
 */
export function setRepoPath<T extends ConnLike>(conn: T, container: string, path: string): T {
  const extra = { ...(conn.extra ?? {}) } as Record<string, unknown>
  const repos: RepoMap = { ...((extra.codeRepos as RepoMap | undefined) ?? {}) }
  const trimmed = path.trim()
  if (trimmed) repos[container] = { path: trimmed }
  else delete repos[container]
  if (Object.keys(repos).length) extra.codeRepos = repos
  else delete extra.codeRepos
  return { ...conn, extra: Object.keys(extra).length ? extra : undefined }
}
