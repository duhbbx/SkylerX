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
 */
import { computed, onMounted, ref } from 'vue'
import {
  type DownloadSource,
  type ReleaseInfo,
  detectSource,
  fetchLatest,
  saveSource,
} from './downloadSource'

const source = ref<DownloadSource>('github')
const info = ref<ReleaseInfo | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

interface Row {
  platform: 'macos' | 'windows' | 'linux'
  arch: 'arm64' | 'x64'
  format: string
  match: (name: string) => boolean
  label: string
}

const rows: Row[] = [
  {
    platform: 'macos',
    arch: 'arm64',
    format: '.dmg',
    label: 'macOS Apple Silicon',
    match: (n) => /\.dmg$/i.test(n) && /arm64/i.test(n),
  },
  {
    platform: 'macos',
    arch: 'x64',
    format: '.dmg',
    label: 'macOS Intel',
    match: (n) => /\.dmg$/i.test(n) && /(x64|x86_64|amd64)/i.test(n),
  },
  {
    platform: 'windows',
    arch: 'x64',
    format: '.exe (安装版)',
    label: 'Windows 64-bit Installer',
    match: (n) => /-setup\.exe$/i.test(n) && /(x64|x86_64|amd64)/i.test(n),
  },
  {
    platform: 'windows',
    arch: 'arm64',
    format: '.exe (安装版)',
    label: 'Windows ARM64 Installer',
    match: (n) => /-setup\.exe$/i.test(n) && /arm64/i.test(n),
  },
  {
    platform: 'windows',
    arch: 'x64',
    format: '.exe (绿色版)',
    label: 'Windows 64-bit 免安装',
    match: (n) => /-portable\.exe$/i.test(n) && /(x64|x86_64|amd64)/i.test(n),
  },
  {
    platform: 'windows',
    arch: 'arm64',
    format: '.exe (绿色版)',
    label: 'Windows ARM64 免安装',
    match: (n) => /-portable\.exe$/i.test(n) && /arm64/i.test(n),
  },
  {
    platform: 'linux',
    arch: 'x64',
    format: '.AppImage',
    label: 'Linux x64',
    match: (n) => /\.AppImage$/i.test(n) && /(x64|x86_64|amd64)/i.test(n),
  },
  {
    platform: 'linux',
    arch: 'x64',
    format: '.deb',
    label: 'Debian / Ubuntu / 麒麟 / UOS',
    match: (n) => /\.deb$/i.test(n) && /(x64|x86_64|amd64)/i.test(n),
  },
  {
    platform: 'linux',
    arch: 'x64',
    format: '.rpm',
    label: 'Fedora / openEuler / 中标麒麟',
    match: (n) => /\.rpm$/i.test(n) && /(x64|x86_64|amd64)/i.test(n),
  },
  {
    platform: 'linux',
    arch: 'arm64',
    format: '.AppImage',
    label: 'Linux ARM64',
    match: (n) => /\.AppImage$/i.test(n) && /arm64/i.test(n),
  },
  {
    platform: 'linux',
    arch: 'x64',
    format: '.tar.gz',
    label: 'Linux x64 (tar.gz)',
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
</script>

<template>
  <div class="dl-mx">
    <!-- 顶部:版本 / 切换源 -->
    <div class="dl-mx-header">
      <div class="dl-mx-ver">
        <span v-if="loading">加载中…</span>
        <span v-else-if="info?.tag_name">
          最新版本:
          <a :href="latestPage" target="_blank" rel="noopener">{{ info.tag_name }}</a>
        </span>
        <span v-else>从 <a :href="latestPage" target="_blank" rel="noopener">{{ source === 'oss' ? 'OSS 镜像' : 'GitHub Releases' }}</a> 直接下载</span>
      </div>

      <div class="dl-mx-actions">
        <div class="dl-mx-toggle" role="tablist">
          <button
            type="button"
            :class="{ on: source === 'oss' }"
            :aria-selected="source === 'oss'"
            title="国内镜像:阿里云 OSS (上海),适合中国大陆下载"
            @click="switchSource('oss')"
          >
            🇨🇳 国内镜像
          </button>
          <button
            type="button"
            :class="{ on: source === 'github' }"
            :aria-selected="source === 'github'"
            title="海外源:GitHub Releases,适合海外用户"
            @click="switchSource('github')"
          >
            🌐 GitHub
          </button>
        </div>
        <a class="dl-mx-history" :href="releasesPage" target="_blank" rel="noopener">历史版本 →</a>
      </div>
    </div>

    <div v-if="error" class="dl-mx-err">
      {{ source === 'oss' ? 'OSS 镜像' : 'GitHub API' }} 不可达({{ error }}),已尝试自动切换备用源。仍失败可点上方按钮手动切换,或前往 <a :href="latestPage" target="_blank" rel="noopener">{{ latestPage }}</a> 手动选择。
    </div>

    <table class="dl-mx-table">
      <thead>
        <tr>
          <th>平台</th>
          <th>架构</th>
          <th>格式</th>
          <th>说明</th>
          <th>下载</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in rows" :id="`${r.platform}-${r.arch}-${r.format.replace(/[.\s()]/g, '')}`" :key="i">
          <td>{{ platformIcon[r.platform] }} {{ r.platform }}</td>
          <td>{{ r.arch }}</td>
          <td><code>{{ r.format }}</code></td>
          <td>{{ r.label }}</td>
          <td>
            <template v-if="findAsset(r)">
              <a class="dl-mx-link" :href="findAsset(r)!.url" target="_blank" rel="noopener">
                下载 <span class="dl-mx-size">({{ bytes(findAsset(r)!.size) }})</span>
              </a>
            </template>
            <span v-else class="dl-mx-na">—</span>
          </td>
        </tr>
      </tbody>
    </table>

    <p class="dl-mx-tip">
      <template v-if="source === 'oss'">
        💡 当前是<strong>国内镜像</strong>(阿里云 OSS · 华东 2 上海)。如果国内访问也慢,切到 GitHub 试试;海外用户建议直接选 GitHub。
      </template>
      <template v-else>
        💡 当前是 <strong>GitHub Releases</strong>。中国大陆用户访问慢时,点上方"🇨🇳 国内镜像" 切换到阿里云 OSS;或用 <code>https://github.akams.cn/</code> 等加速镜像替换 URL 前缀。
      </template>
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
