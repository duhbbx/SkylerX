/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * AI 入口共享的 prompt 构造器（#9 / #10 / #17 / #18 / #19 / #20 / #21）。
 *
 * 每个函数都返回一个完整的 Markdown 字符串，调用方塞给 AiChatPanel.askPredefined 即发。
 * 这里只做"模板拼装"，不发请求；具体的连接 / schema 拉取由聊天面板内部承担。
 *
 * 设计原则：
 *  - 用户原始诉求（"加列 / 改名 / 优化"）原样保留在 prompt 里，避免被翻译丢失语义
 *  - 上下文（SQL / 表名 / EXPLAIN 文本）作为 Markdown 代码块插入，AI 更容易识别
 *  - 期望输出格式写清楚（"给我 ALTER + 反向 ALTER + 数据迁移"），减少来回
 */

export interface TableContextHint {
  /** 限定到的表（schema.table 或 table），用于 prompt 中引用 */
  tableRef: string
  /** 方言名，让 AI 用对应的 SQL 语法 */
  dialect: string
}

/** #9 写 migration：用户描述改动 → AI 出 ALTER + 反向 ALTER + 数据迁移片段 */
export function pMigration(ctx: TableContextHint, userIntent: string): string {
  return `请基于下面的表，给我一份 **数据库迁移脚本**：

- **方言**：${ctx.dialect}
- **目标表**：\`${ctx.tableRef}\`
- **需求**：${userIntent}

请输出三段独立的 SQL 代码块：

1. **正向迁移**（执行需求的 ALTER）
2. **反向回滚**（撤销正向迁移的 ALTER）
3. **数据迁移**（如需补默认值 / 拆字段 / 数据搬运，附 UPDATE 或脚本；如不需要请明说"无需"）

每段都用 \`\`\`sql 代码块包起来，前面用 H3 加标题。`
}

/** #10 优化 SQL：拼 EXPLAIN 文本（如有）+ 原 SQL → AI 给改写建议 */
export function pOptimizeSql(ctx: { dialect: string }, sql: string, explain?: string): string {
  return `请帮我优化下面的 SQL（方言：${ctx.dialect}）：

**原 SQL**
\`\`\`sql
${sql}
\`\`\`

${explain ? `**执行计划 (EXPLAIN)**\n\`\`\`\n${explain}\n\`\`\`\n` : '（没有 EXPLAIN，请先按当前 schema 推断慢点）\n'}
请按以下结构回答：

1. **判定**：哪一步最慢 / 全表扫还是回表，简要说原因
2. **改写建议**：给出优化后的 SQL（保留语义），用 \`\`\`sql 代码块
3. **索引建议**（如需）：用 \`\`\`sql 代码块给出 CREATE INDEX
4. **预期收益**：定性说会快多少（不要瞎报数字）`
}

/** #17 解读 EXPLAIN：纯解读，不改写 */
export function pExplainAnalysis(ctx: { dialect: string }, sql: string, explain: string): string {
  return `请用通俗中文讲解下面执行计划（方言：${ctx.dialect}）；先说**整体瓶颈在哪**，再逐节点说每步在做什么、是否合理。

**SQL**
\`\`\`sql
${sql}
\`\`\`

**EXPLAIN**
\`\`\`
${explain}
\`\`\`

最后一节给出**结论**：当前查询是否健康，最值得动手的一处优化是什么。`
}

/** #18 生成测试数据：选表 + 业务描述 → INSERT */
export function pTestData(ctx: TableContextHint, rowCount: number, businessHint: string): string {
  return `请为表 \`${ctx.tableRef}\` 生成 **${rowCount}** 行测试数据（${ctx.dialect}）。

**业务背景**：${businessHint || '（未提供，请基于字段名推断）'}

要求：
1. 严格按当前表 schema 字段顺序写 INSERT，**列名显式列出**
2. 主键 / 唯一约束**不要重复**；如果是 BIGSERIAL/AUTO_INCREMENT 让 DB 自己分配，不要写
3. **外键引用**的字段要么省略让默认值生效、要么取一个**真实存在**的父表值（基于 schema 推断；若不确定，请用问号占位并提醒我手动替换）
4. 字符串值贴近业务（人名 / 地址 / 邮箱用真实风格，不要 \`aaa / test1 / xxx\`）
5. 全部用一条 \`\`\`sql 代码块包起来，每行一条 INSERT`
}

/** #19 NL → SQL：自然语言 → SQL（强化版） */
export function pNl2Sql(ctx: { dialect: string }, userRequest: string): string {
  return `把下面的需求翻译成 **${ctx.dialect}** 方言的 SQL；只输出一条 SQL，包在 \`\`\`sql 代码块里，不要解释（如果有歧义就**先写出最常见解释下的 SQL**，再用一段简短说明指出可能的歧义点）。

**需求**
${userRequest}`
}

/** #20 文档化：把列表喂给 AI 让它猜业务含义、生成 Markdown 数据字典 */
export function pDataDictDoc(ctx: TableContextHint, columnsCsv: string): string {
  return `请为下表生成**字段说明**（数据字典补全）。

- **表**：\`${ctx.tableRef}\`
- **方言**：${ctx.dialect}
- **字段** (name, type, nullable, key, default)：

${columnsCsv}

请输出一张 Markdown 表，3 列：**字段** | **类型** | **业务含义**。
"业务含义"由你根据字段名 / 类型 / 是否主键外键来推断，**用中文一句话**说清楚；如果无法判断，写 "?（建议补充）"。`
}

/** #21 解释表：给一段表用途说明 */
export function pExplainTable(
  ctx: TableContextHint,
  columnsCsv: string,
  foreignKeyHint: string,
): string {
  return `请用一段话（≤ 200 字中文）讲清楚下表是用来做什么的，重点说**它在业务系统里扮演什么角色**。

- **表**：\`${ctx.tableRef}\`
- **方言**：${ctx.dialect}
- **字段** (name, type, nullable, key, default)：

${columnsCsv}

${foreignKeyHint ? `**外键引用**：\n${foreignKeyHint}\n` : ''}
之后再用 3 个 bullet 点回答：
1. **大概谁会插入它**（业务流程 / 触发条件）
2. **谁会读它**（哪些常见查询场景）
3. **删除策略**（看起来是硬删还是软删；如有 deleted_at / status 字段请指出）`
}

/**
 * G1 「AI 数据库体检」prompt：把整库元数据（columns/indexes/FKs，CSV/Markdown 文本）
 * 一次性塞给 AI，让它按 6 类常见反模式产出健康报告。
 *
 * 输出强约束：必须用 Markdown 二级标题（`##`）分节，便于前端按 H2 拆卡片；
 * 没有问题的小节也要保留标题并写"未发现明显问题"。
 */
export function pHealthCheck(ctx: { dialect: string }, metadata: string): string {
  return `请对下面这个 **${ctx.dialect}** 数据库做一次「健康体检」，按下面 6 类常见反模式给出报告。

**库元数据**（columns / indexes / foreign keys，已按表分组，可能被截断）：

${metadata}

---

请严格按 **6 个 Markdown 二级标题（\`## 1. xxx\` ~ \`## 6. xxx\`）** 分节输出，每节先点出"哪张表 / 哪个字段"，再用一段简短中文说明问题，最后给出**修复建议**（如可给出 SQL，用 \`\`\`sql 代码块）。如果某小节没发现明显问题，也请保留标题并写一句"未发现明显问题"。

## 1. 高频查询列缺少索引
基于字段命名 / 类型 / 是否出现在外键和常见 WHERE 条件中**启发式推断**——例如 \`status\`、\`created_at\`、\`user_id\`、\`type\`、\`is_*\`、\`*_at\` 这类高频过滤/排序列，但没有对应索引的，请点出来。

## 2. 命名上像外键但没有 FK 约束
形如 \`xxx_id\` / \`xxxId\` 但该字段所在表上没有指向任何父表的 FOREIGN KEY 的，列出来；并给出推测的父表（基于命名）。

## 3. 字段命名风格混用（snake_case / camelCase）
列出在**同一张表内**或**整个库内**两种命名风格混用的字段；指出统一到哪种更合适。

## 4. 类型选得过大
- \`VARCHAR(255)\` / \`TEXT\` 但看上去只装短串（状态码、枚举、手机号等）
- \`BIGINT\` 但显然只装小整数（如 \`status\`、\`type\`、\`level\`）
- 时间用 \`VARCHAR\` 存而非 \`DATETIME/TIMESTAMP\`
列出可疑字段并给出更紧凑的类型建议。

## 5. 关键表 / 字段没有 comment
没有 COMMENT 的"业务核心表"（看名字像 \`user\` / \`order\` / \`payment\` / \`account\` 等）以及其关键字段（主键、外键、状态字段、金额字段）列出来；不需要列全部"无 comment"的字段，只挑值得加注释的。

## 6. 软删字段缺索引
表里有 \`deleted_at\` / \`is_deleted\` / \`deleted\` 这类软删字段，但**没把它放进任何索引**的——会导致每次 WHERE deleted_at IS NULL 走全表过滤。请列出并给出 \`CREATE INDEX\` 建议。

最后再加一节：

## 总结
3~5 条最值得**优先动手**的事项，按"性价比"排序。`
}

/**
 * G4 「AI SQL 跨方言翻译」prompt：把一段 SQL 从源方言转写成目标方言，
 * 同时让 AI 指出**不可平移**的语法（如 MySQL 的 ON DUPLICATE KEY UPDATE → PG 没有等价单语句）、
 * 并给出更地道的目标方言写法建议。
 *
 * 输出强约束：
 *   1) 译后 SQL 包在 ```sql 代码块里（前端用首个 sql 代码块抽取并 colorize 显示）
 *   2) 「警告」一节用 bullet 列表列出无法直接平移的语法点（缺则写"无"）
 *   3) 「建议」一节用 bullet 列表给出目标方言更地道的等价写法（如 LIMIT/OFFSET 写法、CTE 替换、类型选择等）
 */
export function pTranslate(
  from: string, // 源方言 'mysql' / 'postgres' / 'mssql' / 'oracle'
  to: string,
  sql: string,
): string {
  return `请把下面这段 SQL 从 **${from}** 翻译成 **${to}** 方言；保持语义不变，标识符 / 字面量保持原样，仅在语法层面做必要改写。

**源 SQL（${from}）**
\`\`\`sql
${sql}
\`\`\`

请严格按以下三段输出：

1. **译后 SQL**：包在 \`\`\`sql 代码块里，**只放一条**译后 SQL，不要解释、不要额外注释。

2. **警告**：用 Markdown bullet 列表（\`- xxx\`）列出**不可平移**的语法点——例如：
   - 源方言里某个内置函数 / 关键字在目标方言**没有等价**（如 MySQL \`ON DUPLICATE KEY UPDATE\` → PostgreSQL 需 \`INSERT ... ON CONFLICT ... DO UPDATE\`，语义大体可对齐但行为细节不同）
   - 数据类型不一一对应（如 MySQL \`DATETIME\` vs PostgreSQL \`TIMESTAMP\`，MSSQL \`NVARCHAR\` vs Oracle \`NVARCHAR2\`）
   - 分页 / 自增 / 字符串拼接 / 引号风格等方言差异
   - 隐式类型转换、NULL 排序行为差异
   如果没有任何不可平移点，写一条 \`- 无明显不可平移语法\`。

3. **建议**：用 Markdown bullet 列表给出**目标方言更地道**的等价写法 / 风格建议（例如改用 CTE、改用 \`LIMIT ... OFFSET\`、改用 \`COALESCE\` 而非 \`IFNULL\` 等）；如无建议，写一条 \`- 直译已足够地道\`。

请用清晰的 H3（\`### 警告\` / \`### 建议\`）标题分隔后两段，方便前端按标题切分渲染。`
}

/**
 * 存储过程 / 函数翻译 prompt。语义比单条 SQL 复杂得多:OUT/INOUT 参数 / 错误处理 / 游标 / DELIMITER / BEGIN-END 块 / 异常块结构都得改写。
 * 输出三段:译后 SP 代码 / 警告 / 建议(同 pTranslate 的输出形态)。
 */
export function pTranslateProcedure(
  from: string,
  to: string,
  code: string,
): string {
  return `请把下面这段 **存储过程 / 函数** 从 **${from}** 翻译成 **${to}** 方言。需要处理:
- CREATE PROCEDURE / FUNCTION 头部语法差异
- 参数模式(IN / OUT / INOUT)在不同方言的写法
- BEGIN-END 块、DECLARE 变量、异常处理(EXCEPTION/HANDLER/TRY-CATCH)结构差异
- 游标 / FOR 循环 / RAISE NOTICE / SIGNAL 等关键字的等价
- DELIMITER 用法(MySQL)在目标方言怎么省/换
- 内置函数 / 类型 / NULL 行为差异

**源代码（${from}）**
\`\`\`sql
${code}
\`\`\`

请严格按以下三段输出:

1. **译后代码**:包在 \`\`\`sql 代码块里,**完整可执行**(含 CREATE 头、参数列表、BEGIN-END 块)。

2. **警告**:用 Markdown bullet 列表(\`- xxx\`)列出**语义有差异 / 不可直译**的点(每一条配源/目标的具体语法对比):
   - 异常处理结构差异(MySQL HANDLER vs PG EXCEPTION vs T-SQL TRY-CATCH)
   - 自动事务边界差异
   - OUT 参数语义差异(返回值 vs 多结果集)
   - 触发器中调用方式差异
   - 字符集 / 时区 / NULL 比较等隐式行为差异
   如果没有不可平移点,写一条 \`- 无明显不可平移结构\`。

3. **建议**:用 Markdown bullet 列表给出目标方言**更地道**的写法(如 PG 用 LANGUAGE plpgsql / RETURNS RECORD;MSSQL 用 RAISERROR + THROW;Oracle 用 PRAGMA EXCEPTION_INIT 等)。如无建议,写一条 \`- 直译已足够地道\`。

用 H3(\`### 警告\` / \`### 建议\`)标题分段。`
}

/**
 * G2 「AI 写表/列注释」prompt：把列定义清单（columnsCsv）交给 AI，让它**只输出 JSON 数组**，
 * 每项 `{ col: "列名", comment: "中文一句话业务含义" }`，外层包 ```json 代码块，
 * 方便前端用稳定的正则解析回结构化数据后做对比 + 落库。
 *
 * 设计要点：
 *  - 强约束"只输出一个 ```json 代码块"，前后不要解释，避免解析裸 JSON 时被噪声污染
 *  - 列名要**原样**回写（不要被 AI 翻译/改写），便于和现状对比 + 拼 ALTER
 *  - 注释用中文一句话（≤ 30 字），信息不足请写问号占位提示人工补
 */
export function pComment(ctx: TableContextHint, columnsCsv: string): string {
  return `请为下表的每个字段**猜业务含义**，给出适合写进 \`COMMENT\` 的中文注释。

- **方言**：${ctx.dialect}
- **目标表**：\`${ctx.tableRef}\`
- **字段** (name, type, nullable, key, default)：

${columnsCsv}

**输出要求（必须严格遵守，否则前端无法解析）**：

- **只输出一个** \`\`\`json 代码块，**不要任何前后说明文字**
- 代码块内是一个 JSON 数组，每项形如 \`{ "col": "列名", "comment": "中文一句话业务含义" }\`
- \`col\` 必须**原样**抄上方字段名（区分大小写、别加引号、别翻译）
- \`comment\` 用中文一句话（≤ 30 字）说清字段业务含义；信息不足请写 "?（建议人工补充）"
- 列出**全部字段**（即便是 id / created_at 这类基础字段也要给注释）

示例（仅示意格式）：

\`\`\`json
[
  { "col": "id", "comment": "主键，自增订单 ID" },
  { "col": "user_id", "comment": "下单用户 ID，外键 users.id" }
]
\`\`\``
}
