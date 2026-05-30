# AI 助手

SkylerX 把 AI 拆成**多个独立通道**注入到产品的不同位置 —— 不是一个聊天框包打天下:

- **右侧聊天面板**(`⌘⇧L`):多轮对话 + 库结构注入 + SQL 一键插入 / 执行
- **行内补全**:编辑器里灰色 ghost text(类似 Copilot)
- **错误诊断"问 AI"**:任何报错弹框 / 结果区都有按钮
- **AI Toolbox**:7 个常用 prompt 的统一入口
- **领域专用 dialog**:健康体检 / 洞察 / 建表 / 反向 / 注释 / 翻译 / 测试数据

底层共用一套 `provider 抽象 + 3 层记忆 + 多通道 IPC`。这一篇全部用代码事实说话,不掺主观吹。

## 1. 总览 — 多 provider + 平行通道

| 模块 | 文件 | 职责 |
|---|---|---|
| `askAi()` / `askAiChat()` | `ai.ts` | provider 分发(Anthropic vs OpenAI 兼容)、HTTP 请求(可经主进程 IPC)、可中断 |
| `pXxx()` prompts | `ai-prompts.ts` | 9 个领域 prompt 模板,纯字符串拼装 |
| 行内补全 | `aiInline.ts` | Monaco InlineCompletionsProvider,600ms 节流 + AbortController |
| 3 层记忆 | `memory.ts` | A 画像 / B 事实 / C 向量记忆,统一 `buildMemorySection()` 注入 system prompt |
| 聊天面板 | `AiChatPanel.vue` | 右侧侧边栏,schema 注入 + chat-bus 接收 |
| 领域对话框 | `Ai*Dialog.vue` | 健康体检 / 洞察 / 建表 / 反向 / 注释 / 测试数据 |
| 跨方言翻译 | `SqlTranslateDialog.vue` | 普通 SQL + 存储过程两种模式 |

所有通道在底层都走 `askAi*` → IPC fetch → 同一个 provider 配置。换 provider 时**所有通道立刻跟着换**。

## 2. Provider 配置

`Settings → AI Provider` 支持 5 类 provider:

| Provider | 协议 | 端点 |
|---|---|---|
| **Anthropic** | Anthropic Messages | `${baseUrl}/v1/messages`,`x-api-key` 鉴权 |
| **OpenAI** | OpenAI Chat | `${baseUrl}/v1/chat/completions`,`Authorization: Bearer` 鉴权 |
| **DeepSeek** | OpenAI 兼容 | 同上 |
| **Codex** | OpenAI 兼容 | 同上 |
| **Grok / xAI** | OpenAI 兼容 | 同上 |

实际代码(`ai.ts → askAi`):

```ts
const provider = settings.aiProvider
const cfg = settings.aiProviders[provider]
if (!cfg?.apiKey?.trim()) throw new Error('NO_API_KEY')
if (provider === 'anthropic') return callAnthropic(o, cfg.apiKey.trim(), base, model)
return callOpenAiCompat(o, cfg.apiKey.trim(), base, model)
```

### 自定义 endpoint

每个 provider 都有独立 `baseUrl`,直接改字段就行:

| 场景 | 配法 |
|---|---|
| 自家 Anthropic 代理 | provider=Anthropic,`baseUrl=https://your-proxy.example.com` |
| 私有 OpenAI 兼容(vLLM / Ollama / one-api) | provider=OpenAI,改 `baseUrl` 和 `model` 即可 |
| DeepSeek 直连 | `https://api.deepseek.com`,`model=deepseek-chat` |
| Grok 直连 | `https://api.x.ai`,`model=grok-3-mini` |

### API Key 加密存储

Key 跟连接密码同样走系统钥匙串(macOS Keychain / Windows Credential / GNOME libsecret),`settings.aiProviders[*].apiKey` 在磁盘上是加密形式。

### 走 IPC 还是浏览器直发?

桌面端 preload 暴露 `window.api.ai.fetch`(主进程代理,绕开浏览器 CORS,支持真·cancel)。Web 端 fallback 到原生 `fetch`。`ai.ts → aiBridge()` 自动选择:

```ts
function aiBridge() {
  return globalThis.api?.ai ?? null
}
```

IPC 路径还会把渲染层的 `AbortSignal` 链到主进程的 `ai:cancel`,**真正能取消正在飞的请求**(不只是丢弃响应):

```ts
const reqId = `r${Date.now()}-${random}`
init.signal?.addEventListener('abort', () => bridge.cancel?.(reqId))
```

## 3. 右侧聊天面板 — AiChatPanel

`⌘⇧L` / `Ctrl+Shift+L` 切换可见性。面板可拖左边沿调宽度(`280-800px`),宽度持久化到 `skylerx.aiChat.width`。

### 上下文条(顶部)

| 控件 | 作用 |
|---|---|
| **连接选择** | 当前对话指向哪个连接(决定方言 + schema 来源) |
| **库 / schema 选择** | MySQL 走 `SCHEMATA`,PG 走 `pg_namespace`;系统库自动过滤 |
| **附带库结构** 复选框 | 勾上后查 `information_schema.COLUMNS` 拼成 `tbl(col1 type, col2 type, ...)`,塞进 system prompt(限 6000 字符) |
| **新建对话** / **清空** | 清空当前历史,起新对话 |

### Schema 注入实现

MySQL 走 `information_schema.COLUMNS`,PG 走 `information_schema.columns`。按表分组拼成 `tbl(col1 type, col2 type, ...)` 一行一表,超过 6000 字符截断 + 加 `-- (truncated)`。**只发表名 + 列名 + 类型,不发数据**。

### 多轮对话

消息存 `localStorage` key `skylerx.aiChat.messages`,最多 50 条。每轮 `send()`:

```ts
const memorySection = await buildMemorySection(text)  // A/B/C 三层记忆
const reply = await askAiChat({
  messages: messages.value,           // 全量历史
  dialect: connOf(connId.value)?.dialect,
  schema: useSchema.value ? schemaText.value : undefined,
  memorySection,
  signal: controller.signal,
})
```

回复进来后还会**后台**:
- `autoExtractFacts({ user, assistant })` — 让 LLM 抽 1-3 条值得长期记住的事实进 B 档
- `rememberVector(\`Q: ${user}\nA: ${assistant}\`)` — 向量化后进 C 档

### 思考中计时 + 卡住提示

`elapsedTimer` 每秒 +1,渲染成 `12s`。超 20s 自动追加红色 `maybeStuck` 提示。`[停止]` 按钮调 `controller.abort()`(IPC 路径下会真·中断)。

### SQL 代码块特殊渲染

回复用 `splitParts` 按 ` ``` ` 切片,SQL 段单独走 Monaco `editor.colorize` 异步高亮(按内容哈希缓存到 `sqlHtml`),非 SQL 段用 `renderMarkdown` 渲染 GFM。

每段 SQL 下方三个按钮:

| 按钮 | 行为 |
|---|---|
| `复制` | `navigator.clipboard.writeText` |
| `插入草稿` | `emit('insertSql', sql, connId)` → Workspace 灌进 QueryPane |
| `▶ 运行` | 二次确认 → `emit('runSql', ...)` → Workspace 跑 |

### SQL 执行徽章

点了"运行"之后 SQL 块上挂徽章(持久化 `skylerx.aiChat.runMarks`,最多 200 条):

| 状态 | 显示 |
|---|---|
| `pending` | ⌛ 灰底 + "10:23 已派发" |
| `ok` | ✓ 绿底 + "10:23 成功" |
| `error` | ✗ 红底 + "10:23 失败",hover 看错误正文 |

执行完 QueryPane 通过 `onChatSqlExecuted` 事件总线广播,聊天面板订阅更新徽章。

### Provider 切换器

底部下拉只列**已配 apiKey 的 provider**(避免选了空 key 报 `NO_API_KEY`),旁边 `⚙` 按钮 emit `openSettings` 跳到 AI 设置 section。

## 4. 行内补全 — aiInline.ts

Monaco InlineCompletionsProvider,Copilot 风格 ghost text。注册在 SQL 编辑器上:

```ts
monaco.languages.registerInlineCompletionsProvider('sql', provider)
```

### 节流策略

| 参数 | 值 | 作用 |
|---|---|---|
| `DEBOUNCE_MS` | 600ms | 用户停顿 600ms 才打 LLM |
| `MAX_PREFIX` | 2000 字符 | 取光标前文本,超长截尾 |
| 最短触发长度 | 3 字符 | `prefix.trim().length < 3` 直接返回空 |

每次新触发**立即 abort 上一个**:

```ts
function clearPending() {
  if (!pending) return
  clearTimeout(pending.timer)
  pending.abort.abort()  // 真·取消上一个请求
  pending = null
}
```

不浪费 quota,也不会让旧补全突然蹦出来。

### Prompt + 系统提示

```ts
const text = await askAiChat({
  messages: [{ role: 'user', content: buildPrompt(prefix, ctx) }],
  dialect: ctx.dialect,
  extraSystem: '你是 SQL 行内补全引擎。只输出光标处后续的 SQL 文本片段,'
             + '最多 1 行,不要带代码块、不要解释、不要重复已有上文。'
             + '如果上下文不足以补全,输出空字符串。',
  signal: abort.signal,
})
```

`buildPrompt` 内容:`方言: <d>\n\nSchema:\n<hint>\n\nSQL 上文(光标在末尾):\n<prefix>`。

### 收尾清洗(`sanitizeCompletion`)

- 剥 ` ```sql ... ``` ` 围栏(LLM 偶尔包代码块)
- 模型偶尔重复一遍 prefix,以 prefix 末 80 字开头 → 剪掉
- 多行回复只取第一行

### 接受 / 取消

| 键 | 行为 |
|---|---|
| `Tab` | 接受补全 |
| `Esc` / `Backspace` / 继续打字 | 取消(Monaco 内置) |

### 总开关

复用 `settings.enableCompletion`(与 SQL 自动补全共开关),关闭补全时不再打 LLM。失败一律静默(行内补全不像聊天那么 mission-critical,挂掉了不要打扰用户)。

## 5. 错误诊断"问 AI"按钮

执行报错时**任何 alert 弹框 / 结果区错误条**都有 `✨ 问 AI` 按钮。点击触发 `AiChatPanel.askAboutError()`:

```ts
async function askAboutError(p: { connId, connName?, sql, error }) {
  controller?.abort()             // 1) 中断当前对话
  for (let i=0; i<30 && running.value; i++) await sleep(50)  // 等 finally 跑完
  connId.value = p.connId         // 2) 切到出错的连接
  useSchema.value = true          // 3) 强制启用 schema 上下文
  saveToStorage()
  const msg = `${t('aichat.askAiPrompt')}\n\n**连接**: ${p.connName}\n\n**SQL**\n\`\`\`sql\n${p.sql}\n\`\`\`\n\n**Error**\n\`\`\`\n${p.error}\n\`\`\``
  input.value = msg
  if (switching) await sleep(200) // 4) 等 schema 异步加载
  if (!schemaText.value) await loadSchema()
  await send()
}
```

### 消息形态

发出去的用户消息形如:

```markdown
请帮我看下这个 SQL 报错,给出可能的原因和修复建议。

**连接**: prod-mysql

**SQL**
```sql
INSERT INTO orders(user_id, amount) VALUES (42, 99.9)
```

**Error**
```
ERROR 1452 (23000): Cannot add or update a child row:
a foreign key constraint fails (`shop`.`orders`, CONSTRAINT `fk_user` ...)
```

加上自动注入的 schema 上下文(`users(id int, ...)` 和 `orders(...)` 都在),AI 一般能秒级定位"`user_id=42` 在 `users.id` 里不存在"。

### chat-bus 总线

这个机制不止聊天面板用 —— `MockDataDialog` 执行失败也走相同总线弹 `askAi` 按钮:

```ts
toast.error(`执行失败: ${errMsg}`, {
  askAi: { sql: stmt, error: errMsg, connId, connName, dialect },
})
```

`ChatErrorAskEvent` 是统一形态,任何位置抛错都能挂"问 AI"按钮,不用每处重复实现。

## 6. AI Toolbox(7 个专业 prompt)

`🛠 AI Toolbox` 或 `⌘K → AI 工具箱`。一张对话框承载 7 类任务,选好后点"让 AI 干"→ 关闭弹框 + prompt 发到右侧聊天面板。

| Toolbox | Prompt 模板 | 输入 | 输出形态 |
|---|---|---|---|
| **写迁移** | `pMigration` | 目标表 + 需求描述 | 三段独立 `\`\`\`sql`:正向 ALTER / 反向回滚 / 数据迁移 |
| **优化 SQL** | `pOptimizeSql` | 原 SQL + 可选 EXPLAIN | 判定 → 改写建议(SQL 块)→ 索引建议(SQL 块)→ 预期收益 |
| **解读 EXPLAIN** | `pExplainAnalysis` | SQL + EXPLAIN 文本 | 通俗中文逐节点解读 + "结论 + 最值得动手一处" |
| **生成测试数据** | `pTestData` | 表 + 行数 + 业务背景 | 单段 `\`\`\`sql`,逐行 INSERT,FK-aware |
| **NL → SQL** | `pNl2Sql` | 自然语言描述 | 单段 `\`\`\`sql`,有歧义先按最常见解释 + 提醒歧义点 |
| **写文档(字段含义)** | `pDataDictDoc` | 表 + 列 CSV | Markdown 3 列表:字段 / 类型 / 业务含义 |
| **解释表用途** | `pExplainTable` | 表 + 列 + FK 提示 | ≤ 200 字段落 + 3 bullets(谁插 / 谁读 / 删除策略) |

### Toolbox 表单字段

| 任务 | 需表 | 需 SQL | 需 EXPLAIN | 额外 |
|---|---|---|---|---|
| migration | ✓ | | | 需求文本 |
| optimize | | ✓ | (可选) | |
| explain-analysis | | ✓ | ✓ | |
| test-data | ✓ | | | 行数 + 业务背景 |
| nl2sql | | | | 需求文本 |
| doc | ✓ | | | 自动拉列 CSV |
| explain-table | ✓ | | | 自动拉列 CSV |

提交时调 `pXxx(...)` 拼好 prompt → `emit('submit', { prompt, connId, connName, withSchema: true })` → Workspace 转发到 `AiChatPanel.askPredefined(...)`,与 `askAboutError` 同一套路。

### 设计要点

- 用户原始诉求("加列 / 改名 / 优化")原样保留在 prompt 里,避免被翻译丢失语义
- 上下文(SQL / 表名 / EXPLAIN 文本)作为 Markdown 代码块插入,AI 更容易识别
- 期望输出格式写清楚("给我 ALTER + 反向 ALTER + 数据迁移"),减少来回
- 输出格式强约束(三段独立 `\`\`\`sql` + H3 标题) = 前端按标题切片稳定解析

## 7. AI Health Check — 数据库体检

工具栏 `❤️ Health Check`。打开后 4 步自动跑完:

1. **收集元数据** — 3 条并发 SQL:
   - MySQL:`COLUMNS / STATISTICS / KEY_COLUMN_USAGE`(过滤 `REFERENCED_TABLE_NAME IS NOT NULL`)
   - PG:`information_schema.columns + pg_index + pg_class` + FK 子查询
2. **序列化** — 按表分组成紧凑文本(columns / indexes / FKs)
3. **送 AI** — 用 `pHealthCheck` 拼 prompt,调 `askAiChat`
4. **渲染** — Markdown 按 H2 拆 6 张分类卡片

### 6 类反模式 + AI 实际检查指令(`pHealthCheck`)

| 节 | 标题 | AI 实际要做的事 |
|---|---|---|
| 1 | 高频查询列缺少索引 | 启发式推断 `status / created_at / user_id / type / is_* / *_at` 高频过滤排序列,但无对应索引的 → 点出 |
| 2 | 命名像外键但没 FK 约束 | `xxx_id` / `xxxId` 但所在表无指向任何父表的 FOREIGN KEY → 列出 + 猜父表 |
| 3 | 字段命名风格混用 | 同表 / 整库 snake_case + camelCase 混用 → 指出统一到哪种 |
| 4 | 类型选得过大 | `VARCHAR(255)` 装短串 / `BIGINT` 装小整数 / 时间用 `VARCHAR` 存 |
| 5 | 关键业务表 / 字段无 comment | `user / order / payment / account` 这类核心表无 COMMENT,挑值得加注释的关键字段 |
| 6 | 软删字段缺索引 | `deleted_at / is_deleted` 没进任何索引 → 给 `CREATE INDEX` 建议 |
| 总结 | — | 3~5 条按"性价比"排序的优先动手项 |

**输出强约束**:必须 6 个 `## 1.` ~ `## 6.` H2 标题分节(便于前端按 H2 拆卡片),没问题的小节也保留标题写"未发现明显问题"。

### 元数据采集

MySQL 用 `information_schema.COLUMNS / STATISTICS / KEY_COLUMN_USAGE`,PG 用 `information_schema.columns + pg_index/pg_class + table_constraints` FK 子查询,3 条 SQL 并发跑(每条限 ~5000 行)。prompt 总元数据 ~12K 字符上限截断,防 token 爆;仅支持 MySQL 家族 / PG 家族。

## 8. AI Insights — 慢 SQL + 错误根因

双 tab 对话框,直接黏贴 SQL / 错误就能跑(不需要先连库):

### Tab 1:慢 SQL 优化

输入:SQL(必填)+ EXPLAIN(可选)+ 表统计/行数(可选)。AI 输出 4 段:可疑慢点(全表扫/无索引/笛卡尔积/隐式转换/统计陈旧)→ 推荐索引(`CREATE INDEX`)→ 改写建议(覆盖索引 / 子查询 → JOIN / 等价改写)→ 估算改进效果。

`extraSystem`: `You are a database performance expert. Be specific and reference actual cost trade-offs.`

### Tab 2:错误根因

输入:错误信息(必填)+ 上下文(可选:执行的 SQL / 时间 / 用户)。AI 输出:错误意义(人话翻译)→ 最可能的 3 个原因(按概率)→ 排查步骤 → 修复方案。

`extraSystem`: `You are an SRE/DBA. Be practical, prioritize quick mitigation.`

跟"问 AI 按钮"的区别:Insights 是**手动 deep dive**(给一段错误,慢慢分析),按钮是**一键关联当前 SQL + 错误 + 当前连接 schema** 进聊天面板继续多轮。

## 9. AI Schema Architect — 设计表

对话式建表助手。给业务需求 → AI 出多表 + FK + 索引的完整 DDL,可继续追问改设计。

### 系统提示词(写死在组件里)

```text
You are a senior database architect. The user describes a business domain (in any language).
Your job:
1. Design multiple related tables (with primary keys, foreign keys, indexes,
   sensible types for the <dialect> dialect).
2. Output a single ```sql code block containing the COMPLETE CREATE TABLE statements
   (including foreign keys and indexes) so the user can copy-paste-run.
3. Explain key design decisions briefly in 2-4 bullet points.
4. When the user asks to revise, output the FULL updated SQL again (not just a diff)
   — they will execute the whole block.

Stay concise. Prefer normalized design unless user asks for denormalized.
```

### 流程

1. 用户输入业务描述(`"做个电商订单系统:用户、商品、订单、订单项,支持优惠券"`)
2. `askAiChat({ messages, dialect, extraSystem })` 拿回 Markdown
3. `extractAllSql(reply)` 抽所有 `\`\`\`sql` 块作为 `sqlBlocks`
4. 用户追问 → 历史全发回 → AI 输出**完整新版** SQL(强约束在 system prompt 里:不要给 diff,给全量)

### 一键执行

底部 `▶ 执行最新版本` 按钮:把最后一次助手回复里的所有 `sqlBlocks` join + `splitStatements` 切分 + 逐条 `client.connections.execute`。带二次确认显示 `CREATE` 语句条数 + 目标库。

## 10. AI Schema Reverse — 反向推断

给一段 CSV / TSV / JSON 示例数据 → AI 推断 schema → 生成 `CREATE TABLE` + 可选 `INSERT`。

### 输入

| 字段 | 说明 |
|---|---|
| 格式 | CSV / TSV / JSON 三选 |
| 表名 | 默认 `inferred_table`,可改 |
| 示例数据 | 几行就够,带表头/字段名最准 |
| 同时生成 INSERT | 复选框,勾上则 prompt 追加"5. 生成对应的 INSERT 语句把示例数据全部插入" |

### Prompt 结构

```text
请基于下面的 CSV 示例数据,反向推断 schema 并生成 mysql 方言的 CREATE TABLE SQL...

要求:
1. 推断每列**最合适**的类型(考虑长度、是否纯数字、是否日期、是否 enum 等)
2. 推断哪些列适合做**主键**(自增 vs 业务键)、哪些**必须 NOT NULL**
3. 推荐 1-2 个**索引候选**(基于经验:外键样的列、常用过滤列)
4. 表名: `inferred_table`

示例数据:
```
id,name,email,created_at
1,alice,a@x.com,2026-01-01
...
```

请严格按这个结构输出:

### 推断说明
(列名 → 类型 → 理由,2-3 句)

### CREATE TABLE
```sql
CREATE TABLE ...
```

### 索引建议
- ...
```

### 编辑后执行

返回的 SQL 抽到右侧可编辑框(`sqlEdit`),用户改完点 `▶ 执行` → 二次确认 → `splitStatements` 切分 → 逐条执行。

## 11. AI Comment Writer — 给表 / 列写注释

表右键 `💬 AI 写注释` 或工具栏入口。流程:

1. **拉列** — MySQL 用 `information_schema.COLUMNS`(name / type / nullable / default / comment),PG 加 `pg_catalog.col_description` 取已有 comment
2. **序列化** — 拼成 `columnsCsv`:`- col type [NOT NULL] [DEFAULT ...]`
3. **送 AI** — `pComment(ctx, columnsCsv)`,要求只输出**一个 `\`\`\`json` 代码块**
4. **解析** — 抽 JSON,得到 `[{ col, comment }]`
5. **对比表** — 现有 comment vs AI 建议,逐行复选框决定要不要采用
6. **应用** — 生成 ALTER:
   - MySQL:`ALTER TABLE ... MODIFY <col> <type> [NOT NULL] [DEFAULT ...] COMMENT '...'`(需要带回原 type / nullable / default,否则会丢)
   - PG:`COMMENT ON COLUMN <table>.<col> IS '...'`

### Prompt 强约束(`pComment`)

prompt 强制:**只输出一个 `\`\`\`json` 代码块,前后无说明文字**;数组每项 `{ "col": "列名", "comment": "中文一句话业务含义" }`;`col` 必须**原样**抄字段名(区分大小写,不翻译);`comment` ≤ 30 字,信息不足写 "?(建议人工补充)";**列出全部字段**(`id / created_at` 这类基础字段也要给)。

输出强约束 = `parseSuggestion()` 用稳定正则抽 ` ```json ... ``` `,失败再 fallback 把整段当裸 JSON 试一次。`col` 必须原样回写 → 与现状对比 + 拼 ALTER 不会错位。

### 表级注释

除了列级,还能为表本身写一句:MySQL `ALTER TABLE ... COMMENT='...'`,PG `COMMENT ON TABLE ... IS '...'`。

## 12. AI SQL 翻译 — SqlTranslateDialog

`🌐 Translate` 入口。4 个方言固定:`mysql / postgresql / sqlserver / oracle`。

### 两种模式

| 模式 | Prompt |
|---|---|
| **SQL**(普通查询 / DDL) | `pTranslate(from, to, sql)` |
| **存储过程 / 函数** | `pTranslateProcedure(from, to, code)` —— 额外覆盖参数模式 / BEGIN-END / DECLARE / 异常处理 / 游标 / DELIMITER |

`extraSystem` 也跟着切:

- SQL: `You are a senior SQL polyglot. Translate SQL across dialects precisely; flag every non-portable construct honestly.`
- Procedure: `You are a senior SP/PL/SQL polyglot. Translate stored procedures faithfully; preserve control flow and explicit error handling.`

### 输出强约束(`pTranslate`)

严格 3 段:

1. **译后 SQL** — 单个 `\`\`\`sql` 代码块,只放一条,无解释
2. **`### 警告`** — bullet 列出**不可平移**的点(`MySQL ON DUPLICATE KEY UPDATE` → `PG ON CONFLICT DO UPDATE`,语义大体可对齐但行为细节不同;`DATETIME vs TIMESTAMP`;`NVARCHAR vs NVARCHAR2`;分页 / 自增 / 字符串拼接 / 引号风格;隐式转换、NULL 排序行为差异);无则写"无明显不可平移语法"
3. **`### 建议`** — bullet 给出目标方言**更地道**的写法(CTE / `LIMIT OFFSET` / `COALESCE` 替 `IFNULL`);无则写"直译已足够地道"

H3 标题分隔 → 前端按标题切分渲染。

### 双栏渲染

| 左栏 | 右栏 |
|---|---|
| `extractSql(answer)` 抽译后 SQL → Monaco `colorize` 高亮 + `一键复制` | 剔除首个 `\`\`\`sql` 块后剩余的 Markdown(警告 + 建议)→ `renderMarkdown` |

### 小优化

- `swapDialects()`:一键互换 from/to,方便翻译后再反向
- **同方言短路**:`from === to` 直接构造一段"无需翻译"的伪回复,不浪费请求
- 翻译中可 `controller?.abort()` 取消

## 13. AI Mock Data — FK-aware 测试数据

表右键 `🧪 生成测试数据`。这个 dialog 主体是**规则引擎**(`mockgen.ts` 按列名 + SQL 类型推 `SemanticKind`),AI 只在两个点介入:

### 13.1 `aiInfer()` — 让 AI 一次性推所有列的语义类型

按钮 `✨ AI 推断`。prompt 全英文(模型对英文 JSON instruction 反应更稳),约束:

- 从固定白名单 `SEMANTIC_KINDS` 里挑(`auto / integer / decimal / money / name_cn / phone_cn / id_card_cn / address_cn / email / enum / lorem_cn / ...`),其他视为无效
- 中文上下文列(`name/姓名 / 手机/phone / 身份证 / 地址`)优先 `_cn` 变体
- **禁用** `auto`(产生无意义随机文本),必须挑具体类型
- `money/price/amount/cost` → `money`;`decimal/float` → `decimal`
- 带 `[PK]` 标记的整数主键 → `integer`(生成器会自增);`status/state/role` → `enum`;`description/content/remark/note` → `lorem_cn`
- **只输出** JSON object,形如 `{"user_id":"integer","name":"name_cn","mobile":"phone_cn"}`

返回后用 `/\{[\s\S]*\}/` 抓第一段 JSON(容忍前后多余文字),逐条校验 kind 在白名单 + 列在 baseColumns 后应用。

### 13.2 执行失败时挂"问 AI"

INSERT 失败(NOT NULL 缺值 / FK 不存在 / 类型不匹配)→ toast 里挂 `askAi` 按钮 → 通过 chat-bus 把 stmt + 错误 + 连接信息一并送给聊天面板。

实际生成 INSERT 由 `buildMockInserts(dialect, tableRef, columns, count)` 出(分 chunk,每 chunk 100 行),AI 不参与生成本身 —— 只用来**推语义** + **诊断错误**。

## 14. 三层记忆 — memory.ts

`Settings → AI → 记忆` 配置;每次对话自动注入到 system prompt 前置位(模型对前置 context 更敏感)。

| 档 | 名字 | 形态 | 用法 | 触发 |
|---|---|---|---|---|
| **A** | `aiCustomInstructions` | 自由文本 | 长期身份 / 偏好 | 每次对话全量注入 |
| **B** | `aiFacts` | `{id, text, createdAt}[]` | 结构化事实 | 每次对话全量注入;`aiAutoExtractFacts` 开启时每轮自动抽 1-3 条入库 |
| **C** | `aiVectorMemories` | `{id, text, vec, createdAt}[]` | 大量笔记 | 每次按余弦相似度取 top-K(默认 `aiVectorTopK`),分数 > 0.3 才用 |

### `buildMemorySection(query)` 拼装顺序

按 A → B → C 顺序拼成 Markdown 段:

- A: `## User profile & preferences` + 自由文本
- B: `## Known facts` + bullet 列表
- C: `## Relevant past notes` + bullet 列表(需要 query + 已配 embedding key,`recallRelevant(query)` 取 top-K + 阈值 > 0.3)

### Embedding 配置

C 档需要 embedding 端点。`Settings → AI → 记忆` 里单独配:

| 字段 | 默认 |
|---|---|
| `aiEmbeddingBaseUrl` | (空,需要用户填) |
| `aiEmbeddingApiKey` | (空) |
| `aiEmbeddingModel` | `text-embedding-3-small` |

实际请求走 OpenAI 兼容 `${base}/v1/embeddings`,DeepSeek / Grok 同样兼容。Embedding 类短请求超时给 15s,避免拖垮聊天主流程。

### LRU 截断

C 档容量上限 1000 条,超出时截掉最老:

```ts
if (settings.aiVectorMemories.length > 1000) {
  settings.aiVectorMemories.splice(1000, settings.aiVectorMemories.length - 1000)
}
```

### 自动事实抽取(B 档)

`aiAutoExtractFacts` 开启时,每轮 chat 结束后 `autoExtractFacts({ user, assistant })` 让 LLM 看一轮 user/assistant 对话,抽 ≤ 3 条**值得长期记住**的事实(`"uses MySQL 8"` / `"works on 'orders' schema"` / `"prefers snake_case"`),跳过 ephemeral content;回复 `none` 跳过,否则解析 bullets 入库;失败一律静默(memory 不能阻塞主对话)。`extraSystem`: `You are a memory curator. Output bullet list of durable facts only.`

## 15. 隐私 & 安全

| 默认行为 | 说明 |
|---|---|
| API Key 加密存储 | 系统钥匙串(macOS / Windows / Linux libsecret) |
| API Key 从不离开本机 | 桌面端 IPC 直连厂商 endpoint;Web 端浏览器直发(可改 baseUrl 走自家代理) |
| 默认**不发数据** | 聊天面板"附带库结构"默认关闭;勾上后**只发** `tbl(col1 type, col2 type, ...)` 摘要,不发行数据 |
| Schema 6KB 上限 | 超过自动 `-- (truncated)` 截断,防 token 爆炸 |
| `request log` 可审计 | `Settings → AI → 请求日志`(桌面端 IPC 路径下完整记录) |
| 自带错误"问 AI"明确告知发哪些内容 | SQL 全文 + 错误码 + 连接元数据 + schema 提示 |

## 16. 费用控制

| 维度 | 配法 |
|---|---|
| 切换 provider | 聊天面板底部下拉 / `⌘K → 切换 AI provider` |
| 改 model | `Settings → AI Provider → <provider> → model`(便宜模型给行内补全 + Health Check,贵模型给建表 / 翻译) |
| 关行内补全 | `Settings → 补全` 总开关 — 复用 `enableCompletion`(高 token 消耗场景按需关) |
| 关向量记忆 | `Settings → AI → 记忆 → 向量记忆` 关掉 — 每条对话都会调 embedding,关掉省 embedding token |
| 关自动事实抽取 | `aiAutoExtractFacts` 关 — 不开则不会在每轮额外发抽取请求 |
| 长上下文 vs 短 | "附带库结构"按需勾选,问与库无关的事(`解释这个 SQL 语法`)时不必开 |

---

## 17. 行为对照速查

| 我想…… | 用哪个通道 |
|---|---|
| 多轮对话,边问边改 | **AiChatPanel** |
| 编辑器里现写现补 | **行内补全**(`aiInline.ts`) |
| 报错了想要快速诊断 | **错误"问 AI"按钮**(chat-bus) |
| 给一个表写迁移 / 优化 SQL / 解 EXPLAIN | **AiToolboxDialog** |
| 整库扫反模式 | **AiHealthCheckDialog** |
| 对一段慢 SQL / 错误信息 deep dive | **AiInsightsDialog** |
| 从业务描述设计多张表 | **AiSchemaArchitectDialog** |
| 给一段示例数据反推 schema | **AiSchemaReverseDialog** |
| 给所有列写中文注释 + 落库 | **AiCommentDialog** |
| 跨方言翻译 SQL / 存储过程 | **SqlTranslateDialog** |
| 给表填测试数据(语义类型 + FK 安全) | **MockDataDialog** |
| 给 AI 长期记忆 | **memory.ts → A/B/C 三档** |

配合 [高级特性](./advanced) 用威力翻倍 —— EXPLAIN 看不懂直接问 AI、索引推荐拿不准让 AI 解释、Oracle → DM 迁移翻译警告用 AI 评估风险。
