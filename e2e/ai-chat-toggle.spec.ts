/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'

/**
 * 场景：⌘⇧L 切换右侧 AI 聊天侧边栏；面板标题 "AI 聊天" 出现 / 消失。
 * 测完手动再 ⌘⇧L 关回去，避免下个 spec 视口被遮挡。
 */
const MAIN = join(__dirname, '../apps/desktop/out/main/index.js')

test.setTimeout(60_000)

test('AI 聊天侧边栏：⌘⇧L 切换可见性', async () => {
  const app: ElectronApplication = await electron.launch({ args: [MAIN] })
  try {
    const win = await app.firstWindow()
    await expect(win.getByText('导航')).toBeVisible({ timeout: 20_000 })

    const title = win.getByText('AI 聊天', { exact: true })
    const initiallyVisible = await title.isVisible().catch(() => false)

    // 切到「打开」态：若初始已开，先关一次再开（确保「打开」是本次按键的结果）
    if (initiallyVisible) {
      await win.keyboard.press('Meta+Shift+L')
      await expect(title).toBeHidden({ timeout: 3_000 })
    }
    await win.keyboard.press('Meta+Shift+L')
    await expect(title).toBeVisible({ timeout: 3_000 })

    // 再按一次 → 关闭
    await win.keyboard.press('Meta+Shift+L')
    await expect(title).toBeHidden({ timeout: 3_000 })
  } finally {
    await app.close()
  }
})
