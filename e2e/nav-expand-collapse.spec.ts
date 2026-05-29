/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'

/**
 * 场景：导航树顶部「展开全部 ⊞」「收起全部 ⊟」按钮存在且可点；点击后不抛错（顶层无连接时为 noop）。
 * 主要保证按钮被正确渲染并绑定 click，不验证递归展开行为（那需要先建连接 + metadata 加载）。
 */
const MAIN = join(__dirname, '../apps/desktop/out/main/index.js')

test.setTimeout(60_000)

test('导航树：展开全部 / 收起全部 按钮可点击', async () => {
  const app: ElectronApplication = await electron.launch({ args: [MAIN] })
  try {
    const win = await app.firstWindow()
    await expect(win.getByText('导航')).toBeVisible({ timeout: 20_000 })

    // title 唯一锁定到这两枚按钮
    const expand = win.locator('button[title="展开全部"]')
    const collapse = win.locator('button[title="收起全部"]')

    await expect(expand).toBeVisible()
    await expect(collapse).toBeVisible()

    // 点击不应抛异常 / 导致页面崩溃；点完导航树标题依旧在 = 应用未崩
    await expand.click()
    await collapse.click()
    await expect(win.getByText('导航')).toBeVisible()
  } finally {
    await app.close()
  }
})
