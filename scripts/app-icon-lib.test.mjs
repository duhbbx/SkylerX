/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { makeIcns, makeIco } from './app-icon-lib.mjs'

const tinyPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

describe('app icon container writers', () => {
  it('writes a Windows ICO container with PNG entries', () => {
    const ico = makeIco([
      { size: 16, png: tinyPng },
      { size: 256, png: tinyPng },
    ])

    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(2)
    expect(ico[6]).toBe(16)
    expect(ico[22]).toBe(0)
    expect(ico.readUInt32LE(14)).toBe(tinyPng.length)
    expect(ico.readUInt32LE(18)).toBe(6 + 16 * 2)
    expect(ico.subarray(38, 46)).toEqual(tinyPng.subarray(0, 8))
  })

  it('writes a macOS ICNS container with PNG icon chunks', () => {
    const icns = makeIcns([
      { type: 'ic07', png: tinyPng },
      { type: 'ic10', png: tinyPng },
    ])

    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(icns.readUInt32BE(4)).toBe(icns.length)
    expect(icns.subarray(8, 12).toString('ascii')).toBe('ic07')
    expect(icns.readUInt32BE(12)).toBe(8 + tinyPng.length)
    expect(icns.subarray(16, 24)).toEqual(tinyPng.subarray(0, 8))
  })
})
