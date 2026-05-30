# 排错与兼容性

## 连接失败常见问题

### `ECONNREFUSED` — 连接被拒

- 数据库进程没起来 / 端口绑错
- 检查:`nc -zv <host> <port>` 或 `telnet`
- Docker 容器:`docker ps` 看是否 Up + 端口映射对不对

### `ETIMEDOUT` — 超时

- 防火墙 / 安全组 / VPN 阻塞
- SSH 隧道场景:跳板机不通

### `Authentication failed` — 认证失败

- 用户名 / 密码错
- MySQL `caching_sha2_password` 兼容性问题 — 升级 mysql2 或改用 `mysql_native_password`
- PG `pg_hba.conf` 不允许该来源

### Oracle `ORA-12541: TNS:no listener`

- Oracle 容器没起完或 LISTENER 没注册
- 等待 1-2 分钟后再试
- 检查 service name 是否正确(默认 XEPDB1,`gvenzl/oracle-free` 用 FREEPDB1)

### Oracle `ORA-00900: invalid SQL statement near 'v'`(连 OceanBase 时)

- 这是 **OceanBase Oracle 租户** 特征 — `VERSION()` 函数在 Oracle 模式不存在
- SkylerX v0.5+ 已修(改用 `SELECT 1 FROM DUAL` 探活)
- 旧版本:升级到最新

### Oracle `ORA-01950: insufficient quota on tablespace USERS`

新建的 Oracle 用户没 quota,插入 / 创建表都会失败。**修复**:

```sql
-- 用 SYSDBA 连接执行
ALTER USER "your_username" QUOTA UNLIMITED ON USERS;
-- 或更彻底
GRANT UNLIMITED TABLESPACE TO "your_username";
```

> ⚠️ Oracle 默认把 unquoted 标识符转大写,如果用户名是用双引号包的小写名(`"test"`),后续 ALTER 也必须用双引号 + 原大小写。

### MongoDB ObjectId 编辑不上

- 编辑网格修改 `_id` 字段会失败 — 通过 IPC 序列化后 ObjectId 变字符串,driver 不会自动 wrap
- SkylerX v0.5+ 已修:driver 层自动检测 24-hex 字符串 _id 并 wrap 成 ObjectId
- 旧版本:对真 ObjectId 主键的集合,临时改用 mongosh 编辑

## 错误码速查

### MySQL / MariaDB / TiDB / Doris / StarRocks

| errno | 含义 | 常见原因 |
|---|---|---|
| 1045 | Access denied | 用户名 / 密码错 |
| 1049 | Unknown database | 数据库不存在 |
| 1054 | Unknown column | 列名拼错 |
| 1062 | Duplicate entry | 唯一索引冲突 |
| 1064 | SQL syntax error | 语法错 |
| 1146 | Table doesn't exist | 表不存在 / 库选错 |
| 1213 | Deadlock | 死锁,重试 |
| 1264 | Out of range value | 列类型容不下值 |
| 2002 | Can't connect via socket | 主机 / 端口错 |
| 2003 | Can't connect to MySQL server | 连接被拒 |
| 2013 | Lost connection during query | 服务端崩 / 超时 |

### PostgreSQL / 兼容方言(KingbaseES / openGauss / CockroachDB / Greenplum / Redshift / H2)

SQLSTATE 5 位:

| code | 含义 |
|---|---|
| 23505 | unique violation |
| 23502 | not null violation |
| 23503 | foreign key violation |
| 42P01 | undefined table |
| 42703 | undefined column |
| 42601 | syntax error |
| 28000 | invalid authorization |
| 08001 | unable to connect |
| 40001 | serialization failure(重试) |
| 53300 | too many connections |

### Oracle / OB Oracle 租户 / DM 达梦

ORA-xxxxx 系列:

| code | 含义 |
|---|---|
| 00900 | invalid SQL statement |
| 00904 | invalid identifier |
| 00911 | invalid character |
| 00942 | table or view does not exist |
| 01017 | invalid username/password |
| 01950 | no privileges on tablespace |
| 12541 | TNS no listener |
| 12514 | service not found |
| 28000 | account locked |

## 性能慢

### 大结果集卡顿

- 默认页大小过大?降到 200-500 行,虚拟滚动会自动启用
- 列太多?隐藏不需要的列(右键列头 → 隐藏)

### 网络延迟高

- 远端连接慢:用 SSH 隧道压缩 / 跳板机就近部署
- AI 慢:换更近的 provider region(deepseek.com 国内快)

### SkylerX 启动慢

- 检查 `Settings → 启动` → 关闭"自动检查更新"
- macOS:`xattr -d com.apple.quarantine /Applications/SkylerX.app` 去除隔离属性

## 数据安全 / 隐私

- 密码加密 — 走 OS 钥匙串(macOS Keychain / Win DPAPI / Linux Secret Service)
- AI 默认**不发数据**,只发 schema hint
- 所有连接 / SQL 历史 / 片段 / 设置都本地 SQLite
- 不上传任何统计 / 遥测

## 升级常见问题

### 自动更新失败

- 网络问题:手动到 [Releases](https://github.com/duhbbx/SkylerX/releases) 下新版安装
- 权限问题:macOS 应用没写入权限,用管理员重新安装

### 升级后连接丢了 / 设置丢了

**不应该发生**。本地 SQLite 跨版本兼容。如果遇到,**别删旧版本数据目录**,先[提 Issue](https://github.com/duhbbx/SkylerX/issues),通常是路径迁移问题。

## 提交 Bug

如果上述都解决不了:

1. 在应用任意错误弹框点 "**✨ 问 AI**" 看 AI 能不能定位
2. 仍解决不了 → [GitHub Issues](https://github.com/duhbbx/SkylerX/issues/new)
3. Issue 内附:
   - SkylerX 版本(`Help → About`)
   - 操作系统 + 版本
   - 数据库类型 + 版本
   - 重现步骤
   - 完整错误信息

## 企业合作 / 私有化部署

- 信创环境深度适配(龙芯 / 飞腾 / 鲲鹏)
- 国密合规 / 等保部署
- 数据库迁移咨询(Oracle → 达梦 / KingbaseES)
- 内网定制版本

联系:`duhbbx@gmail.com` · WeChat `tuhoooo`
