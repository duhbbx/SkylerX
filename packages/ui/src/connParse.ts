/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ConnectionConfig } from '@db-tool/shared-types'
import { DIALECT_IDS } from './dialects'

/**
 * 从模型回复里抠出第一个 JSON 对象。容忍三种脏输出:
 *  ① ```json ... ``` 围栏  ② 对象前后包着说明文字  ③ 字符串值里出现的花括号。
 * 找不到可解析对象时抛错(上层据此提示"无法解析")。
 */
export function extractJson(text: string): unknown {
  if (!text || !text.trim()) throw new Error('EMPTY')
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  if (start < 0) throw new Error('NO_JSON')
  let depth = 0
  let inStr = false
  let esc = false
  let end = -1
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) throw new Error('NO_JSON')
  return JSON.parse(s.slice(start, end + 1))
}

/** 字符串字段:非空才保留(去首尾空格)。 */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/** 端口:数字或纯数字串 → 整数;否则丢弃。 */
function toPort(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim())
  return undefined
}

function sanitizeSsl(v: unknown): ConnectionConfig['ssl'] | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if (typeof o.rejectUnauthorized === 'boolean') out.rejectUnauthorized = o.rejectUnauthorized
  for (const k of ['ca', 'cert', 'key']) {
    const s = str(o[k])
    if (s) out[k] = s
  }
  if (typeof o.enabled === 'boolean') out.enabled = o.enabled
  else if (Object.keys(out).length) out.enabled = true
  return Object.keys(out).length ? (out as unknown as ConnectionConfig['ssl']) : undefined
}

function sanitizeSsh(v: unknown): ConnectionConfig['ssh'] | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of ['host', 'user', 'password', 'privateKey', 'passphrase']) {
    const s = str(o[k])
    if (s) out[k] = s
  }
  const port = toPort(o.port)
  if (port !== undefined) out.port = port
  if (typeof o.enabled === 'boolean') out.enabled = o.enabled
  else if (out.host) out.enabled = true
  return Object.keys(out).length ? (out as unknown as ConnectionConfig['ssh']) : undefined
}

/** extra 只接受标量(string/boolean/number),丢弃对象/数组等,防止把垃圾塞进配置。 */
function sanitizeExtra(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(o)) {
    if (typeof val === 'string' && val.trim()) out[k] = val.trim()
    else if (typeof val === 'boolean') out[k] = val
    else if (typeof val === 'number' && Number.isFinite(val)) out[k] = val
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * 把 AI 返回的(可能很脏的)对象规整成 Partial<ConnectionConfig>:
 * 白名单字段 + 端口转数字 + 方言校验(未知则丢) + 空串剔除 + 方言专属值收进 extra。
 * 永不抛错——拿不到的字段直接缺省,由用户在表单里补。
 */
export function sanitizeParsedConnection(raw: unknown): Partial<ConnectionConfig> {
  const out: Record<string, unknown> = {}
  if (!raw || typeof raw !== 'object') return out
  const o = raw as Record<string, unknown>

  if (typeof o.dialect === 'string' && DIALECT_IDS.has(o.dialect)) out.dialect = o.dialect

  for (const k of ['name', 'host', 'user', 'password', 'database', 'group']) {
    const s = str(o[k])
    if (s) out[k] = s
  }

  const port = toPort(o.port)
  if (port !== undefined) out.port = port

  const ssl = sanitizeSsl(o.ssl)
  if (ssl) out.ssl = ssl

  const ssh = sanitizeSsh(o.ssh)
  if (ssh) out.ssh = ssh

  const extra = sanitizeExtra(o.extra)
  if (extra) out.extra = extra

  return out as Partial<ConnectionConfig>
}
