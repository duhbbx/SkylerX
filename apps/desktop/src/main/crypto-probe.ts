/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { getCiphers } from 'node:crypto'

/**
 * Boot-time crypto self-check.
 *
 * 为什么需要这个: SkylerX 桌面端跑在 Electron 里, Electron 链接的是 **BoringSSL**
 * (不是 Node 默认的 OpenSSL). BoringSSL 砍掉了一些老算法, 比如 dmdb 默认协商的
 * `DES-CFB`, 导致 DM 连接报 "Unknown cipher". 而 Vitest 单元测试跑在普通 Node
 * 上面 (OpenSSL 3.x + legacy provider 可用), 老算法都有, 测试过的代码到生产
 * 仍然可能挂.
 *
 * 这个探测在主进程启动时打印 crypto runtime 信息, 让下一次"crypto 相关 bug"
 * 第一眼就能在日志里看到底层用的是哪个 SSL + 缺哪些 cipher, 不用再走我们 2026-06-01
 * 那一通诊断流程.
 *
 * 详见 docs/qa/databases/dm.md 的 "Major upstream limitation" 章节.
 */

/** dmdb / 老 DB 驱动可能用到, 但 BoringSSL 已经砍掉的 cipher. 探测它们是否缺失. */
const KNOWN_PROBLEM_CIPHERS = [
  'des-cfb', // dmdb 默认协商 — DM 连接的元凶
  'rc2-cfb',
  'cast5-cbc',
  'cast5-cfb',
  'seed-cbc',
  'idea-cbc',
]

export interface CryptoProbe {
  /** 'BoringSSL' (Electron) 或 'OpenSSL X.Y.Z' (普通 Node). */
  library: string
  /** 可用 cipher 总数. BoringSSL ≈ 28, OpenSSL 3 default ≈ 130, +legacy ≈ 174. */
  cipherCount: number
  /** 那些已知 driver 想要但运行时没有的 cipher. 非空 → 部分 driver 会挂. */
  missingProblemCiphers: string[]
}

/** 跑一遍探测, 返回数据 (不打印). */
export function probeCrypto(): CryptoProbe {
  const v = process.versions.openssl
  // BoringSSL 在 Node patch 里把 openssl 版本写成 '0.0.0'. OpenSSL 真实版本形如 '3.6.2'.
  const library = v === '0.0.0' ? 'BoringSSL (via Chromium)' : `OpenSSL ${v}`
  const available = new Set(getCiphers())
  return {
    library,
    cipherCount: available.size,
    missingProblemCiphers: KNOWN_PROBLEM_CIPHERS.filter((c) => !available.has(c)),
  }
}

/** 启动时调一次, 把结果写到 console (Electron dev tools / 系统日志都能看到). */
export function logCryptoProbe(): void {
  const p = probeCrypto()
  console.info(
    `[crypto] library=${p.library} ciphers=${p.cipherCount}` +
      (p.missingProblemCiphers.length > 0
        ? ` | missing problem ciphers: ${p.missingProblemCiphers.join(', ')}`
        : ''),
  )
  if (p.missingProblemCiphers.includes('des-cfb')) {
    console.info(
      '[crypto] note: des-cfb missing → DM driver uses ?loginEncrypt=0 workaround. ' +
        'See docs/qa/databases/dm.md for details.',
    )
  }
}
