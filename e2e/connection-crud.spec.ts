/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'

/**
 * 场景：经 window.api 直接 CRUD 一条 SQLite 连接（避开 ConnectionForm 表单细节），
 *      再点导航树「刷新」按钮，验证 UI 同步显示 / 隐藏该连接节点。
 *
 * - SQLite 文件放 os.tmpdir()，名字带 pid + Date.now() 防冲突。
 * - 不调用 connections.test（避免连接器原生绑定问题），只走 create/list/remove API；
 *   create 成功 + 树里出现 = 持久化层 + 渲染层 e2e 走通。
 * - afterEach 清理：API 删除 + 文件删除（如果 SQLite 真的创建了文件）。
 */
const MAIN = join(__dirname, '../apps/desktop/out/main/index.js')

interface MinimalApi {
  connections: {
    create(c: unknown): Promise<{ id: string; name: string }>
    list(): Promise<{ id: string; name: string }[]>
    remove(id: string): Promise<void>
  }
}

test.setTimeout(60_000)

test('连接 CRUD：经 API 新建 SQLite 连接，UI 树同步显示，删除后消失', async () => {
  const tag = `e2e-sqlite-${process.pid}-${Date.now()}`
  const dbPath = join(tmpdir(), `${tag}.sqlite`)

  const app: ElectronApplication = await electron.launch({ args: [MAIN] })
  let createdId = ''
  try {
    const win = await app.firstWindow()
    await expect(win.getByText('导航')).toBeVisible({ timeout: 20_000 })

    // 经 IPC 创建连接（不走表单，保证稳）
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

    // 点「刷新」按钮（title=刷新）让 NavTree 重拉
    await win.locator('button[title="刷新"]').first().click()
    await expect(win.getByText(tag, { exact: true })).toBeVisible({ timeout: 5_000 })

    // 经 API 删除并再次刷新
    await win.evaluate(async (id) => {
      const api = (window as unknown as { api: MinimalApi }).api
      await api.connections.remove(id)
    }, createdId)
    createdId = ''

    await win.locator('button[title="刷新"]').first().click()
    await expect(win.getByText(tag, { exact: true })).toHaveCount(0, { timeout: 5_000 })
  } finally {
    // 兜底：若中途断言失败，至少把连接 + 临时文件清理掉
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
