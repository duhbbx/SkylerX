/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { type MigJob, deleteJob, listJobs, loadJob, newJobId, saveJob } from './jobStore'

function mem() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
  }
}
const job = (id: string, t: number): MigJob => ({
  id,
  createdAt: t,
  updatedAt: t,
  srcConnId: 's',
  tgtConnId: 'g',
  srcName: 'ORCL',
  tgtName: 'VB',
  schemas: ['HR'],
  tables: [
    { schema: 'HR', name: 'a', status: 'done', copied: 100 },
    { schema: 'HR', name: 'b', status: 'pending', copied: 0 },
  ],
})

describe('jobStore', () => {
  it('save / load / delete round-trip', () => {
    const s = mem()
    saveJob(job('j1', 1000), s)
    expect(loadJob('j1', s)?.srcName).toBe('ORCL')
    deleteJob('j1', s)
    expect(loadJob('j1', s)).toBeNull()
  })

  it('listJobs summarizes done/total/copied, sorted by updatedAt desc', () => {
    const s = mem()
    saveJob(job('old', 1000), s)
    saveJob(job('new', 2000), s)
    const list = listJobs(s)
    expect(list.map((j) => j.id)).toEqual(['new', 'old']) // newest first
    expect(list[0]).toMatchObject({ done: 1, total: 2, copied: 100 })
  })

  it('ignores corrupt entries', () => {
    const s = mem()
    s.setItem('skylerx.migJob.bad', '{not json')
    saveJob(job('ok', 1), s)
    expect(listJobs(s).map((j) => j.id)).toEqual(['ok'])
  })

  it('newJobId is stable-ish and unique per (now, rand)', () => {
    expect(newJobId(1000, 0.5)).not.toBe(newJobId(1000, 0.6))
  })
})
