# 连接管理

## 新建连接

⌘N / Ctrl+N 或左上角"新建连接"按钮 → 弹出表单。

### 基础字段(所有方言)

| 字段 | 说明 |
|---|---|
| 连接名 | 显示用,任意 |
| 方言 | 数据库类型(MySQL / PG / Oracle / ...) |
| 主机 | hostname 或 IP |
| 端口 | 默认按方言自动填(MySQL 3306 / PG 5432 / Oracle 1521 ...) |
| 用户 | 用户名 |
| 密码 | 留空保存,首次连接时再问 |
| 数据库 | 默认连接的库 / schema,可留空 |
| 分组 | 连接树根层的文件夹,便于管理多套环境 |
| 环境标记 | dev / test / prod — prod 会触发[生产保护](#生产保护) |

### 方言专属字段

#### Oracle / OB Oracle 租户

| 字段 | 说明 |
|---|---|
| Service Name | 默认 XEPDB1,容器 `gvenzl/oracle-free` 用 FREEPDB1 |
| privilege | SYSDBA / SYSOPER / SYSASM / SYSBACKUP / SYSDG / SYSKM / SYSRAC,普通连接留空 |

> **SYSDBA 登录** Oracle 通常连 CDB 根(`FREE` 而不是 `FREEPDB1`)。

#### Snowflake

| 字段 | 说明 |
|---|---|
| Account | `xy12345.us-east-1` 这种 Snowflake 标识符 |
| Warehouse | 计算仓 |
| Role | 默认角色 |
| Schema | 默认 schema |
| Authenticator | 默认 password,或 `snowflake_jwt` 私钥 |
| Private Key Path | 私钥 PEM 文件(JWT 模式时显示) |
| Private Key Passphrase | 私钥口令(若有) |

#### MongoDB

可选**URI 直填模式**:`mongodb://user:pass@host:27017/db?replicaSet=rs0`,填了之后忽略 host/port/user/password。

#### SQLite / DuckDB

不需要 host/port/user,只需要**数据库文件路径**:
- 旁边有"浏览…"按钮调系统文件选择对话框
- 允许选不存在的文件名(自动创建新库)
- 空 → 内存模式 `:memory:`(应用关闭即丢)

#### ClickHouse

| 字段 | 说明 |
|---|---|
| URL | 完整 URL(`https://user:pass@host:8443/...`),填了忽略 host/port |
| Show System Databases | 默认隐藏 `system` / `information_schema` 库 |

#### Redis

只需 host/port/password/dbIndex。SkylerX 自动展开 16 个逻辑库(db0..db15)。

#### H2

只支持 **PG-server 模式**。H2 启动需加 `-pg` 参数:

```bash
java -cp h2-2.x.x.jar org.h2.tools.Server \
  -pg -pgPort 5435 -ifNotExists -baseDir ./data
```

然后连接:Host=localhost,Port=5435,User=`sa`,Password=空。

## SSH 隧道

数据库在跳板机后面?切到 **SSH 标签页** → 启用 SSH 隧道:

- SSH 主机 / 端口 / 用户
- 鉴权:**密码** 或 **私钥**(`~/.ssh/id_rsa` 之类)二选一
- 私钥口令(若加密)

SkylerX 自动起一条 SSH 隧道,然后通过它连数据库。

## SSL / TLS

切到 **SSL 标签页** → 启用 SSL:

- 是否校验服务端证书
- CA / 证书 / 密钥(粘 PEM 文本或选文件)

## Manual Commit 手动提交模式

`Settings → 全局默认提交模式` 或 **每连接 → 高级 → 提交模式**:

- `auto`(默认):每条 SQL 立即提交
- `manual`:用户必须显式按"提交 / 回滚",SkylerX 钉一个长连接维持事务

适合数据修复 / 关键迁移场景,**生产连接强推 manual**。

## 测试连接

表单底部"测试连接"按钮 → 实时反馈:
- ✅ 成功 + 显示服务端版本 + 往返延迟
- ❌ 失败 + 错误码 + 自动分类("连接被拒"/"DNS"/"超时"/"认证"/"SSL"等)+ 排查步骤

测试失败的弹框上点**"✨ 问 AI"** → 自动把错误 + 连接元数据扔给 AI 助手。

## 生产保护(`env=prod`)

标记为 prod 的连接享有额外保护:

- 树根层用红色徽章显示 `[prod]`
- 执行 `DROP TABLE / DATABASE / INDEX` / `TRUNCATE` / 无 WHERE 的 `UPDATE/DELETE` 时,**强制要求键入连接名**才能继续
- AI 在 prod 上回答更保守(默认 SELECT-only 风格)

环境标记的判定是**纯本地配置**,不影响数据库本身。

## 密码加密存储

密码使用 OS 钥匙串加密:

- **macOS**:Keychain Access
- **Windows**:DPAPI(基于当前用户登录态)
- **Linux**:Secret Service(GNOME Keyring / KWallet)

万一钥匙串不可用,会 fallback 到 base64 编码(明显标记 `plain:` 前缀,**警告不安全**)。**生产环境强烈建议**保证钥匙串可用。

## 分组管理

每个连接可以挂在一个**分组**下(可选),根树会按分组折叠:

```
📁 开发环境
   ├── 本地 MySQL
   └── 本地 PostgreSQL
📁 测试环境
   └── 测试 OceanBase
📁 生产环境  ⚠
   └── prod-mysql [prod]
```

新增连接时在"分组"字段输入名称即可(回车确认)。

## 多窗口(并行查询多个连接)

⌘⇧N / Ctrl+Shift+N 开一个新 SPA 窗口 → 加载同一份配置库,两个窗口各连各的,互不干扰。

适合"左 prod 右 staging 对照查"的场景。

## 删除连接

右键连接 → 删除 → 二次确认 → SQLite 里清除记录 + Keychain 同步清。

数据库本身**不受影响**,删除只是 SkylerX 这边的连接配置消失。
