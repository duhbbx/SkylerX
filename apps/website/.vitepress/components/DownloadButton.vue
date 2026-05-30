<script setup lang="ts">
/**
 * 智能下载按钮:
 *  - 自动识别浏览器平台 + 架构
 *  - 直链 GitHub Releases 最新版
 *  - 跳转到 /download 看完整下载矩阵
 *
 * i18n:用 useData().lang 拿当前 locale,所有外显文案都来自 ComponentLabels.download。
 * 同时根据 lang 给下载页 href 加上正确的 locale 前缀(/en/download 等)。
 */
import { computed, onMounted, ref } from 'vue'
import { useData } from 'vitepress'
import { type DownloadSource, detectSource } from './downloadSource'
import { getComponentLabels } from '../i18n'

const { lang } = useData()
const L = computed(() => getComponentLabels(lang.value))

/** zh-CN → '', en-US → '/en', etc. — 与 config.ts 的 locales 注册前缀对齐,
 *  这样英文页点按钮跳到 /en/download 而不是 / 下的中文下载页. */
const localePrefix = computed(() => {
  const m: Record<string, string> = {
    'zh-CN': '',
    'en-US': '/en',
    'es-ES': '/es',
    'fr-FR': '/fr',
    'ja-JP': '/ja',
    'ko-KR': '/ko',
    'pt-BR': '/pt',
  }
  return m[lang.value] ?? ''
})

interface Detected {
  /** 已经本地化好的展示 label, e.g. "macOS arm64" / "All platforms" */
  label: string
  platform: 'macos' | 'windows' | 'linux' | 'unknown'
  arch: 'arm64' | 'x64' | 'unknown'
}

const detected = ref<Detected>({ label: '', platform: 'unknown', arch: 'unknown' })
// 顶部 hero 按钮跳到 /download,目的是给用户看到 toggle + 区域提示;
// 这里只展示当前默认源(国内/海外),不影响实际跳转 URL
const source = ref<DownloadSource>('github')

function detect(): Detected {
  const pmap = L.value.download.platforms
  if (typeof navigator === 'undefined') {
    return { label: pmap.unknown, platform: 'unknown', arch: 'unknown' }
  }
  const ua = navigator.userAgent
  const platform = /Mac/i.test(ua)
    ? 'macos'
    : /Win/i.test(ua)
      ? 'windows'
      : /Linux/i.test(ua)
        ? 'linux'
        : 'unknown'
  // arm 优先(M 系 / Surface Pro X / Linux arm64)
  const ueData = (navigator as unknown as { userAgentData?: { architecture?: string } })
    .userAgentData
  const arch =
    ueData?.architecture === 'arm'
      ? 'arm64'
      : /arm|aarch/i.test(ua)
        ? 'arm64'
        : platform === 'macos'
          ? // M 系 Mac UA 仍写 Intel,这里近似:macOS 默认推 arm64,实在 Intel 用户去 /download 切
            'arm64'
          : 'x64'
  const labelMap: Record<string, string> = {
    macos: pmap.macos,
    windows: pmap.windows,
    linux: pmap.linux,
    unknown: pmap.unknown,
  }
  const labelBase = labelMap[platform]
  const label = platform === 'unknown' ? labelBase : `${labelBase} ${arch}`.trim()
  return { label, platform, arch }
}

onMounted(() => {
  detected.value = detect()
  source.value = detectSource()
})

const href = computed(() => {
  const p = detected.value.platform
  const base = `${localePrefix.value}/download`
  if (p === 'unknown') return base
  // 直跳下载页 + 锚点高亮对应平台;真正下载按钮在那里(从 GitHub Releases 拉具体文件名)
  return `${base}#${p}`
})

const ctaText = computed(() => {
  const p = detected.value.platform
  if (p === 'unknown') return L.value.download.seeAll
  return L.value.download.download(detected.value.label)
})

const regionTitle = computed(() =>
  source.value === 'oss' ? L.value.download.cnTip : L.value.download.intlTip,
)
const regionText = computed(() =>
  source.value === 'oss' ? L.value.download.cnMirror : L.value.download.githubSrc,
)
</script>

<template>
  <a class="dl-btn" :href="href">
    <span class="dl-icon">⬇</span>
    <span class="dl-text">{{ ctaText }}</span>
    <span class="dl-region" :title="regionTitle">
      {{ regionText }}
    </span>
  </a>
</template>

<style scoped>
.dl-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 22px;
  border-radius: 999px;
  background: linear-gradient(135deg, #7c6cff 0%, #5b4ae6 100%);
  color: #fff !important;
  font-weight: 600;
  font-size: 0.95rem;
  box-shadow: 0 4px 14px rgba(124, 108, 255, 0.35);
  transition: transform 0.15s, box-shadow 0.15s;
  text-decoration: none;
}
.dl-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(124, 108, 255, 0.45);
}
.dl-icon {
  font-size: 1.1rem;
}
.dl-region {
  font-size: 0.78rem;
  opacity: 0.85;
  font-weight: 400;
}
</style>
