/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */

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
