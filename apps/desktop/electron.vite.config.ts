/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

// 工作区里的 @db-tool/* 是 TS 源码包，需打包进主进程产物而非作为外部依赖；
// better-sqlite3 等原生模块仍保持 external（运行时从 node_modules 加载）。
const workspacePkgs = ['@db-tool/core-driver', '@db-tool/shared-types']

const NLS_SHIM = resolve(__dirname, '../../packages/ui/src/vendor/monaco-nls-shim.ts')

/**
 * Monaco 国际化拦截：把 monaco-editor/esm/vs/nls.js 整体换成我们的 shim。
 *
 * 必须用 `resolveId` 自定义插件 +「绝对路径终态」匹配，*不能*只靠 resolve.alias：
 *   - resolve.alias 仅匹配 *import 语句里的 specifier 字符串*；
 *   - 而 monaco 内部源码用相对路径 `import '../nls.js'`，命中不了 `'monaco-editor/esm/vs/nls.js'` 这个 alias key。
 * 同时还要把 monaco-editor 从 optimizeDeps 排除：预打包过的 dep，内部相对引用在 esbuild
 * 阶段就解析掉了，运行时再加 Vite 插件也来不及。
 */
function monacoNlsShim(): Plugin {
  let hits = 0
  return {
    name: 'skylerx:monaco-nls-shim',
    enforce: 'pre',
    async resolveId(source, importer) {
      // 显式包路径
      if (source === 'monaco-editor/esm/vs/nls.js' || source === 'monaco-editor/esm/vs/nls') {
        hits++
        return NLS_SHIM
      }
      // monaco 自家文件 `import '../nls.js'` —— 解析成绝对路径再判断；
      // Vite 给路径加 ?v=hash cache-buster，所以末尾匹配要剥掉 query。
      if (importer && /[\\/]monaco-editor[\\/]/.test(importer) && /(^|[\\/])nls(\.js)?$/.test(source)) {
        const r = await this.resolve(source, importer, { skipSelf: true })
        if (!r?.id) return null
        const pathOnly = r.id.split('?')[0]
        if (/[\\/]monaco-editor[\\/]esm[\\/]vs[\\/]nls\.js$/.test(pathOnly)) {
          hits++
          if (hits <= 3) console.log(`[monacoNlsShim] redirected ${hits} → ${NLS_SHIM}`)
          return NLS_SHIM
        }
      }
      return null
    },
  }
}

export default defineConfig({
  main: {
    // pg-opengauss 被打进主进程(经 @db-tool/core-driver),它的 lib/native/client.js
    // 静态 require('pg-native')。pg-native 是可选原生依赖(未安装),且仅在使用 .native
    // 客户端时才加载——纯 JS 客户端运行时不会触及。标记为 external,避免 esbuild 静态
    // 解析失败导致主进程加载即崩。
    build: { rollupOptions: { external: ['pg-native'] } },
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    // monaco-editor 排除预打包：让所有 import 走 Vite 插件链，monacoNlsShim 才能截到内部相对引用
    // @db-tool/ui 是 TS/Vue 源码工作区包，也排除让 vue 插件按源码编译
    optimizeDeps: { exclude: ['@db-tool/ui', 'monaco-editor'] },
    plugins: [monacoNlsShim(), vue()],
  },
})
