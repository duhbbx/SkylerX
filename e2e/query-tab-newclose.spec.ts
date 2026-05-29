/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'

/**
 * 场景：经命令面板打开一条 SQLite 连接的查询页 → 点 tab 栏 ＋ 新建一个查询页 → 关闭第二个查询页 → 第一个仍在。
 */
const MAIN = join(__dirname, '../apps/desktop/out/main/index.js')

interface MinimalApi {
  connections: {
    create(c: unknown): Promise<{ id: string; name: string }>
    remove(id: string): Promise<void>
  }
}

test.setTimeout(60_000)

test('查询 tab：新建并关闭一个 tab，原 tab 保留', async () => {
  const tag = `e2e-tab-${process.pid}-${Date.now()}`
  const dbPath = join(tmpdir(), `${tag}.sqlite`)

  const app: ElectronApplication = await electron.launch({ args: [MAIN] })
  let createdId = ''
  try {
    const win = await app.firstWindow()
    await expect(win.getByText('导航')).toBeVisible({ timeout: 20_000 })

    createdId = await win.evaluate(async ({ name, path }) => {
      const api = (window as unknown as { api: MinimalApi }).api
      const saved = await api.connections.create({
        id: '',
        name,
        dialect: 'sqlite',
        host: '',
        port: 0,
        user: '',
        password: '',
        database: path,
      })
      return saved.id
    }, { name: tag, path: dbPath } as { name: string; path: string })
    expect(createdId).toBeTruthy()

    // 打开第一个查询 tab
    await win.keyboard.press('Meta+K')
    await win.getByPlaceholder('跳转连接 / 执行命令…').fill(tag)
    await win.keyboard.press('Enter')
    await expect(win.locator('.qtab')).toHaveCount(1, { timeout: 10_000 })

    // 「+ 新建查询」按钮（title=新建查询）
    await win.locator('button[title="新建查询"]').click()
    await expect(win.locator('.qtab')).toHaveCount(2, { timeout: 5_000 })

    // 关闭最后一个 tab（每个 tab 的 × 按钮 title=关闭）
    await win.locator('.qtab button.t-close').last().click()
    await expect(win.locator('.qtab')).toHaveCount(1, { timeout: 5_000 })
  } finally {
    if (createdId) {
      try {
        const win = app.windows()[0]
        if (win) {
          await win.evaluate(async (id) => {
            const api = (window as unknown as { api: MinimalApi }).api
            await api.connections.remove(id)
          }, createdId)
        }
      } catch {
        /* 忽略 */
      }
    }
    await app.close()
    if (existsSync(dbPath)) {
      try {
        rmSync(dbPath)
      } catch {
        /* 忽略 */
      }
    }
  }
})
