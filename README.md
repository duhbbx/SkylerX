# SkylerX

跨平台桌面**数据库管理工具**（类 Navicat / DBeaver），Electron + Vue3 + Vite + TypeScript。

> **许可**：[Apache License 2.0](./LICENSE)。

## 支持的数据库

| 数据库 | 驱动 | 说明 |
| --- | --- | --- |
| MySQL / MariaDB / OceanBase | mysql2 | 纯 JS |
| PostgreSQL / 人大金仓 KingbaseES | pg | 协议兼容 |
| SQL Server | mssql | 纯 JS |
| Oracle | oracledb | 原生（thin 模式免 Instant Client），惰性加载 |
| 达梦 DM | dmdb | 原生，达梦官方分发，惰性加载 |

## 功能

- **Navicat 式导航树**：连接 → 库 → (schema) → 表/视图/函数… → 列/索引/键，目录带对象计数；树形由驱动按方言决定。连接可标 **环境**（dev/test/**prod**，prod 着红点）。
- **查询**：Monaco 编辑器（SQL 高亮 + 表/列/函数/片段自动补全）、多查询页签、SQL 历史（搜索/收藏）、库/schema 切换、服务端取消（KILL / pg_cancel）。
  - **⌘/Ctrl+Enter 执行**（有选区只跑选中语句）、**EXPLAIN 可视化执行计划**、SQL 格式化（⌘⇧F）、查询参数（`:name`）。
  - **SQL 片段库**（含标签筛选）、**生成 SQL 模板**（SELECT/INSERT/UPDATE/DELETE/复制表结构/新建索引/编辑注释）。
  - **prod 连接的高危操作**（DROP/DELETE/TRUNCATE/UPDATE）需键入连接名二次确认。
- **结果集**：分页、**大结果集虚拟滚动**、可编辑网格（多选行、改单元格、增删行 → 事务提交）、单元格查看器、列筛选、导出 CSV/JSON/SQL、**一键图表**（后续）。
- **对象管理**：可视化表设计器（字段/索引/外键/唯一键/检查 + SQL 预览，**改表时加载并 diff 现有索引/外键**）、新建视图/函数/存储过程、删除（含级联、批量多选）、表结构查看、**表统计信息**（行数/大小）、**生成测试数据**、**外键依赖关系**。
- **数据迁移 / 对比**：CSV / JSON / **Excel 导入**、导出表/库为 SQL、数据传输、**结构对比/同步**、**数据级对比/同步**（按主键生成 INSERT/UPDATE/DELETE）。
- **效率**：⌘K **命令面板**、⌘⇧O **全局对象搜索**（搜表/视图/列并在树中定位）、ER 图、**用户与权限（GRANT）**、设置中心（主题/字号/中英文 i18n）。
- **连接**：增删改、测试、本地 SQLite + safeStorage 加密存储、SSH 隧道、SSL、分组、连不上自动弹编辑框、自动更新（electron-updater）。

### 常用快捷键

| 快捷键 | 作用 |
| --- | --- |
| ⌘/Ctrl + K | 命令面板 |
| ⌘/Ctrl + ⇧ + O | 全局对象搜索 |
| ⌘/Ctrl + Enter | 执行（有选区只跑选中） |
| ⌘/Ctrl + ⇧ + F | 格式化 SQL |

## 结构

```
packages/
  shared-types/   跨端共用纯数据类型（DTO / 枚举 / 元数据 / 执行选项）
  core-driver/    数据库驱动抽象层 + 执行通道（LocalTransport 直连）
apps/
  desktop/        Electron + Vue3 + Vite + TS 桌面端（本地 SQLite 存配置）
```

架构详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 开发

```bash
pnpm install          # 安装依赖（首次会下载 Electron）
pnpm --filter @db-tool/desktop rebuild:native   # 首次按 Electron ABI 重建原生模块（better-sqlite3 等），仅需一次
pnpm dev:desktop      # 启动桌面端（electron-vite dev，热更新）
pnpm typecheck        # 全量类型检查
pnpm test             # 单元测试（Vitest：ddl / plan / schema-diff / data-diff / mockgen / privileges …）
pnpm lint             # Biome 规则检查（pnpm format 可自动格式化）
pnpm build:desktop    # 构建桌面端
```

CI（`.github/workflows/ci.yml`）在 push / PR 跑 typecheck + test + lint。

E2E 冒烟（opt-in，需先构建 + 重建原生模块，不在主 CI 跑）：

```bash
pnpm build:desktop
pnpm --filter @db-tool/desktop rebuild:native
pnpm e2e              # Playwright 启动 Electron，校验窗口 / 导航 / 命令面板渲染
```

## 打包

```bash
pnpm --filter @db-tool/desktop exec electron-vite build               # 生产构建 → apps/desktop/out
pnpm --filter @db-tool/desktop exec electron-builder install-app-deps # 按 Electron ABI 重建原生模块
pnpm --filter @db-tool/desktop exec electron-builder                  # 出当前平台安装包 → apps/desktop/release
```

三平台安装包由 CI 产出（`.github/workflows/build-desktop.yml`，matrix: macOS / Windows / Linux，tag `v*` 或手动触发）。打包注意：

- **依赖分类**：运行时原生/外部依赖（better-sqlite3 / mysql2 / pg / mssql）放 `dependencies`；构建期依赖（工作区包、monaco、vue）放 `devDependencies`——electron-builder 只打包 `dependencies`。
- **pnpm monorepo**：electron-builder 需 `node-linker=hoisted`（CI 已设 `NPM_CONFIG_NODE_LINKER=hoisted`）。
- **node-gyp**：Python ≥3.12 缺 `distutils`，CI 固定 Python 3.11。
- 首次本地打包需联网下载 Electron 发行包（约 100MB）。

> Oracle / 达梦为原生模块（惰性加载），纳入打包需在对应平台安装其驱动并 electron-rebuild。

## 许可

[Apache License 2.0](./LICENSE) —— 桌面端开源。
