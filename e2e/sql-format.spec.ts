/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'

/**
 * 场景：在 SqlEditor 中键入一行未格式化 SQL → ⌘⇧F → 编辑器内容跨行（包含换行）。
 * 借 SQLite 连接最快进入查询页；不实际执行 SQL，只验证 sql-formatter 走通。
 */
const MAIN = join(__dirname, '../apps/desktop/out/main/index.js')

interface MinimalApi {
  connections: {
    create(c: unknown): Promise<{ id: string; name: string }>
    remove(id: string): Promise<void>
  }
}

test.setTimeout(60_000)

test('SQL 编辑器：⌘⇧F 格式化单行 SQL 为多行', async () => {
  const tag = `e2e-fmt-${process.pid}-${Date.now()}`
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

    await win.keyboard.press('Meta+K')
    await win.getByPlaceholder('跳转连接 / 执行命令…').fill(tag)
    await win.keyboard.press('Enter')

    // 等到查询页就绪：工具栏「格式化」按钮可见
    const fmtBtn = win.getByRole('button', { name: /格式化/ }).first()
    await expect(fmtBtn).toBeVisible({ timeout: 10_000 })

    // 在 Monaco 编辑器里写一行未格式化 SQL
    const monacoTextarea = win.locator('.monaco-editor textarea').first()
    await monacoTextarea.click()
    await monacoTextarea.fill('select a,b,c from t where a=1 and b=2 order by c')

    // ⌘+Shift+F 触发 SqlEditor 的 format 事件
    await win.keyboard.press('Meta+Shift+F')

    // 等待 Monaco 内可见区域出现至少 2 个 view-line（sql-formatter 会按子句换行）
    await expect
      .poll(
        async () => {
          return await win.locator('.monaco-editor .view-line').count()
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(1)
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
