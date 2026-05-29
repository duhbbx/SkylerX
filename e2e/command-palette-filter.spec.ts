/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'

/**
 * 场景：⌘K 命令面板打开 → 输入「设置」过滤 → 命中条目可见且其他不相关条目（如对象搜索）已被过滤掉。
 * 不依赖任何连接，纯 UI 流。
 */
const MAIN = join(__dirname, '../apps/desktop/out/main/index.js')

test.setTimeout(60_000)

test('命令面板：搜索「设置」过滤命中', async () => {
  const app: ElectronApplication = await electron.launch({ args: [MAIN] })
  try {
    const win = await app.firstWindow()
    await expect(win.getByText('导航')).toBeVisible({ timeout: 20_000 })

    await win.keyboard.press('Meta+K')
    // 命令面板的占位符即出现 = 已打开
    const input = win.getByPlaceholder('跳转连接 / 执行命令…')
    await expect(input).toBeVisible({ timeout: 5_000 })

    // 输入「设置」筛选；面板会做大小写不敏感的子串匹配
    await input.fill('设置')

    // 命中：「设置」动作仍在；用 .cp-item 限定到面板内，避开导航树/工具栏的同字 label
    await expect(win.locator('.cp-item').filter({ hasText: '设置' }).first()).toBeVisible({
      timeout: 3_000,
    })
    // 反例：「全局对象搜索（表/视图/列）」不应保留在过滤结果里
    await expect(win.locator('.cp-item').filter({ hasText: '全局对象搜索' })).toHaveCount(0)
  } finally {
    await app.close()
  }
})
