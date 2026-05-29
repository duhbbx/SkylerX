/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'

/**
 * 场景：经 API 建 SQLite 连接 → 命令面板按名跳转 → 打开查询页 → 输入 SELECT 1 → ⌘Enter → ResultGrid 渲染 1 列 1 行。
 *
 * 依赖：本机 better-sqlite3 已按 Electron ABI rebuild（`pnpm --filter @db-tool/desktop rebuild:native`）。
 */
const MAIN = join(__dirname, '../apps/desktop/out/main/index.js')

interface MinimalApi {
  connections: {
    create(c: unknown): Promise<{ id: string; name: string }>
    remove(id: string): Promise<void>
  }
}

test.setTimeout(60_000)

test('SQLite：执行 SELECT 1，ResultGrid 显示结果', async () => {
  const tag = `e2e-exec-${process.pid}-${Date.now()}`
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

    // 经命令面板 → 输入连接名 → Enter，打开查询页
    await win.keyboard.press('Meta+K')
    const input = win.getByPlaceholder('跳转连接 / 执行命令…')
    await expect(input).toBeVisible({ timeout: 5_000 })
    await input.fill(tag)
    await expect(win.locator('.cp-item').filter({ hasText: tag }).first()).toBeVisible({
      timeout: 5_000,
    })
    await win.keyboard.press('Enter')

    // QueryPane 工具栏的「执行」按钮出现 = 已挂载
    await expect(win.getByRole('button', { name: /执行/ }).first()).toBeVisible({ timeout: 10_000 })

    // 聚焦 Monaco 编辑器（其内部用一个隐藏 textarea 接收输入）并键入 SQL
    const monacoTextarea = win.locator('.monaco-editor textarea').first()
    await monacoTextarea.click()
    await monacoTextarea.fill("SELECT 1 AS x, 'hello' AS y")

    // ⌘+Enter 执行；SqlEditor 在 onKeyDown 里抢先 emit('run')
    await win.keyboard.press('Meta+Enter')

    // ResultGrid 渲染：表头里两个列名 + 一个 'hello' 值
    await expect(win.locator('th').filter({ hasText: /^x/ }).first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(win.locator('th').filter({ hasText: /^y/ }).first()).toBeVisible()
    await expect(win.getByText('hello', { exact: false }).first()).toBeVisible()
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
