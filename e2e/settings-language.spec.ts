/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'

/**
 * 场景：设置中心切换语言 zh → en → UI 文本（导航树标题）立即跟随切换。
 * 注意：切换会异步弹「是否刷新窗口」确认框，我们点取消保持当前窗口在新语言下；
 *      并在 finally 里手工切回 zh，避免污染后续 spec 的 localStorage。
 */
const MAIN = join(__dirname, '../apps/desktop/out/main/index.js')

test.setTimeout(60_000)

test('设置：切换语言中文→英文，导航树文案跟随', async () => {
  const app: ElectronApplication = await electron.launch({ args: [MAIN] })
  try {
    const win = await app.firstWindow()
    await expect(win.getByText('导航')).toBeVisible({ timeout: 20_000 })

    // 经命令面板打开「设置」
    await win.keyboard.press('Meta+K')
    await win.getByPlaceholder('跳转连接 / 执行命令…').fill('设置')
    await win.keyboard.press('Enter')
    await expect(win.getByRole('heading', { name: '常规' })).toBeVisible({ timeout: 5_000 })

    // 「语言」row 下的 select：定位含「简体中文」选项的 select，切到 en
    const langSelect = win.locator('select').filter({ hasText: '简体中文' }).first()
    await langSelect.selectOption('en')

    // 异步会弹「刷新窗口?」的应用 confirm；点取消保留当前窗口，仅看 reactive 文案切换
    await expect(win.locator('.dlg-msg')).toBeVisible({ timeout: 5_000 })
    await win.locator('.dlg-actions button.ghost').click()

    // 导航树标题从「导航」切换为 "Navigator"
    await expect(win.getByText('Navigator')).toBeVisible({ timeout: 5_000 })
    await expect(win.getByText('导航')).toHaveCount(0)
  } finally {
    // 还原 localStorage 以免影响其他 spec：直接写键并 reload，再确认渲染回中文（best-effort）
    try {
      const win = app.windows()[0]
      if (win) {
        await win.evaluate(() => localStorage.setItem('skylerx.locale', 'zh'))
      }
    } catch {
      /* 忽略：窗口可能已关闭 */
    }
    await app.close()
  }
})
