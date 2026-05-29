/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ITER,
  ENC_MAGIC,
  decryptText,
  encryptText,
  parseBlob,
  stringifyBlob,
} from './export-encrypt'

describe('encryptText / decryptText', () => {
  it('round-trips and ciphertext differs from plaintext', async () => {
    const text = 'CREATE TABLE t(id int);'
    const blob = await encryptText(text, 'hunter2')
    expect(blob.magic).toBe(ENC_MAGIC)
    expect(blob.iter).toBe(DEFAULT_ITER)
    expect(blob.salt.length).toBeGreaterThan(0)
    expect(blob.iv.length).toBeGreaterThan(0)
    expect(blob.data).not.toContain('CREATE')
    expect(blob.data).not.toBe(text)
    const back = await decryptText(blob, 'hunter2')
    expect(back).toBe(text)
  })

  it('throws WRONG_PASSWORD on wrong password', async () => {
    const blob = await encryptText('secret payload', 'right-pw')
    await expect(decryptText(blob, 'wrong-pw')).rejects.toThrow('WRONG_PASSWORD')
  })

  it('handles empty string', async () => {
    const blob = await encryptText('', 'pw')
    const back = await decryptText(blob, 'pw')
    expect(back).toBe('')
  })

  it('handles large text (10KB)', async () => {
    const big = 'x'.repeat(10 * 1024)
    const blob = await encryptText(big, 'pw')
    const back = await decryptText(blob, 'pw')
    expect(back.length).toBe(big.length)
    expect(back).toBe(big)
  })

  it('handles unicode payload', async () => {
    const text = '你好，世界 🌏 — émoji & 特殊字符'
    const blob = await encryptText(text, 'pw')
    const back = await decryptText(blob, 'pw')
    expect(back).toBe(text)
  })

  it('two encrypts of the same plaintext produce different ciphertexts (random salt+iv)', async () => {
    const a = await encryptText('same', 'pw')
    const b = await encryptText('same', 'pw')
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
    expect(a.data).not.toBe(b.data)
  })
})

describe('parseBlob / stringifyBlob', () => {
  it('round-trips a real blob via JSON', async () => {
    const blob = await encryptText('hello', 'pw')
    const s = stringifyBlob(blob)
    // 单行 JSON：不允许换行
    expect(s.includes('\n')).toBe(false)
    const parsed = parseBlob(s)
    expect(parsed).toEqual(blob)
    // 解析后仍能成功解密
    expect(await decryptText(parsed, 'pw')).toBe('hello')
  })

  it('stringify then parse is structurally equivalent', () => {
    const blob = {
      magic: ENC_MAGIC,
      salt: 'YWJj',
      iv: 'ZGVm',
      iter: 200000,
      data: 'Z2hp',
    } as const
    const parsed = parseBlob(stringifyBlob(blob))
    expect(parsed).toEqual(blob)
  })

  it('rejects non-JSON', () => {
    expect(() => parseBlob('not json {')).toThrow('INVALID_BLOB')
  })

  it('rejects JSON with wrong magic', () => {
    const bad = JSON.stringify({
      magic: 'OTHER',
      salt: 'a',
      iv: 'b',
      iter: 1,
      data: 'c',
    })
    expect(() => parseBlob(bad)).toThrow('INVALID_BLOB')
  })

  it('rejects missing fields', () => {
    expect(() => parseBlob(JSON.stringify({ magic: ENC_MAGIC }))).toThrow('INVALID_BLOB')
    expect(() =>
      parseBlob(JSON.stringify({ magic: ENC_MAGIC, salt: 'a', iv: 'b', data: 'c' })),
    ).toThrow('INVALID_BLOB')
  })

  it('rejects non-positive iter', () => {
    const bad = JSON.stringify({
      magic: ENC_MAGIC,
      salt: 'a',
      iv: 'b',
      iter: 0,
      data: 'c',
    })
    expect(() => parseBlob(bad)).toThrow('INVALID_BLOB')
  })

  it('rejects null / array / primitive', () => {
    expect(() => parseBlob('null')).toThrow('INVALID_BLOB')
    expect(() => parseBlob('[]')).toThrow('INVALID_BLOB')
    expect(() => parseBlob('"a"')).toThrow('INVALID_BLOB')
  })
})
