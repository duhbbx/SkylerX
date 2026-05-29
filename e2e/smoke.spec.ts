/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

/**
 * 冒烟：启动已构建的桌面端，验证窗口标题与导航壳渲染。
 * 前置：`pnpm build:desktop` + `pnpm --filter @db-tool/desktop rebuild:native`。
 * 本地运行：`pnpm e2e`。不连真实数据库，仅验证应用能起、UI 能渲染。
 */
const MAIN = join(__dirname, '../apps/desktop/out/main/index.js')

test('应用启动并渲染导航壳', async () => {
  const app = await electron.launch({ args: [MAIN] })
  try {
    const win = await app.firstWindow()
    await expect(win).toHaveTitle(/SkylerX/)
    // 导航树标题（i18n 默认中文）
    await expect(win.getByText('导航')).toBeVisible({ timeout: 20_000 })
    // ⌘K 命令面板可打开
    await win.keyboard.press('Meta+K')
    await expect(win.getByText('全局对象搜索（表/视图/列）')).toBeVisible({ timeout: 5_000 })
  } finally {
    await app.close()
  }
})
