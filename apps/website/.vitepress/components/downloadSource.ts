/**
 * 下载源选择 (国内 OSS / 国外 GitHub).
 *
 * 策略:
 *  1. 用户在 localStorage 设过 'skylerx.dl.source' → 直接用 (手动覆盖最高优先级)
 *  2. 否则按浏览器时区猜:中国大陆 / 港澳几个时区 → 'oss'; 其余 → 'github'
 *  3. SSR 阶段(VitePress build)没有 navigator → 默认 'github' (build 出来 HTML 不预绑定)
 *
 * 真正的下载链接由 DownloadMatrix 调用 fetchLatest(source) 获得;两种 source 返回
 * 相同形状 { tag_name, assets: { name, url, size }[] } 给上层统一处理.
 */

const STORAGE_KEY = 'skylerx.dl.source'

export type DownloadSource = 'oss' | 'github'

/** 中国大陆 + 港澳台时区 (Taipei 也算,网络环境跟 mainland 相近, GitHub Releases CDN 也偶尔卡) */
const CN_TIMEZONES = new Set([
  'Asia/Shanghai',
  'Asia/Chongqing',
  'Asia/Chungking',
  'Asia/Urumqi',
  'Asia/Harbin',
  'Asia/Kashgar',
  'Asia/Hong_Kong',
  'Asia/Macau',
  'Asia/Macao',
  'Asia/Taipei',
])

export function detectSource(): DownloadSource {
  if (typeof window === 'undefined') return 'github' // SSR
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'oss' || saved === 'github') return saved
  } catch {
    /* localStorage 不可用 */
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (CN_TIMEZONES.has(tz)) return 'oss'
  } catch {
    /* Intl 不可用 */
  }
  return 'github'
}

export function saveSource(s: DownloadSource): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, s)
  } catch {
    /* localStorage 不可用 */
  }
}

export const OSS_BASE = 'https://skylerx-build.oss-cn-shanghai.aliyuncs.com'
export const OSS_LATEST = `${OSS_BASE}/releases/latest`
export const GH_OWNER = 'duhbbx'
export const GH_REPO = 'SkylerX'

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}
export interface ReleaseInfo {
  tag_name: string | null
  assets: ReleaseAsset[]
  source: DownloadSource
}

/**
 * 从 OSS 拉 latest index.json (CI 在 release-mirror-oss job 里生成的).
 * 失败抛错,调用方可 fallback 到 github.
 */
export async function fetchFromOss(): Promise<ReleaseInfo> {
  const r = await fetch(`${OSS_LATEST}/index.json`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`OSS index.json ${r.status}`)
  const data = (await r.json()) as { tag_name: string; assets: ReleaseAsset[] }
  return {
    tag_name: data.tag_name,
    // OSS index.json 的 url 已经是绝对路径,直接透传
    assets: data.assets,
    source: 'oss',
  }
}

export async function fetchFromGithub(): Promise<ReleaseInfo> {
  const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases/latest`)
  if (!r.ok) throw new Error(`GitHub API ${r.status}`)
  const data = (await r.json()) as {
    tag_name: string
    assets: { name: string; browser_download_url: string; size: number }[]
  }
  return {
    tag_name: data.tag_name,
    assets: (data.assets ?? []).map((a) => ({
      name: a.name,
      url: a.browser_download_url,
      size: a.size,
    })),
    source: 'github',
  }
}

/**
 * 按用户/区域选择的 source 取 release info.
 * 若主选源失败,自动回退另一个源 (国内 OSS 失败 → 试 github;反之亦然).
 */
export async function fetchLatest(preferred: DownloadSource): Promise<ReleaseInfo> {
  const primary = preferred === 'oss' ? fetchFromOss : fetchFromGithub
  const fallback = preferred === 'oss' ? fetchFromGithub : fetchFromOss
  try {
    return await primary()
  } catch {
    return await fallback()
  }
}
