# 安全与合规

SkylerX 同时面向 dev / test / prod 三类环境,内置一套**从连接凭证到结果集渲染、从 SQL 提交到批量导出**的端到端安全模型。本页把代码里实际落地的每一道防线讲清楚:它做了什么、不做什么、能给运维和合规审计提供哪些证据。

## 1. 概述

SkylerX 的安全模型按"数据流向"分成五段,每一段都有专门的代码兜底:

| 阶段 | 模块 / 文件 | 主要职责 |
|---|---|---|
| 凭证落地 | `apps/desktop/src/main/db/connectionStore.ts` | 密码 / SSH 私钥用 OS 钥匙串(Electron `safeStorage`)加密入库 |
| 环境识别 | `packages/ui/src/connEnv.ts` | dev / test / prod 三色标记 + 只读连接 + 读语句白名单 |
| 语句拦截 | `packages/ui/src/sqlLint.ts` | 7 条启发式规则(无 WHERE 的 UPDATE/DELETE、prod 上的 DROP/TRUNCATE 等) |
| 数据呈现 | `packages/ui/src/masking.ts` + `DataMaskingViewDialog` | 列名模式匹配 → 渲染时遮罩 + 落库的脱敏视图 |
| 治理 / 审计 | `compliance.ts` / `PiiScannerDialog` / `DataContractDialog` / `export-encrypt.ts` | 等保合规检查、PII 扫描、数据契约、加密导出 |

下面按代码事实逐段说明。

## 2. 连接密码加密(OS 钥匙串)

代码位置:`apps/desktop/src/main/db/connectionStore.ts`

新建 / 编辑连接时,密码不会以明文落到 SQLite,而是走 Electron 的 `safeStorage`(macOS = Keychain、Windows = DPAPI、Linux = libsecret / kwallet):

```ts
function encryptPassword(plain?: string): string | null {
  if (!plain) return null
  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(plain).toString('base64')}`
  }
  return `plain:${Buffer.from(plain, 'utf8').toString('base64')}`
}
```

存储字段一律带前缀,方便后续识别版本:

| 前缀 | 含义 | 何时出现 |
|---|---|---|
| `enc:` | OS 钥匙串密文 | 正常路径,macOS / Windows / 绝大多数 Linux |
| `plain:` | base64 兜底(**只用于 dev**) | `safeStorage.isEncryptionAvailable()` 返回 `false` 时,常见于裸 Linux 容器、缺 libsecret / kwallet |
| 其它 | 旧版本未加前缀的兼容字段 | 历史数据 |

> **重要:** 见到 `plain:` 时,SkylerX 仍能工作,但**等同于明文**。建议在 Linux 上装 `gnome-keyring` 或 `kwallet`,然后让用户重新编辑一次连接(任意改动后保存会触发重新加密)。

### SSH 隧道密钥

SSH 配置含 `password` / `privateKey` / `passphrase` 三项,整体走同一加密链。**列表回显时(`listConnections`)主动剥掉密钥字段**,避免内存里冗余携带:

```ts
function decryptSsh(stored, withSecrets) {
  const ssh = JSON.parse(decryptPassword(stored)) as SshConfig
  return withSecrets
    ? ssh
    : { ...ssh, password: undefined, privateKey: undefined, passphrase: undefined }
}
```

只有真正发起连接 / 编辑回填表单时(`getConnection`)才会带回完整密钥。

## 3. 环境标记 dev / test / prod + 生产保护

代码位置:`packages/ui/src/connEnv.ts`

连接配置里 `extra.env` 字段存三态枚举:

| 值 | UI 标签 | 颜色 (`ENV_META.color`) | 默认严格度 |
|---|---|---|---|
| `dev` | 开发 | `#4caf50` 绿 | 标准 |
| `test` | 测试 | `#e0a020` 橙 | 标准 |
| `prod` | 生产 | `#e04050` 红 | **触发额外 SQL 规则 + 执行前二次确认** |

### 整连接只读(`extra.readOnly`)

只读连接由 `connReadOnly()` 标记。SkylerX 在两处独立把关:

1. **整连接级别**:`isReadOnlyStatement(sql)` 用首关键字白名单(`select` / `with` / `show` / `explain` / `desc(ribe)` / `pragma`)拦截写语句,不在白名单一律不允许发到服务器。
2. **提交模式**:只读连接强制 `auto` commit(手动事务对只读连接无意义);见 `initialCommitMode()`。

### 生产水印

`Settings → 生产水印` 可自定义文案 / 角度 / 透明度 / 颜色,在 prod 连接的所有视图(SQL 编辑器、结果集、导出预览)叠加 SVG 水印,防截图扩散。

## 4. SQL Linter — 7 条内置规则

代码位置:`packages/ui/src/sqlLint.ts`

启发式纯字符串扫,不做完整 parser,只命中"明显危险"模式。结果分三级:

| Severity | UI 反馈 | 仍执行? |
|---|---|---|
| `error` | 弹模态二次确认 | 用户点确认才执行 |
| `warn` | toast 提示 | **会执行**(只是提示) |
| `info` | 调用方决定(可在编辑器边栏挂角标) | 会执行 |

完整规则表:

| 规则 ID | Severity | 触发条件 | 提示 |
|---|---|---|---|
| `no-where-update` | error | `UPDATE` 起头 + 没有 `WHERE` | UPDATE 缺少 WHERE 子句,将更新整张表 |
| `no-where-delete` | error | `DELETE FROM` + 没有 `WHERE` | DELETE 缺少 WHERE 子句,将清空整张表 |
| `prod-drop` | error | 连接 env=prod + `DROP TABLE/DATABASE/SCHEMA/INDEX/VIEW` | 生产环境执行 DROP XXX |
| `prod-truncate` | warn | 连接 env=prod + `TRUNCATE` | 生产环境执行 TRUNCATE |
| `cross-join` | warn | `SELECT` + `FROM a, b`(逗号 JOIN)或 `JOIN` 无 `ON/USING` | 多表查询未指定连接条件(疑似笛卡尔积) |
| `select-star` | info | `SELECT *` | SELECT * 建议显式列出列名 |
| `forgotten-limit` | info | `SELECT` 无 `LIMIT` / `FETCH FIRST` / `TOP n` / `COUNT()` | SELECT 没有 LIMIT,可能拉回大量数据 |

### 规则的"廉价"约束

注释剥离用最朴素的两条 regex(`/\/\*[\s\S]*?\*\//g` 和 `/--[^\n]*/g`)确保 `-- WHERE 1=1` 这种伪 WHERE 不会骗过 linter。所有规则都是 O(n) 字符串扫,在执行热路径上跑也不会拖慢用户。

### 多语句聚合

`lintStatements(stmts, ctx)` 把同 id 的 finding 按 severity 最高的保留一次,适合"复制一段 SQL 文件全选执行"场景。

## 5. 数据契约(notNull / range / regex)

代码位置:`packages/ui/src/components/DataContractDialog.vue`

数据契约是给"业务字段不该出现的值"提前埋点。一条契约由四部分组成:

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 用户起的契约名 |
| `table` | string | 适用的 `schema.table` |
| `notNull` | `string[]` | 这些列不能 NULL |
| `range` | `Record<string, [min, max]>` | 数值范围,`null` 表示无限 |
| `regex` | `Record<string, string>` | 列值必须命中的正则 |
| `enabled` | boolean | 启用开关 |

存储 `localStorage.skylerx.dataContracts`,JSON 数组。

### 典型用法

```json
{
  "name": "用户表完整性",
  "table": "public.users",
  "notNull": ["phone", "email"],
  "range": { "age": [0, 150] },
  "regex": { "email": "^[^@]+@[^@]+$", "phone": "^1\\d{10}$" },
  "enabled": true
}
```

### 导入 / 导出

- 点 **📋 导出** → 拷贝 JSON 到剪贴板,可贴到团队共享文档 / git 仓库
- 点 **📥 导入** → 粘贴 JSON 覆盖当前列表

这样 DBA 写好契约后,可以按团队 / 项目分发给开发,落到本地 SkylerX 后自动生效。

## 6. 敏感字段扫描(PII Scanner)

代码位置:`packages/ui/src/components/PiiScannerDialog.vue`

两段式启发:**列名匹配 → 抽样验证**。

### 列名匹配阶段

走 `DEFAULT_MASK_RULES`(见下一节)的 `columnPattern` 正则。例如列名 `user_phone` 会命中 `(phone|mobile|tel|手机|电话)`,归类为 `phone`。

### 抽样验证阶段(可选)

对命中的列拉前 N 行(默认 50,可改 10-1000),用正则二次确认:

| kind | 抽样校验正则 |
|---|---|
| `phone` | `/^\+?[\d\s\-()]{7,20}$/` |
| `email` | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| `idCard` | `/^\d{15}$\|^\d{17}[\dxX]$/` |
| `bankCard` | `/^\d{12,19}$/` |
| `name` / `address` / `default` | 无,只走列名 |

命中率 < 30% 视为"列名巧合,实际不是 PII",从报告里剔除。

### 报告与下一步

报告按"命中数倒序"分组到表,可 **📋 导出 CSV**(列:schema/table/column/data_type/rule/kind/sample)。CSV 可直接交给合规审计;也可以右键库 → "脱敏视图生成"挑这些列建脱敏视图。

## 7. 数据脱敏视图(DataMaskingViewDialog)

代码位置:`packages/ui/src/masking.ts` + `packages/ui/src/components/DataMaskingViewDialog.vue`

### 7.1 内置遮罩规则

`DEFAULT_MASK_RULES` 是规则基线,用户可以在 `Settings → 数据脱敏` 里删 / 改 / 加自定义规则。

| 规则名 | columnPattern | kind | 默认启用 | 算法 |
|---|---|---|---|---|
| 手机号 | `(phone\|mobile\|tel\|手机\|电话)` | phone | ✅ | 前 3 + `****` + 后 4 |
| 邮箱 | `(email\|mail\|邮箱)` | email | ✅ | 首字母 + `***@domain` |
| 身份证 | `(id_?card\|身份证\|idno)` | idCard | ✅ | 前 6 + `*…` + 后 4 |
| 银行卡 | `(bank_?card\|card_?no\|账号\|账户)` | bankCard | ✅ | 前 4 ` **** **** ` 后 4 |
| 姓名 | `(real_?name\|user_?name\|full_?name\|姓名)` | name | ❌ | 首字 + `*`(其余隐藏) |
| 地址 | `(address\|addr\|地址)` | address | ❌ | 前 6 字 + `***` |
| 密码 / Token | `(password\|passwd\|secret\|pwd\|token\|api_?key\|密码)` | default | ✅ | 前 2 + `****` + 后 2 |

### 7.2 渲染时遮罩 vs. 入库脱敏视图

SkylerX 提供两种独立的脱敏路径:

- **渲染时遮罩**:`Settings → 数据脱敏 → 启用`。前端按列名 → 规则 → 算法即时遮罩,**不动数据库**,导出时可在导出对话框选"原文 / 脱敏"。
- **入库脱敏视图**(`DataMaskingViewDialog`):生成 `CREATE OR REPLACE VIEW ... AS SELECT mask_expr(c) ...` SQL 落到库里,**应用方走视图,不直接读原表**。可用六种策略:

| 策略 | 生成的 SQL 表达式(MySQL 示例) |
|---|---|
| `raw` 原样 | `` `c` AS `c` `` |
| `md5` | `` md5(CAST(`c` AS char(4000))) AS `c` `` |
| `partial` 前 N 后 M | `` CONCAT(LEFT(`c`,N), '***', RIGHT(`c`,M)) AS `c` `` |
| `fixed` 替换 | `'***' AS \`c\`` |
| `truncate` 截断 | `` LEFT(`c`, max) AS `c` `` |
| `null` | `` NULL AS `c` `` |

对话框打开时按列名调用 `recommendStrategy(colName)` 给出推荐;用户可逐列覆盖。生成 SQL 可手工编辑后再执行(点 ▶ 创建视图)。

## 8. 等保 2.0 合规检查

代码位置:`packages/ui/src/compliance.ts` + `packages/ui/src/components/ComplianceDialog.vue`

按"能从数据库连接直接验证"的项做,不涉及防火墙 / 磁盘加密这类操作系统层的事。结果四态:

| Severity | 含义 |
|---|---|
| `pass` ✅ | 合规 |
| `warn` ⚠️ | 不合规但风险可控(如审计未启、SSL 关闭) |
| `fail` ❌ | 严重违规(如 root 远程开放、空密码用户) |
| `unknown` — | 无法判断(权限不足、商业版才有的特性) |

### MySQL 系(MySQL / MariaDB / OceanBase / TiDB)— 7 条

| ID | 大类 | 标题 | 探测方式 |
|---|---|---|---|
| `mysql.auth.password-policy` | 身份鉴别 | 强制使用强密码策略 | `SHOW VARIABLES LIKE 'validate_password%'`,policy ≥ MEDIUM 且 length ≥ 8 |
| `mysql.audit.enabled` | 安全审计 | 审计日志已启用 | `audit_log_*`(企业版)或 `server_audit_*`(MariaDB) |
| `mysql.auth.root-remote` | 访问控制 | root 不允许远程登录 | `SELECT user, host FROM mysql.user WHERE user='root'` |
| `mysql.auth.anonymous` | 访问控制 | 不存在匿名用户 | `mysql.user WHERE user=''` |
| `mysql.transport.ssl` | 数据完整性 | 强制 SSL 传输 | `require_secure_transport=ON` |
| `mysql.audit.slowlog` | 安全审计 | 慢查询日志开启 | `slow_query_log=ON` |
| `mysql.integrity.binlog` | 数据完整性 | binlog 已启用 | `log_bin=ON`(时间点恢复 / 主从复制前提) |

### PostgreSQL 系(PG / KingbaseES / openGauss / Greenplum / CockroachDB)— 6 条

| ID | 大类 | 标题 | 探测方式 |
|---|---|---|---|
| `pg.auth.password-encryption` | 身份鉴别 | 密码加密算法使用 SCRAM-SHA-256 | `SHOW password_encryption` |
| `pg.audit.pgaudit` | 安全审计 | 已安装 pgaudit 审计扩展 | `pg_extension WHERE extname='pgaudit'` |
| `pg.transport.ssl` | 数据完整性 | SSL 已启用 | `SHOW ssl` |
| `pg.access.superuser-count` | 访问控制 | 超级用户数量受控(≤ 2) | `SELECT rolname FROM pg_roles WHERE rolsuper` |
| `pg.audit.log-statement` | 安全审计 | log_statement 已配置 | `SHOW log_statement` ≠ none |
| `pg.auth.empty-password` | 身份鉴别 | 不存在空密码的可登录用户 | `pg_authid WHERE rolpassword IS NULL AND rolcanlogin` |

### Markdown 报告导出

点 **导出 Markdown** 调用 `renderReport()`,按大类分组、附"汇总: ✅ N · ⚠️ N · ❌ N · — N"统计行 + 每条规则的描述 / 结论 / `evidence` 原始证据。文件名自动套连接名 + 时间戳:`compliance-<safeName>-<YYYY-MM-DDTHH-MM-SS>.md`。

### 并发执行

点"开始检查"会 `Promise.all` 并行跑所有规则,失败不影响其它项(`try/catch` 兜底为 `unknown`),驱动层自己排队 / 复用连接。

### 其它方言

非 MySQL / PG 系会进入占位条目:

```
当前方言暂未提供合规检查 — 请人工确认
```

后续按需补充 Oracle / SQL Server / SQLite / 达梦的规则。

## 9. 国密 SM2 / SM3 / SM4(规划中)

合规规则集里已经把"`password_encryption=md5` 被国密 / 等保视为弱算法"作为告警判据(见 `pg.auth.password-encryption` 描述)。SM2 / SM3 / SM4 的辅助 API(用于数据落库前在应用层做国密加签 / 加密)目前 **未发布**,计划在 v0.6 提供独立的 `cryptoCn.ts` 工具模块:

- SM2 椭圆曲线签名 / 加解密(基于 sm-crypto)
- SM3 消息摘要
- SM4 对称分组加密(CBC / ECB)

接口签名稳定后会补到本页"国密辅助 API"章节。

## 10. 加密导出 .skbk

代码位置:`packages/ui/src/export-encrypt.ts`

把任意文本(通常是 SQL dump 或连接配置)用密码加密成单行 JSON 文件,后缀 `.sql.enc` / `.skbk`。

### 算法栈

| 阶段 | 算法 | 参数 |
|---|---|---|
| 密钥派生 | PBKDF2-HMAC-SHA-256 | iter = `DEFAULT_ITER` = **200 000**(可调,头里记录) |
| 加密 | AES-GCM 256 | salt 16 字节 + iv 16 字节,每次重新生成 |
| 完整性 | AES-GCM 内置 128-bit auth tag | 密码错 / 文件被改 → 解密时直接抛 `WRONG_PASSWORD` |
| 文件头 | `magic: 'SKYLERX-ENC-v1'` | 升级算法 / 参数时用于识别版本 |

> **PBKDF2 iter 选 200 000 的取舍**:OWASP 2023 推荐 SHA-256 ≥ 600 000,但桌面端要兼顾老机器(Atom CPU 上 600k 会卡 1+ 秒),取折中。如果你导出的内容极度敏感,可以在调用 `encryptText` 时手工提高 iter 字段。

### 序列化格式

```json
{
  "magic": "SKYLERX-ENC-v1",
  "salt": "<base64 16B>",
  "iv":   "<base64 16B>",
  "iter": 200000,
  "data": "<base64 ciphertext + tag>"
}
```

字段顺序固定,方便 git diff;单行 JSON,便于流式读写。

### 错误码

| 错误 | 抛出时机 | UI 反馈 |
|---|---|---|
| `INVALID_BLOB` | 解析时缺字段 / 类型不对 / `magic` 不匹配 | 提示"文件格式损坏" |
| `WRONG_PASSWORD` | AES-GCM auth tag 校验失败(密码错 / 文件被改) | 提示"密码错误"(不区分两种,避免泄露原始错误) |

### Web Crypto 依赖

实现统一走 `globalThis.crypto.subtle`,不引第三方依赖。桌面 Electron 渲染层 + 现代浏览器都直接支持;Node 18+ 也能跑(测试用)。极旧环境会抛 `Web Crypto API unavailable: upgrade to Node 18+ or a modern browser`。

## 11. AI 隐私边界

AI 助手(Anthropic / OpenAI / DeepSeek / Codex / Grok)是 SkylerX 的核心增强,但它发到第三方 API 的东西**仅限于上下文必需**:

| 类型 | 发送? | 备注 |
|---|---|---|
| 当前 SQL 文本 | ✅ | 用户主动触发对话 / 补全的前提 |
| 当前 schema hint(库 / 表 / 列名) | ✅ | 仅元数据,**不发任何行数据** |
| 错误信息正文 + 错误码 | ✅ | 用于"问 AI"诊断,见 `AI` 文档第 4 节 |
| 连接元数据(方言 / 连接名 / 库名) | ✅ | 帮 AI 选对方言 |
| **结果集行数据** | ❌ | 即便用户开了 AI 行内补全,也只发 schema hint,不发 SELECT 返回的行 |
| **连接密码 / SSH 私钥** | ❌ | OS 钥匙串里的密文从未被读出做提示 |
| **本地连接配置整体** | ❌ | 只取当前选中连接的 dialect / database |

如果你需要彻底隔离 AI:

1. `Settings → AI Provider → 清空 API Key` → 行内补全 / 聊天 / 问 AI 入口全部禁用
2. 或者用本地 endpoint(Ollama / vLLM / 私有部署),改 `endpoint` 字段指向 `http://localhost:...`

> **AI 通知 webhook 同样原则**:通知正文里默认带的是"标题 + 摘要 + 触发时间",不附带 SQL 行数据。具体可在 `Settings → 通知` 的模板里改。

## 12. 安全相关快捷入口速查

| 操作 | 入口 |
|---|---|
| 等保合规检查 | ⌘K → "等保 2.0 合规检查 · 连接名" / 右键连接 → 合规检查 |
| PII 扫描 | 右键库 → PII 扫描器 |
| 脱敏视图生成 | 右键库 / 表 → 生成脱敏视图 |
| 数据契约 | ⌘K → "数据契约" / 工具 → 数据契约 |
| 加密导出 | 结果集 / SQL 编辑器 → 导出 → 选 `.skbk` |
| 全部连接的安全策略 | `Settings → 数据脱敏` / `Settings → 生产水印` |
| 自定义快捷键(防误触) | `Settings → 键绑定` |

## 13. 已知限制

代码事实层面需要让 DBA 知道的边界:

- **SQL Linter 是启发式**:不做完整 SQL parser,字符串扫可能在极少数 case 漏判(例如带嵌套 `/* ... */` 注释 + 字符串字面量里出现 `where` 关键字)。对高危操作,建议同时启用 prod 二次确认(写连接名)。
- **合规检查需要相应读权限**:`mysql.user` 表需要 SELECT 权限,`pg_authid` 需要超级用户,缺权限的项会落到 `unknown` 而不是 `fail`,**不要把 unknown 当 pass**。
- **脱敏渲染只在 UI 层**:数据库里仍是原文。要彻底防"应用读到原文",请走入库脱敏视图 + 数据库账号权限收紧。
- **加密导出文件本身不防"暴力字典"**:200k 轮 PBKDF2 给的是 ~10^7 量级的代价,弱密码仍可能被脱机破解。给文件起强密码,或在团队内走 KMS / 公钥分发。
- **环境标记是软约束**:`extra.env = 'prod'` 是连接保存时用户自己填的;如果用户手滑选了 `dev`,prod 专属的规则就不会触发。建议在团队层面通过"导出连接配置 → 同事导入"标准化这一字段。
