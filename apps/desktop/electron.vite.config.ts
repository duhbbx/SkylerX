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
      },
    },
    plugins: [vue()],
  },
})
