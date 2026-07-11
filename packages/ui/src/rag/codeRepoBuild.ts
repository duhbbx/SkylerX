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
  if (!path.trim()) return ''

  const isWindowsDrive = /^[A-Za-z]:[\\/]/.test(path)
  const isUnc = /^[/\\]{2}[^/\\]+[/\\]+[^/\\]+/.test(path)
  if (isWindowsDrive || isUnc) {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
    return /^[A-Za-z]:$/.test(normalized) ? `${normalized}/` : normalized
  }

  return path.replace(/\/+$/, '') || '/'
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
