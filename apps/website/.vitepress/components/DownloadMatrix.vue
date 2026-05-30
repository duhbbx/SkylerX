<script setup lang="ts">
/**
 * 完整下载矩阵:平台 × 架构 × 安装包格式.
 *
 * v2: 双下载源 (国内 OSS 镜像 / GitHub Releases).
 *  - 时区落在中国大陆 / 港澳 → 默认 OSS (skylerx-build, 上海)
 *  - 其余 → 默认 GitHub
 *  - 用户可顶部 toggle 切换,选择持久化到 localStorage
 *  - 任一源失败自动回退到另一源 (fetchLatest 内置)
 *
 * 渲染规则不变:平台 × 架构 × 格式 → 在 assets 中匹配文件名.
 *
 * i18n:rows 内部仍用一个 labelKey 指向 ComponentLabels.matrix.rowLabels,
 *       表头 / 提示 / 错误 / "下载" 链接全部走 L.matrix.*。format 字段做了 enum 化,
 *       让 .exe (安装版) / .exe (绿色版) 也能本地化。
 */
import { computed, onMounted, ref } from 'vue'
import { useData } from 'vitepress'
import {
  type DownloadSource,
  type ReleaseInfo,
  detectSource,
  fetchLatest,
  saveSource,
} from './downloadSource'
import { getComponentLabels, type MatrixRowKey } from '../i18n'

const { lang } = useData()
const L = computed(() => getComponentLabels(lang.value))

const source = ref<DownloadSource>('github')
const info = ref<ReleaseInfo | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

/** format 显示:'plain' 直接用 format 字段;其余 enum 走 L.matrix.formats[k]。 */
type FormatKind = 'plain' | 'exeSetup' | 'exePortable'

interface Row {
  platform: 'macos' | 'windows' | 'linux'
  arch: 'arm64' | 'x64'
  /** 默认展示文本(plain 模式直接用);如果 formatKind != 'plain' 会被翻译覆盖 */
  format: string
  formatKind: FormatKind
  match: (name: string) => boolean
  labelKey: MatrixRowKey
}

const rows: Row[] = [
  {
    platform: 'macos',
    arch: 'arm64',
    format: '.dmg',
    formatKind: 'plain',
    labelKey: 'macArm',
    match: (n) => /\.dmg$/i.test(n) && /arm64/i.test(n),
  },
  // Intel Mac 不再发独立包 — Apple Silicon 已 5 年, Intel 用户可走 Rosetta 跑 arm64 dmg
  {
    platform: 'windows',
    arch: 'x64',
    format: '.exe',
    formatKind: 'exeSetup',
    labelKey: 'winInstaller',
    match: (n) => /-setup\.exe$/i.test(n) && /(x64|x86_64|amd64)/i.test(n),
  },
  {
    platform: 'windows',
    arch: 'arm64',
    format: '.exe',
    formatKind: 'exeSetup',
    labelKey: 'winInstallerArm',
    match: (n) => /-setup\.exe$/i.test(n) && /arm64/i.test(n),
  },
  {
    platform: 'windows',
    arch: 'x64',
    format: '.exe',
    formatKind: 'exePortable',
    labelKey: 'winPortable',
    match: (n) => /-portable\.exe$/i.test(n) && /(x64|x86_64|amd64)/i.test(n),
  },
  {
    platform: 'windows',
    arch: 'arm64',
    format: '.exe',
    formatKind: 'exePortable',
    labelKey: 'winPortableArm',
    match: (n) => /-portable\.exe$/i.test(n) && /arm64/i.test(n),
  },
  {
    platform: 'linux',
    arch: 'x64',
    format: '.AppImage',
    formatKind: 'plain',
    labelKey: 'linuxAppimage',
    match: (n) => /\.AppImage$/i.test(n) && /(x64|x86_64|amd64)/i.test(n),
  },
  {
    platform: 'linux',
    arch: 'x64',
    format: '.deb',
    formatKind: 'plain',
    labelKey: 'linuxDeb',
    match: (n) => /\.deb$/i.test(n) && /(x64|x86_64|amd64)/i.test(n),
  },
  {
    platform: 'linux',
    arch: 'x64',
    format: '.rpm',
    formatKind: 'plain',
    labelKey: 'linuxRpm',
    match: (n) => /\.rpm$/i.test(n) && /(x64|x86_64|amd64)/i.test(n),
  },
  {
    platform: 'linux',
    arch: 'x64',
    format: '.pacman',
    formatKind: 'plain',
    labelKey: 'linuxPacman',
    match: (n) => /\.pacman$/i.test(n) && /(x64|x86_64|amd64)/i.test(n),
  },
  {
    platform: 'linux',
    arch: 'arm64',
    format: '.AppImage',
    formatKind: 'plain',
    labelKey: 'linuxAppimageArm',
    match: (n) => /\.AppImage$/i.test(n) && /arm64/i.test(n),
  },
  {
    platform: 'linux',
    arch: 'x64',
    format: '.tar.gz',
    formatKind: 'plain',
    labelKey: 'linuxTarGz',
    match: (n) => /\.tar\.gz$/i.test(n) && /(x64|x86_64|amd64)/i.test(n),
  },
]

const releasesPage = computed(() =>
  source.value === 'oss'
    ? 'https://skylerx-build.oss-cn-shanghai.aliyuncs.com/releases/'
    : 'https://github.com/duhbbx/SkylerX/releases',
)
const latestPage = computed(() =>
  source.value === 'oss'
    ? 'https://skylerx-build.oss-cn-shanghai.aliyuncs.com/releases/latest/'
    : 'https://github.com/duhbbx/SkylerX/releases/latest',
)

function findAsset(row: Row) {
  return info.value?.assets.find((a) => row.match(a.name))
}

function bytes(n: number): string {
  if (n < 1e6) return `${(n / 1e3).toFixed(0)} KB`
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} MB`
  return `${(n / 1e9).toFixed(2)} GB`
}

/** 当前 row 的 format 列显示文本(可能被 i18n 覆盖,可能是 plain 文件后缀) */
function formatText(r: Row): string {
  if (r.formatKind === 'exeSetup') return L.value.matrix.formats.exeSetup
  if (r.formatKind === 'exePortable') return L.value.matrix.formats.exePortable
  return r.format
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    info.value = await fetchLatest(source.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function switchSource(s: DownloadSource): Promise<void> {
  if (s === source.value) return
  source.value = s
  saveSource(s)
  await load()
}

onMounted(async () => {
  source.value = detectSource()
  await load()
})

const platformIcon: Record<string, string> = { macos: '', windows: '⊞', linux: '🐧' }
const platformLabel = computed<Record<string, string>>(() => ({
  macos: L.value.download.platforms.macos,
  windows: L.value.download.platforms.windows,
  linux: L.value.download.platforms.linux,
}))
/** 第一次出现该 platform 的行返回 true,用来在表格里插一行分组标题(带 anchor id) */
function isFirstOfPlatform(i: number): boolean {
  return i === 0 || rows[i - 1].platform !== rows[i].platform
}

/** 给 Umami 上报下载点击,看哪个平台/源/版本最受欢迎。失败静默(没装 Umami 也不影响下载)。 */
function trackDownload(row: Row): void {
  const w = window as unknown as { umami?: { track: (n: string, p?: Record<string, unknown>) => void } }
  try {
    w.umami?.track('download', {
      platform: row.platform,
      arch: row.arch,
      format: row.format,
      source: source.value,
      version: info.value?.tag_name ?? 'unknown',
    })
  } catch {
    /* ignore */
  }
}

const errorText = computed(() => {
  if (!error.value) return ''
  const src = source.value === 'oss' ? L.value.matrix.ossLabel : 'GitHub API'
  return L.value.matrix.errorTpl(src, error.value, latestPage.value)
})
</script>

<template>
  <div class="dl-mx">
    <!-- 顶部:版本 / 切换源 -->
    <div class="dl-mx-header">
      <div class="dl-mx-ver">
        <span v-if="loading">{{ L.matrix.loading }}</span>
        <span v-else-if="info?.tag_name">
          {{ L.matrix.latestVersion }}
          <a :href="latestPage" target="_blank" rel="noopener">{{ info.tag_name }}</a>
        </span>
        <span v-else>
          {{ L.matrix.fallbackPrefix }}<a :href="latestPage" target="_blank" rel="noopener">{{ source === 'oss' ? L.matrix.ossLabel : L.matrix.githubLabel }}</a>{{ L.matrix.fallbackSuffix }}
        </span>
      </div>

      <div class="dl-mx-actions">
        <div class="dl-mx-toggle" role="tablist">
          <button
            type="button"
            :class="{ on: source === 'oss' }"
            :aria-selected="source === 'oss'"
            :title="L.matrix.cnMirrorTitle"
            @click="switchSource('oss')"
          >
            {{ L.matrix.cnMirrorBtn }}
          </button>
          <button
            type="button"
            :class="{ on: source === 'github' }"
            :aria-selected="source === 'github'"
            :title="L.matrix.githubBtnTitle"
            @click="switchSource('github')"
          >
            {{ L.matrix.githubBtn }}
          </button>
        </div>
        <a class="dl-mx-history" :href="releasesPage" target="_blank" rel="noopener">{{ L.matrix.history }}</a>
      </div>
    </div>

    <div v-if="error" class="dl-mx-err">
      {{ errorText }}
    </div>

    <table class="dl-mx-table">
      <thead>
        <tr>
          <th>{{ L.matrix.th.platform }}</th>
          <th>{{ L.matrix.th.arch }}</th>
          <th>{{ L.matrix.th.format }}</th>
          <th>{{ L.matrix.th.desc }}</th>
          <th>{{ L.matrix.th.download }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(r, i) in rows" :key="i">
          <!-- platform 切换时插一行带 id 的分组标题,
               让 hero 上 "下载(Windows arm64)" 点击后能精确滚到对应分组(#windows/#macos/#linux) -->
          <tr v-if="isFirstOfPlatform(i)" :id="r.platform" class="dl-mx-group">
            <td colspan="5">
              <h3 class="dl-mx-grp-title">
                {{ platformIcon[r.platform] }} {{ platformLabel[r.platform] }}
              </h3>
            </td>
          </tr>
          <tr :id="`${r.platform}-${r.arch}-${r.format.replace(/[.\s()]/g, '')}`">
            <td>{{ platformIcon[r.platform] }} {{ r.platform }}</td>
            <td>{{ r.arch }}</td>
            <td><code>{{ formatText(r) }}</code></td>
            <td>{{ L.matrix.rowLabels[r.labelKey] }}</td>
            <td>
              <template v-if="findAsset(r)">
                <a class="dl-mx-link" :href="findAsset(r)!.url" target="_blank" rel="noopener" @click="trackDownload(r)">
                  {{ L.matrix.downloadLink }} <span class="dl-mx-size">({{ bytes(findAsset(r)!.size) }})</span>
                </a>
              </template>
              <span v-else class="dl-mx-na">—</span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <p class="dl-mx-tip">
      {{ source === 'oss' ? L.matrix.tipOss : L.matrix.tipGithub }}
    </p>
  </div>
</template>

<style scoped>
.dl-mx { margin: 1.6rem 0; }
.dl-mx-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.8rem;
  font-size: 0.92rem;
  gap: 12px;
  flex-wrap: wrap;
}
.dl-mx-ver { color: var(--vp-c-text-2); }
.dl-mx-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}
.dl-mx-toggle {
  display: inline-flex;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  padding: 3px;
  background: var(--vp-c-bg-soft);
}
.dl-mx-toggle button {
  border: 0;
  background: transparent;
  padding: 5px 14px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  transition: background 0.15s, color 0.15s;
  font-family: inherit;
}
.dl-mx-toggle button.on {
  background: var(--vp-c-brand-1);
  color: #fff;
  font-weight: 600;
}
.dl-mx-toggle button:not(.on):hover {
  color: var(--vp-c-text-1);
}
.dl-mx-history {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  font-size: 0.88rem;
}
.dl-mx-err {
  padding: 12px 14px;
  border: 1px solid #f0c0c0;
  background: rgba(255, 99, 99, 0.06);
  border-radius: 8px;
  color: #cc4444;
  margin-bottom: 1rem;
  font-size: 0.9rem;
}
.dl-mx-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.92rem;
}
.dl-mx-table th, .dl-mx-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--vp-c-divider);
  text-align: left;
}
/* platform 分组标题行 — anchor 锚点 + 视觉分组 */
.dl-mx-group td {
  background: var(--vp-c-bg-soft);
  padding: 14px 12px 8px;
  border-bottom: 1px solid var(--vp-c-divider);
  /* anchor scroll-margin 让 #windows 跳转时上方留点空间(顶部 nav 不会遮)*/
  scroll-margin-top: 80px;
}
.dl-mx-grp-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
}
.dl-mx-table th {
  background: var(--vp-c-bg-soft);
  font-weight: 600;
}
.dl-mx-link {
  color: var(--vp-c-brand-1);
  font-weight: 600;
  text-decoration: none;
}
.dl-mx-link:hover { text-decoration: underline; }
.dl-mx-size { color: var(--vp-c-text-3); font-weight: 400; font-size: 0.82rem; }
.dl-mx-na { color: var(--vp-c-text-3); }
.dl-mx-tip {
  margin-top: 1rem;
  font-size: 0.85rem;
  color: var(--vp-c-text-3);
  padding: 10px 14px;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
}
</style>
