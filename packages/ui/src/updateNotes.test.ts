/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { renderUpdateNotesHtml } from './updateNotes'

describe('renderUpdateNotesHtml', () => {
  it('renders GitHub HTML release body instead of escaping tags', () => {
    const html = renderUpdateNotesHtml(
      '<h2>✨ What&apos;s New</h2><ul><li>(none)</li></ul><h2>🐛 Fixes</h2><ul><li>Preserved query context</li></ul>',
    )

    expect(html).toContain('<h2>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>Preserved query context</li>')
    expect(html).not.toContain('&lt;h2&gt;')
  })

  it('renders markdown release notes', () => {
    const html = renderUpdateNotesHtml('## Fixes\n\n- Render update notes')

    expect(html).toContain('<h2>')
    expect(html).toContain('Fixes')
    expect(html).toContain('<li>Render update notes</li>')
  })

  it('strips active content and unsafe attributes', () => {
    const html = renderUpdateNotesHtml(
      '<h2 onclick="alert(1)">Title</h2><img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">bad</a>',
    )

    expect(html).toContain('<h2>Title</h2>')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('alert')
    expect(html).toContain('<a>bad</a>')
  })
})
