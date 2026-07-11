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

/** Runs one code-repository binding and indexing operation against an immutable root snapshot. */
export async function runCodeRepoBuild<Saved, Refresh>(
  path: string,
  operations: CodeRepoBuildOperations<Saved, Refresh>,
): Promise<CodeRepoBuildResult<Saved, Refresh>> {
  const root = path.trim()
  if (!root) throw new Error('CODE_REPO_PATH_REQUIRED')

  const saved = await operations.persist(root)
  const refresh = await operations.refresh(root)
  return { root, saved, refresh }
}
