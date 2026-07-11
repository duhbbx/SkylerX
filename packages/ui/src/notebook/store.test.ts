/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import {
  type Notebook,
  deleteNotebook,
  listNotebooks,
  loadNotebook,
  newId,
  saveNotebook,
} from './store'

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
const nb = (id: string, t: number): Notebook => ({
  id,
  title: `NB ${id}`,
  connId: 'c1',
  createdAt: t,
  updatedAt: t,
  cells: [
    { id: 'a', kind: 'sql', content: 'select 1' },
    { id: 'b', kind: 'md', content: '# hi' },
  ],
})

describe('notebook store', () => {
  it('save / load / delete', () => {
    const s = mem()
    saveNotebook(nb('n1', 1), s)
    expect(loadNotebook('n1', s)?.cells.length).toBe(2)
    deleteNotebook('n1', s)
    expect(loadNotebook('n1', s)).toBeNull()
  })
  it('listNotebooks summarizes, newest first, skips corrupt', () => {
    const s = mem()
    saveNotebook(nb('old', 100), s)
    saveNotebook(nb('new', 200), s)
    s.setItem('skylerx.notebook.bad', '{nope')
    const list = listNotebooks(s)
    expect(list.map((x) => x.id)).toEqual(['new', 'old'])
    expect(list[0]).toMatchObject({ cells: 2, connId: 'c1' })
  })
  it('newId unique per input', () => {
    expect(newId(1, 0.1)).not.toBe(newId(1, 0.9))
  })
})
