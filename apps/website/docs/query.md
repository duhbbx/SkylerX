# SQL 编辑器

## 打开查询页

- ⌘T / Ctrl+T:新建查询 tab
- 双击表名 → 默认打开数据网格(等价于 `SELECT * FROM table LIMIT 200`)
- 右键表 → "新建查询",编辑器里预填 `SELECT * FROM ...`

## 编辑器能力

基于 Monaco(VS Code 同款),SQL 方言主题。

### 自动补全

按 `Ctrl+Space` 或键入时自动触发,补全:

- SQL 关键字 / 内建函数
- 当前连接所有数据库 / schema 名
- 已经在 FROM / JOIN 里引用的表的列名
- 已保存的 SQL 片段(片段名作触发词)

### 格式化

⌘⇧F / Ctrl+Shift+F 一键格式化(sql-formatter 驱动)。支持按方言风格(MySQL / PG / Oracle 各有偏好)。

### 参数化

支持 `:name` 命名参数。执行时弹框提示填值:

```sql
SELECT * FROM orders
 WHERE user_id = :uid
   AND created_at >= :start
```

执行后弹框输入 `uid` 和 `start`,SkylerX 自动转成驱动支持的形式(`?` 或 `$1` 等)。

### SQL 片段库

`⌘K → 片段` 或左侧"片段"面板:

- 保存常用 SQL(命名 + 描述 + 标签)
- 按标签过滤
- 双击插入到当前编辑器,或拖拽到任意 tab

## 执行

| 快捷键 | 行为 |
|---|---|
| ⌘+Enter / Ctrl+Enter | 执行(选中部分则只跑选中,否则跑全部) |
| 工具栏"执行"按钮 | 同上 |
| 工具栏"取消" | 服务端取消(MySQL `KILL QUERY` / PG `pg_cancel_backend`) |

多语句自动按 `;` 拆分,按顺序执行,任一失败停下并红色高亮失败语句。

## SQL Linter 风险拦截

执行前自动跑规则引擎:

| 严重度 | 规则 | 行为 |
|---|---|---|
| error | UPDATE / DELETE 无 WHERE | 弹"危险 SQL"确认框 |
| error | prod 连接 DROP TABLE / DATABASE | 弹确认 |
| warn | TRUNCATE 在 prod | toast 警告 |
| warn | 多表 FROM 无 ON | toast |
| info | `SELECT *` | console 留痕 |
| info | 没有 LIMIT 的 SELECT | console 留痕 |

**Lint 优先于"prod 强确认"**,避免一条无 WHERE 的 UPDATE 同时触发两个弹框打扰用户。

## EXPLAIN 可视化

工具栏 **解释** 按钮(或 `EXPLAIN+` 切换 ANALYZE 真跑):

- 节点树展示执行计划
- 预估行 / 实际行对比(ANALYZE 模式)
- 慢算子按耗时染色:绿(< 100ms) / 黄(< 1s) / 红(> 1s)
- 可选导出为 PNG / Markdown 分享

## AI 行内补全(Copilot 风格)

`Settings → AI Provider` 配好后自动启用:

- 光标停顿 600ms 触发
- 在飞请求会被新触发立即 cancel
- Tab 接受,Esc/Backspace 取消
- 默认与"SQL 自动补全"共用总开关(`Settings → 补全`)

## 错误自动求助 AI

执行失败时:

- 结果区显示完整错误 + SQLSTATE / errno
- 顶部"**✨ 问 AI**"按钮 → 把当前 SQL + 错误 + 连接元数据塞进 AI 聊天面板,自动开聊
- 任何 alert 弹框也都有"问 AI"按钮

## 查询历史

`⌘K → 历史` 或左侧"历史"面板:

- 按时间倒序
- 显示连接 / SQL 摘要 / 耗时 / 成功状态
- 双击重新打开
- 收藏 / 搜索

## 收藏

⭐ 按钮把当前 SQL 加进收藏夹:

- 自定义名称 + 标签
- 跨连接也可用
- 命令面板 ⌘K → "收藏"快速访问

## 多 tab 管理

- 中键单击 tab → 关闭
- 右键 → 复制 / 移到另一窗口 / 钉住 / 关闭右侧所有
- 拖拽重排
- 钉住的 tab 应用重启后仍保留
