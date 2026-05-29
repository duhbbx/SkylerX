/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'

/**
 * 场景：⌘K → 输入「设置」→ Enter → SettingsDialog 打开（Modal 标题 = 设置，左侧分类「常规」可见）。
 * 验证命令面板与设置中心的端到端打通；纯 UI，不依赖任何连接。
 */
const MAIN = join(__dirname, '../apps/desktop/out/main/index.js')

test.setTimeout(60_000)

test('命令面板 → 设置：打开设置中心', async () => {
  const app: ElectronApplication = await electron.launch({ args: [MAIN] })
  try {
    const win = await app.firstWindow()
    await expect(win.getByText('导航')).toBeVisible({ timeout: 20_000 })

    await win.keyboard.press('Meta+K')
    const input = win.getByPlaceholder('跳转连接 / 执行命令…')
    await expect(input).toBeVisible({ timeout: 5_000 })
    await input.fill('设置')
    // 选中过滤后的第一条 = 「设置」动作
    await win.keyboard.press('Enter')

    // SettingsDialog 打开后，左侧分类列表与「常规」段都应渲染
    await expect(win.getByRole('heading', { name: '常规' })).toBeVisible({ timeout: 5_000 })
    await expect(win.getByText('语言', { exact: true })).toBeVisible()
  } finally {
    await app.close()
  }
})
