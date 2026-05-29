/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from '@playwright/test'

// Electron 冒烟测试（opt-in，不在主 CI 跑）：需先 `pnpm build:desktop` 且原生模块已按 ABI 重建。
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
})
