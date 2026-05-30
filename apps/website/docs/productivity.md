# 生产力工具

SkylerX 把"DBA / 后端日常 30 秒 - 30 分钟级别的高频动作"都接到了**键盘 / 命令面板 / 通知**这三条主干上,目标是少点几下、少切几次窗口。本页按"用得最多的入口"列出来,每个工具都对应着代码事实和源文件。

## 1. 概述

| 工具 | 入口 | 解决的问题 |
|---|---|---|
| 命令面板 ⌘K | 全局 / `Settings → 键绑定` | 一切都能从这里搜出来 → 跳过菜单导航 |
| 全局对象搜索 ⌘⇧O | 全局 | 跨多库 fuzzy 搜表 / 视图 / 列 → 一键定位到导航树 |
| SQL 片段库 | 编辑器右侧抽屉 / `★` 按钮 | 收藏复用查询,带 `{{var}}` 模板 |
| 查询历史 | 编辑器右侧抽屉 | 时间 / 耗时排序,慢查询红字标记 |
| 收藏夹 | ⌘K → "收藏夹" / 工具栏 | 表 / 视图 / 查询的快速回访 |
| 自定义快捷键 | `Settings → 键绑定` | 12 条命令任意重绑 + 冲突检测 |
| Dashboard | ⌘K → "Dashboard" | 多 SQL 多卡片"今日状态盘" |
| Webhook 通知 | `Settings → 通知` | 钉钉 / 飞书 / Slack / 通用,推慢查询 + 错误 |
| 多窗口 ⌘⇧N | 文件 → 新窗口 | 同一应用,两个独立会话(本地连本地 / 本地比远程) |

---

## 2. 命令面板 ⌘K

代码位置:`packages/ui/src/components/CommandPalette.vue` + `packages/ui/src/Workspace.vue`(项目源 / 路由)

按 ⌘K(mac)/ Ctrl+K(Win/Linux) → 一个浮在顶部的搜索框 → 输入关键字过滤 → ↑↓ 选 → Enter 执行。Esc 关闭。

### 搜索机制

```ts
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q
    ? props.items.filter((it) => `${it.label} ${it.hint ?? ''}`.toLowerCase().includes(q))
    : props.items
})
```

- 匹配 label + hint(连接 hint 是方言名),纯子串 includes,**不需要拼音 / 顺序匹配**(打字快比模糊重要)
- 最多展示 50 条(避免长列表卡顿)

### 内置命令清单

下表是 `Workspace.vue` 里 `paletteItems` 计算属性的全量(动作 + 每个连接专属的动作 + 所有连接条目):

| 全局动作 ID | 标签 | 等价路径 |
|---|---|---|
| `act:new-conn` | 新建连接 | 工具栏 + |
| `act:object-search` | 全局对象搜索 | ⌘⇧O |
| `act:schema-diff` | Schema 对比 | 工具 → Schema diff |
| `act:data-diff` | 数据对比 | 工具 → Data diff |
| `act:privileges` | 权限管理 | 右键连接 → 权限 |
| `act:settings` | 设置 | ⌘, |
| `act:export-conns` / `act:import-conns` | 导入 / 导出连接配置 | 文件菜单 |
| `act:refresh` | 刷新导航树 | F5 |
| `act:favorites` | 收藏夹 | 工具栏 ⭐ |
| `act:oplog` | 操作日志 | 工具栏 |
| `act:monitor` | 监控面板 | 工具栏 |
| `act:dashboard` | Dashboard | 工具 → Dashboard |
| `act:ndjson-viewer` | NDJSON 查看器 | 工具栏 |
| `act:contracts` | 数据契约 | 工具 → 数据契约 |
| `act:o2dm` | Oracle → DM 迁移向导 | 工具栏 |
| `act:translate` | SQL 翻译(跨方言) | 工具栏 |
| `act:notif` | 通知 webhook 配置 | `Settings → 通知` |
| `act:keybind` | 自定义快捷键 | `Settings → 键绑定` |
| `act:drift` | Schema 漂移检测 | 工具栏 |
| `act:ai-chat` / `act:ai` / `act:ai-toolbox` | AI 聊天 / AI 助手 / AI 工具箱 | ⌘⇧L |
| `act:about` / `act:shortcuts` | 关于 / 快捷键参考 | 帮助菜单 |
| `act:new-window` | 新窗口(仅桌面端) | ⌘⇧N |

### 每连接专属动作

下列动作会按"已有的每个连接"展开成一行,标签后缀是 `· 连接名 · 方言`:

| ID 前缀 | 含义 |
|---|---|
| `act:activity:` | 服务器活动(processlist / pg_stat_activity) |
| `act:obtopo:` | OceanBase 集群拓扑(仅 OB 方言可见) |
| `act:snapshots:` / `act:backup:` | Schema 快照 / 备份还原 |
| `act:health:` / `act:vqd:` | AI 体检 / 可视化查询构建器 |
| `act:slowq:` / `act:idxrec:` / `act:repl:` | 慢查询分析 / 索引推荐 / 主从延迟 |
| `act:compliance:` / `act:search-value:` | 合规检查 / 跨表全文搜索 |
| `act:aicmt:` | AI 写注释 |
| `conn:` 前缀 | 直接打开连接(分组 = "连接") |

> 一个有 5 个连接的工作区,命令面板能搜出 80+ 条命令;按 group 标签 + 子串 includes 过滤,输入 3-4 个字符就能定位。

### 扩展方式

代码集中在 `paletteItems` 计算属性。新增命令分两步:数组里加一条 `{ id, label, group }`,在 `onPaletteSelect()` 里加 `else if (item.id === ...)` 路由。要"按连接展开"参考 `act:compliance:` 做法:`.map(c => ({ id: \`act:xxx:${c.id}\`, ... }))`,路由里用 `item.id.startsWith()` 拆 id。

---

## 3. 全局对象搜索 ⌘⇧O

代码位置:`packages/ui/src/components/ObjectSearchDialog.vue`

按 ⌘⇧O(mac)/ Ctrl+Shift+O(Win/Linux)弹出对话框,在选定连接里**跨库 / schema 模糊搜表、视图、列**。

### 搜索 SQL

走 `information_schema`,MySQL 系 / PG 系两套 SQL:

| 方言族 | 排除的 schema | 转义模式 |
|---|---|---|
| MySQL 系 | `mysql / information_schema / performance_schema / sys` | `LIKE '%term%'`,`%_\\` 三字符转义 |
| PG 系 | `pg_catalog / information_schema` | `ILIKE '%term%'` |
| 其它 | — | 不支持,提示走人工搜 |

每类(表 / 视图 / 列)各取前 100 条;输入 280ms 防抖。

### 结果行为

- **单击行 = reveal**:emit `reveal` 事件,Workspace 接住后在左侧导航树定位并选中该对象(如果对应库还没展开,会一路展开)
- **悬停露出"预览"按钮**:emit `preview`,直接打开 `SELECT * FROM schema.table LIMIT 200`(走方言的标识符 quote)
- **图标**:`▦` 表 / `◫` 视图 / `·` 列

### 并发安全

每次输入会自增 `seq` 序号,只有"最新一次"的结果会被 commit,避免输入快时旧响应覆盖新响应。

---

## 4. SQL 片段库

代码位置:`packages/ui/src/snippets.ts` + `packages/ui/src/components/SnippetsPanel.vue`

### 数据结构

```ts
interface Snippet {
  id: string        // `${timestamp}-${rand5}`
  name: string      // 用户起名,留空则取 SQL 前 40 字符
  sql: string
  tags?: string[]   // 归类标签,UI 里按 # 过滤
  dialects?: DbDialect[]  // 限定方言,空 = 通用
  createdAt: number
}
```

存 `localStorage.skylerx.snippets`,Vue `reactive` + `watch deep` 实时落盘。

### 添加 / 删除

- 任意 SQL 编辑器右键 → "保存为片段"或工具栏 `★`
- 查询历史里每行的 `★` 按钮 → 直接收藏成片段
- `Settings → 编辑器 → 保存片段` 默认绑定 ⌘S(可改)

### 占位符模板

片段里的 `{{var}}` 在插入时弹 prompt 让用户填:

```sql
SELECT * FROM {{table}} WHERE id = {{id}}
```

`applySnippetVars()` 按出现顺序提取占位符,逐个弹框;任意一步取消 → 整个放弃,不插入半成品 SQL。

### 按方言过滤

`snippetsForDialect(dialect)` 在面板里自动按当前编辑器所连方言筛:

- `dialects = []` 或未设 → 任意方言都看得到("通用")
- `dialects = [MySQL, MariaDB]` → 只在 MySQL / MariaDB 连接里出现

避免在 PG 连接里看到一堆 MySQL 专属语法。

### 面板交互

| 操作 | 效果 |
|---|---|
| 顶部搜索框 | 子串过滤 name + SQL + tags |
| 标签栏 `#xxx` 单击 | 按标签过滤;再点取消 |
| 双击片段行 | 应用占位符后插入到编辑器 |
| `×` | 删除该片段(不弹确认) |

---

## 5. 查询历史

代码位置:`packages/ui/src/components/HistoryPanel.vue`

每次执行成功 / 失败都会写一条记录到本地 SQLite,字段含 `sql / executedAt / durationMs / success / pinned / tags / note`。

### 排序 + 过滤

| 控件 | 说明 |
|---|---|
| 搜索框 | 子串扫 sql + tags + note |
| 排序下拉 | `按时间倒序`(默认)/ `按耗时降序` |
| `≥ N ms` | 慢查询过滤,超过阈值的行**整行染红**(默认 500ms) |
| `📌` | 仅看置顶 |
| `清空` | 一键清空整张表 |

置顶永远排最上面(`pinned: 1` 强制顶部),其它按用户选的排序。

### 行操作

| 按钮 | 行为 |
|---|---|
| `📌` | 切换置顶 |
| `🏷` | 改 tags(逗号分隔,如 `daily,prod,join`) |
| `📝` | 改 note(自由文本备注) |
| `★` | 保存为 SQL 片段(emit `saveSnippet`) |
| 双击行 | 把 SQL 载回当前编辑器 |

所有元数据修改通过 `client.connections.historyMeta(id, patch)` 落到 SQLite,不走 localStorage。

### 慢查询联动通知

`Settings → 通知 → 全局触发器 → 慢查询阈值 (ms)`(`settings.slowQueryNotifyMs`)。设成非 0 后,凡是超过这个阈值的执行都会触发 `notify('slow-query', ...)` → 对应 webhook 渠道。

---

## 6. 收藏夹

代码位置:`packages/ui/src/favorites.ts`

收藏可以是三种 `kind`:

| kind | 含义 | 点击行为 |
|---|---|---|
| `table` | 数据表 | reveal 到导航树并预览前 200 行 |
| `view` | 视图 | 同上 |
| `query` | 自定义 SQL | 在当前 / 新 tab 打开为草稿 |

### 主键规则

- 对象类:`${connId}|${sqlName}`,同连接里同对象只收藏一次,toggle 二次点取消
- 查询类:`q|${connId}|${createdAt}|${rand4}`,允许同 SQL 收藏多次(场景:同一查询不同时刻的"快照")

### 分组标签

`setFavoriteTag(id, tag)` 给单条收藏挂一个标签,面板按 tag 折叠展示。一条收藏只取首个 tag,简单粗暴够用。

### 持久化

`localStorage.skylerx.favorites`,reactive + watch deep。

### 从查询历史一键收藏

`addQueryFavorite({ connId, connName, dialect, name, sql, tags })` 是为"我跑了一段查询,这个值得留下"的快捷路径准备的。HistoryPanel 的 `★` 按钮走的是 snippet,工具栏的"收藏当前查询"走的是这个函数。

---

## 7. 自定义快捷键(K1)

代码位置:`packages/ui/src/keybindings.ts` + `packages/ui/src/components/KeyBindingsDialog.vue`

入口:`Settings → 键绑定` / 命令面板 → "自定义快捷键"。

### 12 条可绑定命令

| ID | 默认 chord | 用途 |
|---|---|---|
| `run-sql` | `CmdOrCtrl+Enter` | 执行 SQL |
| `palette` | `CmdOrCtrl+K` | 命令面板 |
| `object-search` | `CmdOrCtrl+Shift+O` | 全局对象搜索 |
| `ai-chat` | `CmdOrCtrl+Shift+L` | 切换 AI 聊天面板 |
| `new-conn` | `CmdOrCtrl+N` | 新建连接 |
| `new-query` | `CmdOrCtrl+T` | 新建查询 |
| `close-tab` | `CmdOrCtrl+W` | 关闭标签页 |
| `find` | `CmdOrCtrl+F` | 编辑器查找 |
| `replace` | `CmdOrCtrl+H` | 编辑器替换 |
| `format-sql` | `CmdOrCtrl+Shift+F` | 格式化 SQL |
| `save-snippet` | `CmdOrCtrl+S` | 保存当前 SQL 为片段 |
| `settings` | `CmdOrCtrl+,` | 设置 |

### `CmdOrCtrl` 的渲染约定

| 平台 | 字面量 `CmdOrCtrl+Shift+K` 显示成 |
|---|---|
| macOS | `⌘⇧K`(系统菜单风格,连排无 `+`) |
| Windows / Linux | `Ctrl+Shift+K` |

存储一律用 `CmdOrCtrl+...` 这种 OS 无关字符串,渲染按平台映射;由 `formatChord()` 完成。

### 录制流程

1. 单击命令行的"录制" → 行进入录制态,渲染一个隐形的 `input`(`position: absolute; left: -9999px`)拿键盘焦点
2. 监听 `keydown`,`chordFromEvent(e)` 解析当前组合键:
   - 修饰键顺序固定为 `CmdOrCtrl → Shift → Alt`(保证字符串等价 ↔ chord 字面量等价)
   - 单字母强制大写,空格归 `Space`,其它 `Enter` / `,` / `ArrowUp` 原样
   - 裸修饰键(只按 Shift 还没按主键)返回空串
3. 按 Enter 保存 / Esc 取消 / Backspace 在空 draft 时表示"禁用此命令"(落盘为空串)

### 冲突检测

`conflicts` 计算属性扫一遍合并后的绑定(含录制态的 `draftChord`),发现两条命令绑到同一 chord 时,行尾会红字提示 `"与 XX 命令冲突"`,让用户当场看见。

### 存储 + "恢复默认"

只把"和默认不同"的项落到 `settings.keyBindings`(`Record<string, string>`)。

- 改回默认 → 自动从覆盖里删,保持存储精简
- "全部恢复默认" → 清空 `settings.keyBindings`,加二次确认
- "禁用某命令" = 写入空串,**保留 key** 但值为 `''`

---

## 8. Dashboard — 多 SQL 多卡片

代码位置:`packages/ui/src/components/DashboardDialog.vue`

入口:工具菜单 → Dashboard / ⌘K → "Dashboard"。

### 卡片结构

```ts
interface Card {
  id: string
  title: string
  connId: string
  sql: string
  lastRunAt?: number
  lastResult?: QueryResult | null
  lastError?: string | null
}
```

- 持久化到 `localStorage.skylerx.dashboard.cards`,但**不存 `lastResult`**(可能很大),重新打开时清掉
- 每行展示标题 + 连接名 + SQL 预览(200 字符截断) + 最近 5 行结果(60 字符截断)

### 操作

| 按钮 | 行为 |
|---|---|
| `+ 添加卡片` | 弹小表单:标题 + 连接 + SQL(textarea 4 行) |
| `↻ 全部刷新` | `Promise.all(cards.map(runCard))` 并发跑 |
| 卡片头 `↻` | 单卡刷新 |
| 卡片头 `✎` | 进入编辑表单 |
| 卡片头 `×` | 删除(带确认) |

### 不做的事(刻意取舍)

- **不做定时刷新**:容易被忘后台跑死,需要时手动点 ↻ 即可
- **不做图表**:点 "→ 跳 ChartDialog" 是更清晰的"想看就看"路径
- **不做共享 / 协作**:v0.5 之前不上,避免引入云服务依赖

---

## 9. Webhook 通知

代码位置:`packages/ui/src/notifications.ts` + `packages/ui/src/components/NotificationSettingsDialog.vue`

入口:`Settings → 通知` / ⌘K → "通知 webhook"。

### 四种渠道

| Channel | URL 形态 | 签名 |
|---|---|---|
| `dingtalk` | 钉钉机器人 webhook | HMAC-SHA256(`ts\n${secret}`, key=`secret`),拼到 query `?timestamp=&sign=urlencoded(...)` |
| `feishu` | 飞书机器人 webhook | HMAC-SHA256(空 data,key=`ts\n${secret}`),sign 进 body 字段 |
| `slack` | Slack incoming webhook | 无签名(URL 即凭据) |
| `webhook` | 通用 POST JSON | 无签名,接收端自己解析 |

签名算法走 `globalThis.crypto.subtle` 的 HMAC-SHA256,**不引第三方依赖**。

### 三种触发事件

| Event | 触发时机 |
|---|---|
| `query-error` | SQL 执行失败 |
| `slow-query` | 执行时长 ≥ `settings.slowQueryNotifyMs` (0 = 关闭) |
| `manual` | 用户点"测试发送" / 工具栏的"通知" |

每条配置都能独立订阅这三种事件(`subscribe: NotifEvent[]`)。

### 配置项

```ts
interface NotifConfig {
  id: string
  name: string
  channel: 'dingtalk' | 'feishu' | 'slack' | 'webhook'
  webhookUrl: string
  secret?: string           // 钉钉/飞书加签密钥(选填)
  enabled: boolean
  subscribe: NotifEvent[]
}
```

存 `localStorage.skylerx.notifications`,独立于 `settings`(因为通知量大、变动频繁,跟 settings 同步会产生噪音)。

### 测试发送

`Settings → 通知` 选中一条配置 → "测试发送"。生效条件:

- `enabled === true`
- `webhookUrl` 非空
- `subscribe.includes('manual')`(因为测试走的是 `notify('manual', ...)`)

任一不满足都会 toast 提示,不会真发。

### 派发不阻塞主流程

`notify(event, payload)` 是 fire-and-forget:

```ts
await Promise.all(targets.map(async (c) => {
  try { await dispatchOne(c, payload) }
  catch (e) { console.warn(`[notify] ${c.channel}/${c.name} failed:`, e) }
}))
```

任何单个 webhook 失败都吞掉,只在控制台留 warn。**通知是辅助通道,不能拖累主流程**。

### 桌面端代理 fetch

桌面 Electron 优先走 `globalThis.api.ai.fetch` IPC 代理,绕开浏览器 CORS;Web 端 fallback 到原生 `fetch`。

---

## 10. 应用菜单结构

代码位置:`apps/desktop/src/main/menu.ts`

7 个顶级菜单(参考 DataGrip / Navicat 布局):

| 菜单 | 主要项 |
|---|---|
| **SkylerX**(仅 mac) | 关于 / 设置 ⌘, / 检查更新 / 服务 / 隐藏 / 退出 |
| **文件** | 新建连接 ⌘N / 新建查询 ⌘T / 打开 SQL 文件 ⌘O / 导入 · 导出连接配置 / 备份 · 还原 / 关闭标签页 ⌘W |
| **编辑** | 系统 role(撤销 / 重做 / 剪切 / 复制 / 粘贴 / 全选) + 查找 ⌘F / 替换 ⌘H / 格式化 SQL ⌘⇧F |
| **视图** | 命令面板 ⌘K / 对象搜索 ⌘⇧O / 切换 AI 聊天 ⌘⇧L / 收藏夹 / 操作日志 / 缩放 / 全屏 / 开发者工具 |
| **工具** | 服务器活动 / 备份还原 / 数据传输 / Schema diff / Data diff / Schema 快照 / Dashboard / 跨表全文搜索 / 数据契约 / AI 工具箱 / AI 助手 |
| **窗口** | 新窗口 ⌘⇧N / 最小化 / 重新加载 / (mac)前置全部窗口 |
| **帮助** | 关于 / 快捷键参考 / GitHub 仓库 / 反馈问题 / 检查更新 |

### 实现细节

自定义菜单项**不直接在主进程执行业务逻辑**(拿不到渲染层 Vue 状态),而是统一 `webContents.send('menu:command', '<key>')` 通知渲染层。渲染层在 `Workspace.vue` 用 `window.api.menu.onCommand(key => ...)` 订阅,按 key 路由到对应 paletteItem 的 `onPaletteSelect`。

---

## 11. Settings 全览

代码位置:`packages/ui/src/components/SettingsDialog.vue`

`Settings` 对话框左侧 5 个分类标签,右侧动态渲染表单。

| 分类 | 主要项 |
|---|---|
| **常规** ⚙ | 语言(中 / 英)、主题(深 / 浅)、界面缩放(70% - 200%)、提交模式默认(auto / manual)、NavTree 按使用频率排序、**数据脱敏开关 + 规则编辑** |
| **编辑器** ⌨ | 字体大小、缩进、自动换行、自动补全开关、关键字大小写(upper / lower / preserve) |
| **数据网格** ▦ | 默认页大小(50 / 100 / 200 / 500 / 1000)、NULL 显示文案 |
| **生产水印** ⚠ | 文案、透明度(0.04 - 0.5)、角度(-90° - 90°)、字号、颜色;附实时预览 |
| **AI 助手** ✨ | Provider 切换(Anthropic / OpenAI / DeepSeek / Codex / Grok)、API Key / Model / Base URL、记忆与画像(A 自由文本 / B 结构化事实 / C 向量记忆) |

> **跟主题相关的项**:`Settings → 常规 → 主题` 切深 / 浅,影响所有面板。深色是默认(`appearance: 'dark'` 写在 VitePress / Electron 渲染 CSS 变量里)。

### "AI 记忆"三档

| 档 | 字段 | 含义 |
|---|---|---|
| A | `aiCustomInstructions` | 自由文本画像,每次对话拼到 system prompt |
| B | `aiFacts[]` + `aiAutoExtractFacts` | 结构化事实清单,可手动 / 自动抽取 |
| C | `aiVectorMemory` + embedding 三件套 + `aiVectorTopK` | 向量记忆,跨会话语义召回 |

底部 `恢复默认` 把整张 settings 表 reset,带二次确认。

---

## 12. 多窗口 ⌘⇧N

代码位置:`apps/desktop/src/main/index.ts` 的 `spawnExtraWindow()` + IPC `window:newSession`

按 ⌘⇧N(mac)/ Ctrl+Shift+N(Win/Linux) → 弹一个全新的 BrowserWindow(1100 × 750),复用同一 renderer URL,跟主窗口**完全独立的会话**。

### 典型用法

| 场景 | 做法 |
|---|---|
| 本地比远程 | 主窗口连本地 dev,新窗口连 prod replica,两边并排 |
| 多租户切换 | 一个窗口连租户 A,一个连租户 B |
| 大查询 + 边写边查 | 主窗口跑慢 SQL,新窗口写下一段 |

每个窗口独立持有 SQL 标签页 / 当前选中的连接 · 库 · schema / 编辑器光标位置。历史 / 收藏 / 片段是**共享的**(都走 localStorage 同源 + SQLite 单文件)。

不做"窗口同步"(两个窗口同连接的执行互相不可见,各自写自己的 historyPanel);不做"窗口管理器",窗口数量没上限,自己用 OS 的 Mission Control / Exposé。

---

## 13. 全部生产力快捷键速查

默认绑定如下;均可在 `Settings → 键绑定` 重绑(`new-window` 是菜单项,不在 `COMMANDS` 表里)。

| 操作 | macOS | Windows / Linux | 命令 ID |
|---|---|---|---|
| 命令面板 | ⌘K | Ctrl+K | `palette` |
| 全局对象搜索 | ⌘⇧O | Ctrl+Shift+O | `object-search` |
| 执行 SQL | ⌘+Enter | Ctrl+Enter | `run-sql` |
| 切换 AI 聊天 | ⌘⇧L | Ctrl+Shift+L | `ai-chat` |
| 新建连接 / 新建查询 / 关闭标签页 | ⌘N / ⌘T / ⌘W | Ctrl+N / T / W | `new-conn` / `new-query` / `close-tab` |
| 查找 / 替换 / 格式化 SQL | ⌘F / ⌘H / ⌘⇧F | Ctrl+F / H / Shift+F | `find` / `replace` / `format-sql` |
| 保存为片段 / 设置 | ⌘S / ⌘, | Ctrl+S / Ctrl+, | `save-snippet` / `settings` |
| 新窗口 | ⌘⇧N | Ctrl+Shift+N | (菜单项) |
