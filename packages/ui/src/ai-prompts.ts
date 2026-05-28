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
