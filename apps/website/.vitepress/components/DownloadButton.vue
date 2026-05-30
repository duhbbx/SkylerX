<script setup lang="ts">
/**
 * 智能下载按钮:
 *  - 自动识别浏览器平台 + 架构
 *  - 直链 GitHub Releases 最新版
 *  - 跳转到 /download 看完整下载矩阵
 */
import { computed, onMounted, ref } from 'vue'
import { type DownloadSource, detectSource } from './downloadSource'

interface Detected {
  label: string
  platform: 'macos' | 'windows' | 'linux' | 'unknown'
  arch: 'arm64' | 'x64' | 'unknown'
}

const detected = ref<Detected>({ label: '当前平台', platform: 'unknown', arch: 'unknown' })
// 顶部 hero 按钮跳到 /download,目的是给用户看到 toggle + 区域提示;
// 这里只展示当前默认源(国内/海外),不影响实际跳转 URL
const source = ref<DownloadSource>('github')

function detect(): Detected {
  if (typeof navigator === 'undefined') {
    return { label: '查看所有版本', platform: 'unknown', arch: 'unknown' }
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
    macos: 'macOS',
    windows: 'Windows',
    linux: 'Linux',
    unknown: '所有平台',
  }
  return { label: `${labelMap[platform]} ${arch}`.trim(), platform, arch }
}

onMounted(() => {
  detected.value = detect()
  source.value = detectSource()
})

const href = computed(() => {
  const p = detected.value.platform
  if (p === 'unknown') return '/download'
  // 直跳下载页 + 锚点高亮对应平台;真正下载按钮在那里(从 GitHub Releases 拉具体文件名)
  return `/download#${p}`
})

const ctaText = computed(() => {
  const p = detected.value.platform
  if (p === 'unknown') return '查看所有下载'
  return `下载(${detected.value.label})`
})
</script>

<template>
  <a class="dl-btn" :href="href">
    <span class="dl-icon">⬇</span>
    <span class="dl-text">{{ ctaText }}</span>
    <span class="dl-region" :title="source === 'oss' ? '中国大陆默认走阿里云 OSS 镜像,下载页可手动切到 GitHub' : '海外默认走 GitHub Releases,下载页可手动切到 OSS 镜像'">
      {{ source === 'oss' ? '· 🇨🇳 镜像' : '· 🌐 GitHub' }}
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
