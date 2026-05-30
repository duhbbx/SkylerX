# 快速开始

5 分钟从下载到第一次成功查询。

## 1. 下载并安装

前往 [下载页](/download) 选择对应平台的安装包:

- **macOS**:`.dmg` 文件,拖到 Applications 即可
- **Windows**:`.exe` 安装向导,一路 Next
- **Linux**:`.AppImage`(免安装,`chmod +x` 后直接跑)或 `.deb` / `.rpm`(`sudo dpkg -i` / `sudo rpm -ivh`)

首次启动后会自动初始化本地配置库(SQLite,位于 OS 标准用户数据目录)。

## 2. 新建第一个连接

启动应用 → 左上角"新建连接"(⌘N / Ctrl+N) → 选择方言。

### MySQL / PostgreSQL 等主流方言

| 字段 | 示例 |
|---|---|
| 连接名 | 本地开发库 |
| 方言 | MySQL |
| 主机 | 127.0.0.1 |
| 端口 | 3306(MySQL 默认) |
| 用户 | root |
| 密码 | (你的密码) |
| 数据库 | (可选,留空则连后自己选) |
| 环境标记 | dev / test / prod |

点"测试连接"→ 成功后点"保存"。

### Oracle / OB Oracle 租户

Oracle 需要填 Service Name(默认 `XEPDB1`,容器化 `gvenzl/oracle-free` 用 `FREEPDB1`):

| 字段 | 示例 |
|---|---|
| 方言 | Oracle |
| 主机 | 127.0.0.1 |
| 端口 | 1521 |
| 用户 | system |
| 密码 | oracle |
| 数据库 / Service | FREEPDB1 |
| 高级 → privilege | (留空 = 普通)或 SYSDBA / SYSOPER 等 |

### 国产信创数据库

- **达梦 DM**:端口 5236,需安装 `dmdb` npm 包(`pnpm -F @db-tool/desktop add dmdb`)
- **人大金仓 KingbaseES**:端口 54321(默认),走 PG 兼容,无需额外驱动
- **openGauss**:走 PG 兼容,无需额外驱动
- **OceanBase**:端口 2881,走 mysql2 — Oracle 租户也用此方言

详细字段说明见 [连接管理 →](/docs/connections)

## 3. 浏览导航树

连接列表里**双击连接** → 左侧导航树自动展开:

```
📦 本地开发库 (MySQL)
  └── 📁 mydb
       ├── 📁 表 (12)
       │    ├── users
       │    ├── orders
       │    └── ...
       ├── 📁 视图 (3)
       ├── 📁 函数 (1)
       └── 📁 存储过程 (0)
```

**双击表名** → 默认打开数据网格(SELECT 前 200 行,可改 [Settings → 默认页大小])。

## 4. 写 SQL 并执行

- 工具栏点"新建查询"或 ⌘T / Ctrl+T 开一个新 SQL 标签页
- Monaco 编辑器自动补全表名 / 列名 / 关键字
- ⌘+Enter / Ctrl+Enter 执行(选中部分则只执行选中)
- 结果在下方网格里展示

### 几个常用快捷键

| 操作 | macOS | Windows / Linux |
|---|---|---|
| 命令面板 | ⌘K | Ctrl+K |
| 全局对象搜索 | ⌘⇧O | Ctrl+Shift+O |
| 执行 SQL | ⌘+Enter | Ctrl+Enter |
| 格式化 SQL | ⌘⇧F | Ctrl+Shift+F |
| 切换 AI 聊天面板 | ⌘⇧L | Ctrl+Shift+L |
| 新窗口(开第二个会话) | ⌘⇧N | Ctrl+Shift+N |

全部快捷键在 `Settings → 键绑定` 里可自定义。

## 5. 配置 AI 助手(可选)

`Settings → AI Provider` → 添加任一支持的 provider:

- Anthropic(Claude 系列)
- OpenAI(GPT-4 / o1 系列)
- DeepSeek
- Codex
- Grok / xAI

填 API Key 后即可使用:
- 右侧聊天面板(⌘⇧L 切换)
- 编辑器内行内补全(Copilot 风格)
- 任意错误弹框点 "✨ 问 AI" 自动定位修复
- 7 个专业 Toolbox(写迁移 / 调优 / 解读 EXPLAIN / 生成测试数据 / 自然语言→SQL / 写注释 / 解读表用途)

## 6. 体验进阶

- [SQL 编辑器深入](/docs/query) — 自动补全 / 片段库 / EXPLAIN
- [结果集网格](/docs/grid) — 可编辑模式 / 过滤 / 着色 / 导出
- [AI 助手](/docs/ai) — provider 配置 / 记忆系统 / Toolbox 详解
- [排错与兼容性](/docs/troubleshooting) — ORA-xxx / SQLSTATE 常见错误自动定位

## 遇到问题?

- 应用任意错误弹框上点"**✨ 问 AI**" — 自动把 SQL + 错误信息 + 连接元数据扔给 AI
- 仍解决不了:[GitHub Issues](https://github.com/duhbbx/SkylerX/issues)
