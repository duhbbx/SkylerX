/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { renderMarkdown } from './markdown'

const ALLOWED_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'ul',
])
const VOID_TAGS = new Set(['br', 'hr'])

export function renderUpdateNotesHtml(src: string | undefined): string {
  const raw = (src ?? '').trim()
  if (!raw) return ''
  return sanitizeHtml(renderMarkdown(raw))
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(script|style|iframe|object|embed|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*\/?\s*([a-z0-9-]+)([^>]*)>/gi, (full, tagName: string, attrs: string) => {
      const tag = tagName.toLowerCase()
      if (!ALLOWED_TAGS.has(tag)) return ''
      if (/^<\s*\//.test(full)) return VOID_TAGS.has(tag) ? '' : `</${tag}>`
      if (tag === 'a') return sanitizeAnchor(attrs)
      return VOID_TAGS.has(tag) ? `<${tag}>` : `<${tag}>`
    })
}

function sanitizeAnchor(attrs: string): string {
  const href = readHref(attrs)
  if (!href || !isSafeHref(href)) return '<a>'
  const escaped = escapeAttr(href)
  return `<a href="${escaped}" target="_blank" rel="noopener noreferrer">`
}

function readHref(attrs: string): string | null {
  const quoted = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(attrs)
  if (quoted) return decodeHtmlEntities(quoted[2].trim())
  const bare = /\bhref\s*=\s*([^\s"'=<>`]+)/i.exec(attrs)
  return bare ? decodeHtmlEntities(bare[1].trim()) : null
}

function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:|#|\/)/i.test(href)
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}
