# 数据流:导入 / 导出 / 备份 / 迁移

SkylerX 把"数据离开/进入数据库"的所有路径收敛在一组对话框里,统一走自定义 `SaveFileDialog`(跨平台一致,不调用系统原生)和渲染端解析(CSV/JSON/Excel 全部在内存里处理)。本章按"出口 → 入口 → 备份/还原 → 库间迁移 → 数据字典 → 数据对比"的顺序梳理。

## 1. 概览:这一块覆盖什么

| 场景 | 入口 | 主对话框 / 函数 | 涉及格式 |
|---|---|---|---|
| 一行/几行随手复制 | 结果网格右键 → "复制为" | `ResultGrid.vue::copyRows` | CSV / TSV / JSON / Markdown / SQL VALUES |
| 一张表 / 整 schema 下载 | NavTree 右键"导出 SQL"→ `ExportOptionsDialog` | `Workspace.vue::doTableExport` / `doSchemaExport` | SQL(CREATE + INSERT) |
| 整个 workspace 搬家 | 命令面板 `act:export-conns` / `WorkspaceExportDialog` | `WorkspaceExportDialog.vue` | `.skylerxws` JSON |
| 把 CSV/JSON/Excel 灌进表 | NavTree 右键"导入数据"→ `ImportDialog` | `ImportDialog.vue` + `io.ts` | CSV / TXT / JSON / NDJSON / XLSX |
| Excel/飞书表格剪贴板直接粘 | ⌘V 在主区(或 `PasteImportDialog`) | `PasteImportDialog.vue` | TSV / CSV |
| 直接看 .ndjson 文件 | 命令面板 `act:ndjson-viewer` | `NdjsonViewerDialog.vue` | `.ndjson` / `.jsonl` |
| 整库备份 / 还原 | 命令面板 `act:backup:<id>`(每连接一条) | `BackupRestoreDialog.vue` | `.sql` / `.ndjson` |
| 跨连接复制一张表 | NavTree 右键"数据传输" | `DataTransferDialog.vue` | 行级 SELECT → 批 INSERT |
| 生成数据字典 | NavTree 右键 schema/db → "数据字典" | `Workspace.vue::genDataDict` + `dump.ts` | Markdown / HTML |
| 比对两表数据差异 | 命令面板 `act:data-diff` | `DataDiffDialog.vue` + `data-diff.ts` | 行级 diff → 同步 SQL |

文件 IO 的能力一律走 `client.files`(由主进程实现 `openText / saveText / listDir / commonDirs / mkdir`)。Web 端 `listDir` 不可用,会回退到浏览器下载/上传(只支持文本格式)。

## 2. 导出

### 2.1 结果集多格式复制

`ResultGrid.vue` 右键单元格/选中区域,弹出 "复制为"子菜单:

| 项 | 实现 | 用途 |
|---|---|---|
| CSV | `io.ts::toCSV` | Excel / Numbers 直接粘出表格 |
| TSV | `io.ts::toTSV` | Excel / Notion / 飞书表格(分隔符 `\t`) |
| JSON | `io.ts::toJSON` | 程序里 `JSON.parse`,`Date` 自动 `toISOString()` |
| Markdown | `io.ts::toMarkdown` | 文档 / PR 描述里贴表(转义 `|` 和换行) |
| SQL VALUES | `io.ts::toSqlValuesList` | 形如 `(1, 'a'), (2, 'b')`,粘进 `INSERT...VALUES` / `VALUES (...) AS t` / `ON CONFLICT ... EXCLUDED` |
| SQL INSERT | `io.ts::toInsertSql` | 直接可执行的 `INSERT INTO tbl (...) VALUES (...)` 每行一条 |

**类型还原细节**(`io.ts` 实现):

- `null/undefined` → 输出空(CSV)/`NULL`(SQL);
- `Date` → `toISOString()`;
- `number` → 直出,`Infinity/NaN` 在 SQL 里降级成 `NULL`;
- `boolean` → SQL 里 `TRUE/FALSE`(注意 SQLite 会再翻译成 `1/0`);
- `object/array` → `JSON.stringify`,在 SQL 里再加单引号包裹;
- 单引号 `'` 一律双倍(`a'b` → `'a''b'`),避免注入。

CSV 单元格遇到 `"` / `,` / 换行才加引号;TSV 遇到 `\t` / 换行 / `"` 才加引号 —— 不无脑加引号,粘 Excel 时单元格更干净。

### 2.2 ExportOptionsDialog —— 表 / Schema 整体导出

NavTree 右键表或 schema(库)→ "导出 SQL",先弹一个极简的二选一对话框 `ExportOptionsDialog`:

- **仅结构** → `withData = false`,只输出 `CREATE TABLE`;
- **结构 + 数据** → `withData = true`,再 `SELECT * FROM ref` 拿数据,接 `INSERT` 列表。

接到 `pick` 后 `Workspace.vue` 走 `doTableExport` / `doSchemaExport`:

1. `client.connections.metadata(... group: 'columns')` 拿列;
2. `dump.ts::buildCreateFromColumns` 由列元数据**重建 CREATE TABLE**(v1 含主键,不含索引和外键 —— 跨方言重建索引语法分歧太大,先稳为主);
3. `withData` 为 true 时,`SELECT * FROM ref`(没分页,大表请用备份/迁移);
4. `buildTableDump` 拼成:

   ```sql
   -- 表结构
   CREATE TABLE `users` (...);

   -- 数据(N 行)
   INSERT INTO `users` (...) VALUES (...);
   ```

5. 文件名默认 `<对象名>.sql`,扩展名固定 `.sql`,通过 `client.files.saveText` 走自定义 `SaveFileDialog` 让用户挑路径。

整 schema 导出迭代所有 base table,顶部加一行 `-- ws.dumpHeader { label, n }` 标记元信息。

### 2.3 Workspace 全量导出(`.skylerxws`)

`WorkspaceExportDialog.vue` 把"换电脑/同事共享"两个场景合在一起。文件结构:

```ts
interface WorkspaceFile {
  version: 1
  exportedAt: number
  source: string                  // 'SkylerX'
  connections?: ConnectionConfig[]
  snippets?: typeof snippets
}
```

导出选项(全部可独立勾选):

| 选项 | 默认 | 说明 |
|---|---|---|
| 包含连接配置 | ✓ | 走 `client.connections.list()`,默认**脱敏**(无密码) |
| ⚠ 包含密码 | ✗ | 勾上会**逐条**调 `client.connections.get(id)` 拉明文。文件能跨机器解 —— 跨机不再依赖系统 keychain,代价是文件本身是裸明文,谨慎使用 |
| 包含 SQL Snippets | ✓ | 整段 JSON 复制,不带 ID 改名 |

默认文件名 `skylerx-workspace-YYYY-MM-DD.skylerxws`,filter 同时接受 `.skylerxws` 和 `.json`。

导入时按"连接 + Snippets"清点 → 二次确认 → 按冲突策略合并:

- **skip**:同名跳过(默认);
- **overwrite**:同 `name` 用 dup.id 调 `update`,覆盖所有字段(含密码,如果文件里有);
- **rename**:`name` 后缀 `(导入)` 新建。

### 2.4 加密导出 `.sql.enc`(AES-256-GCM + PBKDF2)

`export-encrypt.ts` 提供纯函数 API,UI 层按场景调用(典型场景:导出含敏感数据的 SQL dump 给外部协作方)。算法选型:

| 项 | 值 | 取舍 |
|---|---|---|
| 文件头魔数 | `SKYLERX-ENC-v1` | 升级算法时识别版本 |
| KDF | PBKDF2-HMAC-SHA-256 | 浏览器/Node 都原生支持,无依赖 |
| 迭代次数 | `DEFAULT_ITER = 200_000` | OWASP 2023 推荐 ≥ 600k,这里折中老机器体验,可后续提 |
| 加密算法 | AES-GCM | 自带 128-bit 认证标签,密码错/被改都抛 `WRONG_PASSWORD` |
| 密钥长度 | 256 bit | `deriveKey` 直接产 AES-GCM 256 |
| Salt | 16 字节随机 | 每次重新生成,不复用 |
| IV | 16 字节随机 | 每次重新生成,不复用 |
| 序列化 | 单行 JSON | 方便流式读写、`.sql.enc` 用文本编辑器肉眼可见 |

落盘格式(单行 JSON):

```json
{ "magic": "SKYLERX-ENC-v1", "salt": "<b64>", "iv": "<b64>", "iter": 200000, "data": "<b64-cipher+tag>" }
```

实现细节:

- 走 `globalThis.crypto.subtle`,**不引第三方依赖**;旧 Node 没有 subtle 会直接抛错让用户升级运行时;
- `Uint8Array` 全部底层用 `new ArrayBuffer(n)` 兜底,绕开 TS 5.7 + lib.dom 把 `BufferSource` 收紧到 `ArrayBuffer` 后端导致的类型报错;
- base64 编码分 32 KB 块,避免 `String.fromCharCode(...bytes)` 在大文件上爆栈;
- 解密时把 GCM 校验失败统一翻成 `WRONG_PASSWORD`,**不泄露**原始 `OperationError`,避免给攻击者侧信道。

## 3. 导入

### 3.1 ImportDialog —— CSV / JSON / NDJSON / Excel 全格式三步向导

NavTree 右键表 → "导入数据",`ImportDialog.vue` 是个固定 3 步的向导(`step: 'pick' | 'map' | 'run'`):

#### Step 1 选文件

- 主按钮 "选择文件" → `client.files.openText`,filter `csv / txt / json`(JSON 自动用 `\.json$/i` 或首字符 `[`/`{` 嗅探,走 `parseJSON`)。
- 副按钮 "Excel…" → 走渲染端的 `<input type=file>`,读 `ArrayBuffer` 后**按需动态加载** `xlsx`(SheetJS)。仅读首个 sheet,`raw: false`(走 Excel 显示值,日期不会变成数字)、`defval: ''`。Excel 路径不经文本通道(走二进制),所以体积大也不卡 IPC。
- 解析后预览前 5 行,"首行表头"复选框允许手动切。

`io.ts::parseCSV` 是手写的状态机:支持 BOM 剥离、`""` 转义、CRLF / LF、引号内含逗号换行。最后过滤掉单元只有一个空字段的"空行"。

`io.ts::parseJSON` 兼容三种形态:

- **对象数组**:键并集为表头(按出现顺序);
- **数组的数组**:首行即表头;
- **单对象**:当成 1 行处理。

#### Step 2 字段映射 + 类型推断

`autoMap()` 按"小写后精确相等"自动配对源/目标列。每列有下拉手动选,"跳过"= `-1`。

类型推断 `inferType(srcIdx)` 采样**该列前 50 个非空值**,顺序检测:

| 推断 | 正则 |
|---|---|
| `number` | `/^-?\d+(\.\d+)?$/` |
| `date` | `/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?Z?$/i` |
| `boolean` | `/^(true|false|t|f|y|n)$/i` |
| `string` | 兜底 |

存在空串时标 `nullable`,UI 上用 `·∅` 角标。**注意**:类型推断只是提示,执行时仍按字符串插入,真正的 cast 由 DB 引擎按列定义完成 —— 这样能容忍方言差异(MySQL `'2024-01-01'` 自动当 DATE,SQLite 当 TEXT)。

#### Step 3 选项 + 执行

| 选项 | 默认 | 行为 |
|---|---|---|
| TRUNCATE 后导入 | ✗ | 在 `INSERT` 前插一条 `TRUNCATE TABLE <ref>`;勾选时谨慎,**不可回滚**(MySQL/PG 的 TRUNCATE 都是 DDL) |
| 每批行数 | 200(min 1,max 2000) | 控制 `INSERT INTO t (...) VALUES (...), (...), ...` 一条语句的行数,避免单语句过长被驱动截断 |

执行走 `client.connections.executeBatch`,源行的空串(`''`)统一视作 `NULL`(`io.ts::buildInsertStatements` 里 `s == null || s === '' ? 'NULL' : ...`),所以**导入时分不清"真空串"和"无值"**。需要严格区分的场景请走 SQL 编辑器手写。

### 3.2 PasteImportDialog —— 剪贴板直插

`PasteImportDialog.vue` 是 ImportDialog 的轻量平替:打开就 `navigator.clipboard.readText()`,免选文件。

| 输入 | 解析路径 |
|---|---|
| 含 `\t` | TSV(Excel / 飞书表格 默认复制格式)按 `\t` 切 |
| 不含 `\t` | 手写 CSV 简单解析(支持 `""` 转义,但**不处理复杂的嵌套引号** —— 复杂情况转 ImportDialog) |

目标表的列从 `information_schema.columns` 实时拉(MySQL / MariaDB / OB / TiDB / Doris / StarRocks 走 `table_schema + table_name`;PG / 其他走 `table_name + table_catalog`)。自动按规整后(`toLowerCase + 去 _-空白`)匹配,余下手动选,空选 = 跳过。

执行批大小固定 `BATCH = 500`,每批一条 `INSERT INTO ... VALUES (...), (...)` 拼接;`sqlLiteral` 简化处理:空串 → `NULL`,纯数字直出,其余加单引号(`'` 双倍转义)。**Redis / 文档库等非 SQL 方言会被前置过滤掉**(只列 `dialectKind === DbKind.Sql` 的连接)。

适用场景:从飞书/Excel 复制几十到几千行随手粘进表。再大的量请用 ImportDialog(走 `executeBatch`) 或 DataTransferDialog(走分页)。

## 4. NDJSON 浏览器(`NdjsonViewerDialog`)

命令面板 `act:ndjson-viewer` → 选 `.ndjson` / `.jsonl` 文件 → 当表格看,**无需任何数据库连接**。

解析规则(`parse()`):

- 按行切,空行/解析失败的行 → 计入 `skipped` 计数(不阻塞);
- 识别 dbgate Archives 风格的 `{ __table, data }` 包装 → 行归属表 `__table`,数据是 `data`;
- 识别错误标记 `{ __error: "..." }` → 跳过计数 `skipped++`;
- 其余视为普通 JSON 行,`table = ''`。

UI 特性:

- **跨表 tab**:顶部按出现过的 `__table` 列出 tab,点击只看该表;
- **列并集**:所有可见行的 `Object.keys` 求并集为列头(每行字段可不齐,缺的显示 `null`);
- **行详情**:双击行右侧 / 底部展开完整 JSON;
- **复制全文 / 另存**:整文件复制到剪贴板,或 `saveText` 另存(默认沿用原文件名);
- **只读 v1**:不支持编辑、不支持导回数据库,后续在路上。

## 5. 备份 / 还原(`BackupRestoreDialog`)

命令面板 `act:backup:<connId>` → `BackupRestoreDialog`。**MVP 走纯 SQL 路线**:不调外部 `mysqldump` / `pg_dump`(跨平台路径检测烦,用户机不一定有);后续要 DDL 完整(trigger / view / FK 顺序)再上 IPC 跑 `child_process.spawn`。

#### 备份格式

| 格式 | 实现 | 特点 |
|---|---|---|
| **SQL** | 引导用户走 NavTree 右键"导出 SQL"(复用 `doSchemaExport`) | 传统路径,直接可被 `mysql/psql` 客户端吃 |
| **NDJSON** | 内置 `doBackupNdjson()` | dbgate Archives 风格,跨连接导入/导出友好 |

NDJSON 备份流程:

1. `metadata({ group: 'tables', path: [database] })` 取所有 base table;
2. 逐表 `SELECT * FROM <sqlName>`,每行写一条 `{"__table":"t","data":{...}}\n`;
3. 单表失败**不中断**,改写一条 `{"__table":"t","__error":"..."}`(还原方能看到);
4. `saveText` 落到 `skylerx-<连接名>-<时间戳>.ndjson`,filter 同时接受 `.ndjson / .jsonl`;
5. 全过程带进度条(`done / total · phase`)+ "⏹ 停止"按钮(`stopRequested` 在每张表前检查)。

已知限制:`BLOB / Buffer` 经 `JSON.stringify` 会变 `{ type: 'Buffer', data: [...] }`,**还原时不会变回二进制**;严格场景请用 SQL 路径。

#### 还原流程

| 路径 | 流程 |
|---|---|
| SQL | `client.files.openText` → `splitStatements(content)` 按 `;` 分句 → 二次确认 → 顺序 `execute`,**单条失败不中断**,错误写入 `restoreProgress.errors[]`(每条截前 200 字符) |
| NDJSON | 按 `__table` 分桶 → **每桶一次大 `INSERT`**,内部按 `chunkSize = 100` 切片(避免 `max_allowed_packet`)→ 同样的错误收集 |

UI 上有实时进度条 + 错误列表(超长截断 + 折行)+ 完成后的 `restoreOk / restoreWithErrors / restoreStopped` 三态 toast。

## 6. 连接间数据迁移(`DataTransferDialog`)

NavTree 右键表 → "数据传输"。比"备份/还原"更窄:**单表对单表**,源端选好就开始,适合开发→预发数据搬运。

| 字段 | 默认 | 说明 |
|---|---|---|
| 目标连接 | 当前连接 | 下拉里所有连接,标 `(当前)` 后缀 |
| 目标 database | 源 ctx | 不同方言含义不同;PG 是 catalog,MySQL 是库 |
| 目标 schema | 源 ctx | PG/KB 必填(默认 `public`),MySQL 留空 |
| 目标表名 | 源表名 | 不存在会插入失败;不自动建表 |
| 每批行数 | 500 | 控制源端 `SELECT ... LIMIT ? OFFSET ?` 分页大小 |
| TRUNCATE 目标先 | ✗ | 实际跑的是 `DELETE FROM <ref>`(不是 `TRUNCATE`,可被事务回滚) |

执行循环:

```ts
for (let page = 0; page < 100000; page++) {
  const res = await execute(srcId, `SELECT * FROM ${srcRef}`, [],
    { ..., limit: size, offset: page * size })
  if (!res.rows.length) break
  await executeBatch(tgtId, rowInserts(tgt.dialect, dstRef, cols, res.rows), dstOpts)
  if (res.rows.length < size) break    // 提前停
}
```

- 最大页数 10w 是死循环兜底;
- 列名从源表 `metadata` 取,所以**目标表必须有相同列名**(顺序无所谓,`rowInserts` 显式列列表);
- 类型转换交给 JS → SQL literal(`io.ts::sqlLiteral`)+ 目标 DB 引擎隐式 cast。复杂类型(Postgres `jsonb`、MySQL `BIT(1)`)有概率失真,迁完做一次抽样 spot-check。

## 7. 数据字典导出(Markdown / HTML)

NavTree 右键 schema(或库) → "数据字典 → Markdown / HTML"。`Workspace.vue::genDataDict` 调 `dump.ts::buildDataDictMarkdown / buildDataDictHtml`。

每张表一节,字段表的列固定:

| 字段 | 类型 | 可空 | 主键 | 默认 | 注释 |
|---|---|---|---|---|---|
| `id` | `bigint unsigned` | N | 🔑 | | 用户主键 |
| `email` | `varchar(255)` | Y | | `NULL` | 邮箱 |

数据来源:`metadata({ group: 'columns' })` 返回的 `MetadataNode.detail.{dataType, nullable, primaryKey, defaultValue, comment}`。

#### Markdown 与 HTML 的差异

| 维度 | Markdown | HTML |
|---|---|---|
| 转义 | `|` → `\|`,换行 → 空格 | `&<>` 实体 |
| 目录 | 无(用 IDE 大纲) | 3 栏 TOC,锚链接 `#t-<urlencoded>` |
| 排版 | 纯 Markdown | 内联 `<style>`,固定 sans-serif、表格框线、奇偶行斑马、`@media print` 防 section 跨页 |
| 适用 | 嵌进文档库 / Wiki / GitLab | 浏览器打开直接打印 PDF |

文件名 `<schema-or-db>-data-dict.md|html`。**完全离线**生成 —— 数据字典是合规审计场景里最常见的需求,可以在断网环境跑。

## 8. 数据对比(`DataDiffDialog`)

命令面板 `act:data-diff`。**两连接 × 两表 → 行级 diff → 同步 SQL**。

核心算法在 `data-diff.ts::diffRows`(纯函数,可单测):

```ts
diff = {
  inserts: Row[],            // 源有 / 目标无
  updates: RowUpdate[],      // 主键相同,非键列有不同
  deletes: Row[]             // 目标有 / 源无
}
```

配对键(`keyCols`):

- 默认从源表 `information_schema.table_constraints + key_column_usage` 拉**主键**(MySQL / PG 通用 SQL);
- 用户可手填 / 改 `keyColsInput`(逗号分隔)覆盖。

值比较 `same(a, b)` 走**字符串归一**:`null/undefined` 等价空,其余 `String(a) === String(b)` —— 容忍驱动差异(`MySQL2` 返回 `BigInt`, `pg` 返回 `Number`, SQLite 返回 `string`)。

支持矩阵:**仅 MySQL 家族(MySQL / MariaDB / OB) + PostgreSQL 家族(PG / KingbaseES)**;其他方言(SQLite / Oracle / SQL Server / Redis 等)UI 上显示"仅 MyPg 短"警示,按钮置灰。

执行结果:

| 指标 | 含义 |
|---|---|
| `inserts` | 把目标补齐到源 |
| `updates` | 把目标改成与源一致(只 SET 实际不同的列) |
| `deletes` | 目标多余的行,**末段输出并加注释**"仅目标有;确认后再执行",避免误删 |

最后通过 `generateDataSync` 拼成一段可读 SQL,可"复制"或"在查询页打开",落到目标连接执行 —— 给一个 dry-run / human-review 的窗口。

`LIMIT`(默认 2000)防爆内存,主键差异较多时需要先缩范围。

## 9. 安全(摘要)

详见 [安全模型](./troubleshooting.md)。本章相关要点:

- **Workspace 导出默认不带密码**;勾选后才是裸明文 JSON,UI 用红色"⚠"显式警告;
- **`.sql.enc` 加密导出**走 AES-256-GCM,密码错和文件被改给同一个错误,不侧信道泄露;
- NDJSON 备份**不脱敏**;真正的脱敏请在生成时跑 PII Scanner 或在 SQL 编辑器手写 `SELECT replace(...)`;
- 导入/导出的临时数据**只在内存里**,不写中间文件,关掉对话框立即释放。

## 10. 兼容性矩阵

| 能力 | MySQL 家族 | PG 家族 | SQLite | Oracle | SQL Server | DM / KingbaseES | Redis | MongoDB |
|---|---|---|---|---|---|---|---|---|
| 复制为 CSV/TSV/JSON/MD | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 复制为 SQL VALUES/INSERT | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| 表/Schema 导出 SQL | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| `.skylerxws` 全量导出 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `.sql.enc` 加密导出 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ImportDialog(CSV/JSON/Excel) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 用 RedisImportExport | 用 NDJSON 路径 |
| 粘贴板导入 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| NDJSON 浏览器 | 不依赖 DB | 不依赖 DB | — | — | — | — | — | — |
| 备份/还原 SQL 路径 | ✓ | ✓ | ✓ | 部分 | ✓ | ✓ | — | — |
| 备份/还原 NDJSON 路径 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| 连接间数据迁移 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| 数据字典(MD/HTML) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| 行级数据对比 + 同步 SQL | ✓ | ✓ | ✗ | ✗ | ✗ | ✓(KB) | — | — |

"✗" 表示当前显式置灰;"—" 表示对该方言无意义(KV / 文档库走单独的 `RedisImportExportDialog`)。

## 触发方式速查

| 操作 | 工具栏 | 右键菜单 | ⌘K 命令面板 | 快捷键 |
|---|---|---|---|---|
| 复制结果为 CSV / TSV / ... | — | 结果网格 → 复制为 → ... | — | — |
| 导出表 SQL | — | NavTree 表节点 → 导出 SQL | — | — |
| 导出 Schema SQL | — | NavTree schema 节点 → 导出 SQL | — | — |
| 导出 Workspace | 顶栏齿轮 → 导出 | — | `导出 Workspace`(`act:export-conns`) | — |
| 导入 Workspace | 顶栏齿轮 → 导入 | — | `导入 Workspace`(`act:import-conns`) | — |
| 导入数据(CSV/JSON/Excel) | — | NavTree 表节点 → 导入数据 | — | — |
| 粘贴板导入 | — | — | `PasteImport`(顶部菜单触发) | — |
| NDJSON 文件查看 | — | — | `NDJSON 浏览器`(`act:ndjson-viewer`) | — |
| 备份 / 还原 | — | — | `备份/还原 · <连接>`(`act:backup:<id>`) | — |
| 数据传输 | — | NavTree 表节点 → 数据传输 | — | — |
| 数据字典 | — | NavTree schema/库 → 数据字典 → MD / HTML | — | — |
| 数据对比 | — | — | `数据对比`(`act:data-diff`) | — |

提示:任何"另存"操作底层都是同一个自定义 `SaveFileDialog`(`packages/ui/src/components/SaveFileDialog.vue`)—— 跨 macOS / Windows / Linux 完全一致,**不调系统原生对话框**;支持收藏夹、最近目录、↑↓ 选条目、Enter 保存、⌘L 聚焦地址栏。
