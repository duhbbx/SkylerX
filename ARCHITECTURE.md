# SkylerX 架构（桌面端）

类 Navicat/DBeaver 的桌面数据库管理工具。Electron + Vue3 + Vite + TypeScript，本地 SQLite 存连接配置。

## 模块

```
packages/
  shared-types/   纯数据类型（DTO / 枚举 / 元数据 / 执行选项）；可序列化，跨进程边界
  core-driver/    ★ 数据库驱动抽象层 + 执行通道
apps/
  desktop/        Electron 桌面端（main / preload / renderer）
```

## core-driver 分层

```
SqlTransport        —— SQL「在哪执行」：LocalTransport 进程内直连（AgentTransport 为内网 agent 预留）
  └─ DatabaseDriver —— 「如何跟某方言说话」：connect / execute / executeBatch / fetchMetadata / cancelActive
       └─ 原生驱动 （mysql2 / pg / mssql / oracledb / dmdb）
```

- **注册中心**：各方言驱动注册到 registry，按 `DbDialect` 取用。新增方言 = 新增驱动文件 + 注册一行，上层无感。
- **方言驱动**：MySQL 系（mysql2）、PostgreSQL 系（pg）、SQL Server（mssql）静态加载；Oracle（oracledb，thin 模式）、达梦（dmdb）为原生模块，**惰性 import**，未安装时仅在连接该库时报错，不影响其它方言。
- **导航树形由驱动决定**：`fetchMetadata(scope)` 按父节点类型 + 方言返回子节点，因此不同库天然不同树形（MySQL 库→分组→表→列/索引/键；PG 多一层 schema；Oracle 顶层即 schema）。目录节点带对象计数。
- **执行通道**抽象让"直连 vs agent"成为部署选择而非代码分支；桌面端恒为 LocalTransport。

## 桌面端

```
渲染进程(Vue3 + Monaco)
   │  contextBridge 暴露的 window.api（无 Node 权限）
   ▼  ipcRenderer.invoke
主进程(Node)  registerConnectionIpc → getTransport()(LocalTransport + core-driver)
   ├─ 本地 SQLite（better-sqlite3）：连接配置 / 查询历史；密码经 Electron safeStorage 加密
   └─ 直连目标数据库
```

- **渲染进程**：导航树（递归 TreeItem + provide/inject 控制器 + 声明式右键动作目录）、Monaco 编辑器（表/列自动补全）、多查询页签、可编辑结果网格、表设计器等。
- **主进程**：IPC handler → `SqlTransport`；连接配置存本地 SQLite，密码 safeStorage 加密；执行/分页/批量事务/取消/元数据。
- **preload**：`contextBridge` 暴露受限 `window.api`（contextIsolation 开、nodeIntegration 关）。

## 关键能力实现

- **分页**：驱动对 SELECT 包子查询加 LIMIT/OFFSET（`ExecuteOptions.limit/offset`）。
- **可编辑网格**：单表 SELECT 结果 → 整行原值匹配生成 UPDATE/INSERT/DELETE → `executeBatch` 单连接事务提交。
- **查询取消**：执行时记录 MySQL `threadId` / PG backend pid，另开连接 `KILL QUERY` / `pg_cancel_backend`。
- **连接稳健性**：连接超时、池错误兜底、退出释放池。

## 原生模块打包
better-sqlite3 等需按 Electron ABI 重建（`electron-builder install-app-deps`）；pnpm monorepo 下打包需 `node-linker=hoisted`；Python ≥3.12 缺 distutils，用 3.11/3.9 编译。三平台安装包见 `.github/workflows/build-desktop.yml`。
