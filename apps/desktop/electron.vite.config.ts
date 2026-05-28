import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// 工作区里的 @db-tool/* 是 TS 源码包，需打包进主进程产物而非作为外部依赖；
// better-sqlite3 等原生模块仍保持 external（运行时从 node_modules 加载）。
const workspacePkgs = ['@db-tool/core-driver', '@db-tool/shared-types']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        // 用我们自己的 shim 替代 monaco-editor 内部的 nls.js：
        // 让 Monaco 所有内部 `import { localize } from '../nls.js'` 都走我们的实现，
        // 这样 Cut/Copy/Paste/Find/Open Command Palette 等内置菜单也能用中文 fallback 字典。
        // 注意：monaco 内部 import 路径多以 .js 结尾；两条 alias 都加保证命中。
        'monaco-editor/esm/vs/nls.js': resolve('../../packages/ui/src/vendor/monaco-nls-shim.ts'),
        'monaco-editor/esm/vs/nls': resolve('../../packages/ui/src/vendor/monaco-nls-shim.ts'),
      },
    },
    // @db-tool/ui 是 TS/Vue 源码工作区包，排除预打包让 vue 插件按源码编译它
    optimizeDeps: { exclude: ['@db-tool/ui'] },
    plugins: [vue()],
  },
})
