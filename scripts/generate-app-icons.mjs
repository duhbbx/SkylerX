#!/usr/bin/env node
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { makeIcns, makeIco } from './app-icon-lib.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const buildDir = path.join(root, 'apps/desktop/build')
const sourcePath = path.join(buildDir, 'icon-source.png')
const iconsDir = path.join(buildDir, 'icons')

const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icnsEntries = [
  { size: 16, type: 'icp4' },
  { size: 32, type: 'icp5' },
  { size: 64, type: 'icp6' },
  { size: 128, type: 'ic07' },
  { size: 256, type: 'ic08' },
  { size: 512, type: 'ic09' },
  { size: 1024, type: 'ic10' },
]

async function resizePng(input, size) {
  return sharp(input)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false,
    })
    .png()
    .toBuffer()
}

async function main() {
  const source = await readFile(sourcePath).catch((error) => {
    if (error?.code === 'ENOENT') {
      throw new Error(`Missing app icon source: ${path.relative(root, sourcePath)}`)
    }
    throw error
  })
  const metadata = await sharp(source).metadata()
  if (metadata.format !== 'png') {
    throw new Error(`App icon source must be PNG, got ${metadata.format ?? 'unknown'}`)
  }
  if (!metadata.width || !metadata.height || metadata.width !== metadata.height) {
    throw new Error(`App icon source must be square, got ${metadata.width ?? '?'}x${metadata.height ?? '?'}`)
  }
  if (metadata.width < 1024) {
    throw new Error(`App icon source must be at least 1024x1024, got ${metadata.width}x${metadata.height}`)
  }

  await mkdir(iconsDir, { recursive: true })

  const resized = new Map()
  for (const size of pngSizes) {
    const png = await resizePng(source, size)
    resized.set(size, png)
    await writeFile(path.join(iconsDir, `icon-${size}.png`), png)
  }

  await writeFile(path.join(buildDir, 'icon.png'), resized.get(512))
  await writeFile(
    path.join(buildDir, 'icon.ico'),
    makeIco(icoSizes.map((size) => ({ size, png: resized.get(size) }))),
  )
  await writeFile(
    path.join(buildDir, 'icon.icns'),
    makeIcns(icnsEntries.map((entry) => ({ type: entry.type, png: resized.get(entry.size) }))),
  )

  console.log('Generated desktop app icons from apps/desktop/build/icon-source.png')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
