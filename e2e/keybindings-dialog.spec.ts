/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'

/**
 * 场景：⌘K → 输入「快捷键」→ 命中「自定义快捷键」→ KeyBindingsDialog 打开（标题 = 键盘快捷键）。
 */
const MAIN = join(__dirname, '../apps/desktop/out/main/index.js')

test.setTimeout(60_000)

test('命令面板 → 自定义快捷键：打开键绑定对话框', async () => {
  const app: ElectronApplication = await electron.launch({ args: [MAIN] })
  try {
    const win = await app.firstWindow()
    await expect(win.getByText('导航')).toBeVisible({ timeout: 20_000 })

    await win.keyboard.press('Meta+K')
    const input = win.getByPlaceholder('跳转连接 / 执行命令…')
    await expect(input).toBeVisible({ timeout: 5_000 })
    await input.fill('自定义快捷键')

    // 命中条目可见 → Enter 选中
    await expect(
      win.locator('.cp-item').filter({ hasText: '自定义快捷键' }).first(),
    ).toBeVisible({ timeout: 3_000 })
    await win.keyboard.press('Enter')

    // 键绑定对话框：Modal 标题「键盘快捷键」+ 表头「命令」「快捷键」
    await expect(win.getByText('键盘快捷键', { exact: true })).toBeVisible({ timeout: 5_000 })
    await expect(win.getByRole('columnheader', { name: '命令' })).toBeVisible()
    await expect(win.getByRole('columnheader', { name: '快捷键' })).toBeVisible()
  } finally {
    await app.close()
  }
})
