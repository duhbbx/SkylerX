/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */

function iconByteSize(size) {
  return size >= 256 ? 0 : size
}

export function makeIco(entries) {
  if (!entries.length) throw new Error('ICO requires at least one PNG entry')

  const headerSize = 6
  const directorySize = 16 * entries.length
  const dataOffset = headerSize + directorySize
  const totalSize = dataOffset + entries.reduce((sum, entry) => sum + entry.png.length, 0)
  const out = Buffer.alloc(totalSize)

  out.writeUInt16LE(0, 0)
  out.writeUInt16LE(1, 2)
  out.writeUInt16LE(entries.length, 4)

  let offset = dataOffset
  entries.forEach((entry, index) => {
    const pos = headerSize + index * 16
    out[pos] = iconByteSize(entry.size)
    out[pos + 1] = iconByteSize(entry.size)
    out[pos + 2] = 0
    out[pos + 3] = 0
    out.writeUInt16LE(1, pos + 4)
    out.writeUInt16LE(32, pos + 6)
    out.writeUInt32LE(entry.png.length, pos + 8)
    out.writeUInt32LE(offset, pos + 12)
    entry.png.copy(out, offset)
    offset += entry.png.length
  })

  return out
}

export function makeIcns(entries) {
  if (!entries.length) throw new Error('ICNS requires at least one PNG entry')

  const totalSize = 8 + entries.reduce((sum, entry) => sum + 8 + entry.png.length, 0)
  const out = Buffer.alloc(totalSize)
  out.write('icns', 0, 'ascii')
  out.writeUInt32BE(totalSize, 4)

  let offset = 8
  for (const entry of entries) {
    if (!/^[a-z0-9]{4}$/.test(entry.type)) {
      throw new Error(`Invalid ICNS chunk type: ${entry.type}`)
    }
    const chunkSize = 8 + entry.png.length
    out.write(entry.type, offset, 'ascii')
    out.writeUInt32BE(chunkSize, offset + 4)
    entry.png.copy(out, offset + 8)
    offset += chunkSize
  }

  return out
}
