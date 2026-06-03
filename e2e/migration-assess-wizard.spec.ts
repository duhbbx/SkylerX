/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'

/**
 * 场景:⌘K 命令面板 → 搜「信创迁移评估」→ 命中 → 选中打开向导 → 5 步指示器可见。
 * 纯 UI 流,不依赖任何连接(向导第 1 步即便没连接也会打开,展示源/目标下拉)。
 */
const MAIN = join(__dirname, '../apps/desktop/out/main/index.js')

test.setTimeout(60_000)

test('命令面板:信创迁移评估向导可打开', async () => {
  const app: ElectronApplication = await electron.launch({ args: [MAIN] })
  try {
    const win = await app.firstWindow()
    await expect(win.getByText('导航')).toBeVisible({ timeout: 20_000 })

    await win.keyboard.press('Meta+K')
    const input = win.getByPlaceholder('跳转连接 / 执行命令…')
    await expect(input).toBeVisible({ timeout: 5_000 })

    // 搜「信创」过滤到迁移评估命令
    await input.fill('信创')
    const item = win.locator('.cp-item').filter({ hasText: '信创迁移评估' }).first()
    await expect(item).toBeVisible({ timeout: 3_000 })

    // 选中打开向导
    await item.click()

    // 向导打开:5 步指示器里的「源库画像」步骤可见(向导独有)
    await expect(win.getByText('源库画像')).toBeVisible({ timeout: 5_000 })
    // 底部「下一步」按钮 = 向导面板已渲染
    await expect(win.getByRole('button', { name: '下一步' })).toBeVisible({ timeout: 5_000 })
  } finally {
    await app.close()
  }
})
