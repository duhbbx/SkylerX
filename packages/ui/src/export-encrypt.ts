/**
 * 导出加密（F2）：用密码把一段文本（通常是 SQL dump）加密成 `.sql.enc` 单行 JSON。
 *
 * 设计取舍：
 *  - 走 Web Crypto API（`crypto.subtle`），桌面 / Web 都能直接用，不引第三方依赖。
 *  - PBKDF2-HMAC-SHA-256 推导密钥（默认 200_000 轮），抗暴力破解。
 *  - AES-GCM 加密，128 bit auth tag 自带完整性校验：密码不对 / 文件被改都会在解密时抛错。
 *  - salt、iv 各 16 字节随机；每次加密都重新生成，不复用。
 *  - blob 用 base64 存，便于落盘成纯文本 / 在 JSON 里传输；序列化用单行 JSON，方便流式读写。
 *
 * 本模块**只**导出纯函数 API，不做 UI / 文件 IO，留给上层组件按需调用。
 */

/** 文件头魔数：日后升级算法/参数时方便识别版本。 */
export const ENC_MAGIC = 'SKYLERX-ENC-v1' as const

/** PBKDF2 默认迭代次数。OWASP 2023 推荐 SHA-256 ≥ 600_000，但桌面端要兼顾老机器，取折中。 */
export const DEFAULT_ITER = 200_000

const SALT_LEN = 16
const IV_LEN = 16

export interface EncryptedBlob {
  /** 文件头标识，方便识别 */
  magic: 'SKYLERX-ENC-v1'
  /** PBKDF2 salt (base64) */
  salt: string
  /** AES-GCM iv (base64) */
  iv: string
  /** PBKDF2 iteration count */
  iter: number
  /** 密文 + auth tag (base64) */
  data: string
}

/** 拿 Web Crypto 实例：浏览器 / Node 24+ 都直接挂在全局；测试环境若没有，用 node:crypto 兜底。 */
function getSubtle(): SubtleCrypto {
  const g = globalThis as unknown as { crypto?: Crypto }
  if (g.crypto?.subtle) return g.crypto.subtle
  // Node 兜底：在极旧版本 / 自定义环境里走 node:crypto.webcrypto。
  // 这里用动态 require 风格的 import 不可行（同步路径），直接抛错让调用方升级运行时。
  throw new Error('Web Crypto API unavailable: upgrade to Node 18+ or a modern browser')
}

// 注意：TS 5.7 + lib.dom 把 BufferSource 收紧到 `ArrayBuffer` 后端，
// 默认 `new Uint8Array(n)` 推断成 `Uint8Array<ArrayBufferLike>`，传给 subtle 会报错。
// 这里显式用 `new ArrayBuffer(n)` 兜底，让所有内部字节缓冲都是 `Uint8Array<ArrayBuffer>`。
function getRandomBytes(n: number): Uint8Array<ArrayBuffer> {
  const g = globalThis as unknown as { crypto?: Crypto }
  if (!g.crypto?.getRandomValues) {
    throw new Error('crypto.getRandomValues unavailable')
  }
  const buf = new Uint8Array(new ArrayBuffer(n))
  g.crypto.getRandomValues(buf)
  return buf
}

function encodeUtf8(s: string): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(s)
  // TextEncoder 返回的 Uint8Array 其 `buffer` 在 TS 类型上是 ArrayBufferLike；拷一份到 ArrayBuffer 上。
  const out = new Uint8Array(new ArrayBuffer(bytes.length))
  out.set(bytes)
  return out
}

// ── base64 编解码：浏览器原生 btoa/atob + Uint8Array 桥接 ──
// 注意 btoa 只吃 latin1，所以要逐字节塞 String.fromCharCode；不要直接 String() 一个 Uint8Array。

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  // 大数据时一次性 fromCharCode(...bytes) 会爆栈，分块处理。
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(s)
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(s.length))
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iter: number,
  subtle: SubtleCrypto,
): Promise<CryptoKey> {
  const baseKey = await subtle.importKey('raw', encodeUtf8(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** 用密码加密一段字符串；返回 JSON 可序列化的 blob 对象，也可调 stringify 后落盘。 */
export async function encryptText(plaintext: string, password: string): Promise<EncryptedBlob> {
  const subtle = getSubtle()
  const salt = getRandomBytes(SALT_LEN)
  const iv = getRandomBytes(IV_LEN)
  const iter = DEFAULT_ITER
  const key = await deriveKey(password, salt, iter, subtle)
  const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encodeUtf8(plaintext))
  return {
    magic: ENC_MAGIC,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    iter,
    data: bytesToBase64(new Uint8Array(cipher)),
  }
}

/** 把 EncryptedBlob 序列化为单行 JSON 字符串（默认 .sql.enc 文件格式）。 */
export function stringifyBlob(blob: EncryptedBlob): string {
  // 显式按固定字段顺序写出，避免不同实现的 JSON.stringify 顺序差异影响文件 diff。
  return JSON.stringify({
    magic: blob.magic,
    salt: blob.salt,
    iv: blob.iv,
    iter: blob.iter,
    data: blob.data,
  })
}

/** 解析单行 JSON 还原 EncryptedBlob；格式错误抛 'INVALID_BLOB'。 */
export function parseBlob(text: string): EncryptedBlob {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    throw new Error('INVALID_BLOB')
  }
  if (!obj || typeof obj !== 'object') throw new Error('INVALID_BLOB')
  const o = obj as Record<string, unknown>
  if (
    o.magic !== ENC_MAGIC ||
    typeof o.salt !== 'string' ||
    typeof o.iv !== 'string' ||
    typeof o.iter !== 'number' ||
    !Number.isFinite(o.iter) ||
    o.iter <= 0 ||
    typeof o.data !== 'string'
  ) {
    throw new Error('INVALID_BLOB')
  }
  return {
    magic: ENC_MAGIC,
    salt: o.salt,
    iv: o.iv,
    iter: o.iter,
    data: o.data,
  }
}

/** 用密码解密；密码错抛 'WRONG_PASSWORD'。 */
export async function decryptText(blob: EncryptedBlob, password: string): Promise<string> {
  const subtle = getSubtle()
  const salt = base64ToBytes(blob.salt)
  const iv = base64ToBytes(blob.iv)
  const data = base64ToBytes(blob.data)
  const key = await deriveKey(password, salt, blob.iter, subtle)
  let plain: ArrayBuffer
  try {
    // AES-GCM 解密时 auth tag 校验失败会抛 OperationError（不带详细信息）。
    // 密码错 / 数据被篡改都会走这条路；统一对外抛 WRONG_PASSWORD，避免泄露原始错误。
    plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  } catch {
    throw new Error('WRONG_PASSWORD')
  }
  return new TextDecoder().decode(plain)
}
