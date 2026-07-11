/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
export interface CodeRepoBuildOperations<Saved, Refresh> {
  persist(root: string): Promise<Saved>
  refresh(root: string): Promise<Refresh>
}

export interface CodeRepoBuildResult<Saved, Refresh> {
  root: string
  saved: Saved
  refresh: Refresh
}

/** Stable repository identity used by bindings, manifests, and code indexes. */
export function normalizeCodeRepoRoot(path: string): string {
  const root = path.trim()
  if (!root) return root
  if (/^[\\/]+$/.test(root)) return root[0]
  const driveRoot = root.match(/^([A-Za-z]:)([\\/]+)$/)
  if (driveRoot) return `${driveRoot[1]}${driveRoot[2][0]}`
  return root.replace(/[\\/]+$/, '')
}

/** Runs one code-repository binding and indexing operation against an immutable root snapshot. */
export async function runCodeRepoBuild<Saved, Refresh>(
  path: string,
  operations: CodeRepoBuildOperations<Saved, Refresh>,
): Promise<CodeRepoBuildResult<Saved, Refresh>> {
  const root = normalizeCodeRepoRoot(path)
  if (!root) throw new Error('CODE_REPO_PATH_REQUIRED')

  const refresh = await operations.refresh(root)
  const saved = await operations.persist(root)
  return { root, saved, refresh }
}
