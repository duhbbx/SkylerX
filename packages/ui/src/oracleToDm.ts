/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Oracle → DM(达梦) 启发式翻译规则集
 *
 * 信创外包高频场景:把 Oracle 库迁去达梦。DM 对 Oracle 兼容度高(语法 80%+ 直接通过),
 * 真正需要翻译的主要是:
 *   - 几个非 SQL 标准的数据类型(VARCHAR2 / NUMBER / RAW / BINARY_*)
 *   - 几个 Oracle 习惯函数(SYSDATE / NVL / DECODE 等)
 *   - 部分 Oracle 专有语法(CONNECT BY 高级 / Spatial / INSTEAD OF 触发器 / MERGE 复杂分支)
 *
 * 设计刻意保持简单 —— 正则启发,不写真正的 SQL parser:
 *   - 类型 / 函数:可机器替换的直接替换
 *   - 复杂语法:只发 warning 让人工 review,SQL 文本原样保留,绝不破坏
 *
 * 模块只做字符串处理,无外部依赖,便于 .test.ts 单测覆盖。
 */

// ── 类型映射 ────────────────────────────────────────────────────
// Oracle 数据类型 → DM 数据类型。键统一大写,匹配时输入也归一为大写。
// 注释里标出语义差(DATE 是否含时间等)以便人工 review 时不踩坑。
const TYPE_MAP: Record<string, string> = {
  VARCHAR2: 'VARCHAR',
  NVARCHAR2: 'NVARCHAR',
  NUMBER: 'NUMERIC', // Oracle NUMBER 默认 → DM NUMERIC;DM 也认 NUMBER 但 NUMERIC 更标准
  CLOB: 'CLOB', // 同名,保留
  NCLOB: 'NCLOB',
  BLOB: 'BLOB',
  DATE: 'DATE', // ⚠ Oracle DATE 含时间,DM DATE 不含;需要时间用 TIMESTAMP
  TIMESTAMP: 'TIMESTAMP',
  RAW: 'VARBINARY',
  'LONG RAW': 'VARBINARY',
  LONG: 'CLOB', // Oracle LONG → DM CLOB(Oracle 已不建议用 LONG)
  BINARY_FLOAT: 'FLOAT',
  BINARY_DOUBLE: 'DOUBLE',
  /** Oracle 11g+ 行 ID 类型;DM 没有等价,降级 VARCHAR */
  ROWID: 'VARCHAR(18)',
  UROWID: 'VARCHAR(4000)',
  XMLTYPE: 'XML',
}

/** 类型 → DM 的语义差告警(译时按命中追加 warning)。 */
const TYPE_NOTES: Record<string, string> = {
  DATE: 'Oracle DATE 含时分秒,DM DATE 不含;原列若依赖时间分量请改用 TIMESTAMP',
  NUMBER:
    '裸 NUMBER(无精度) → DM NUMERIC 同样不限精度,但部分驱动会按 DECIMAL(38,?) 处理,精度溢出需复核',
  LONG: 'Oracle LONG 已废弃,DM 降级为 CLOB;LONG RAW 同理降级为 VARBINARY',
  ROWID: 'ROWID/UROWID 无等价类型,降级 VARCHAR;若业务依赖物理行号将失效',
  XMLTYPE: 'DM XML 类型功能受限,XPath/XQuery 表达式可能需要重写',
}

// ── 函数 / 关键字映射 ──────────────────────────────────────────
// [正则, 替换串, 说明]。说明只在添加 warning 时用,不影响替换本身。
// 顺序敏感:把"可不替换"的放后面(如 SYSDATE / NVL DM 兼容),前面优先翻译 hard-incompatible。
const FN_MAP: Array<{ re: RegExp; to: string; note: string }> = [
  {
    re: /\bSYSDATE\b/gi,
    to: 'CURRENT_TIMESTAMP',
    note: 'SYSDATE → CURRENT_TIMESTAMP(DM 也接受 SYSDATE,但标准函数更稳)',
  },
  {
    re: /\bSYSTIMESTAMP\b/gi,
    to: 'CURRENT_TIMESTAMP',
    note: 'SYSTIMESTAMP → CURRENT_TIMESTAMP(时区精度可能略有差异)',
  },
  // DUAL 在 DM 中存在,无需替换,但留个 no-op 占位便于将来调整
  { re: /\bDUAL\b/g, to: 'DUAL', note: '' },
  {
    re: /\bNVL\s*\(/gi,
    to: 'COALESCE(',
    note: 'NVL → COALESCE(DM 也兼容 NVL,改写为标准 COALESCE 更跨库)',
  },
  {
    re: /\bNVL2\s*\(/gi,
    to: 'NVL2(',
    note: 'NVL2 在 DM 中保留;若不支持需手工 CASE WHEN expr IS NOT NULL THEN a ELSE b END',
  },
  // ROWNUM 在 DM 也支持,no-op 占位
  { re: /\bROWNUM\b/gi, to: 'ROWNUM', note: '' },
  {
    re: /\bMINUS\b/gi,
    to: 'EXCEPT',
    note: 'MINUS → EXCEPT(DM 也认 MINUS,EXCEPT 更标准)',
  },
]

/** 不易机器翻译的 Oracle 专有语法,只发 warning 让人工 review。 */
const HARD_WARNINGS: Array<{ re: RegExp; msg: string }> = [
  {
    re: /\bDECODE\s*\(/i,
    msg: 'DECODE(...) 仍可在 DM 用,但建议改写为 CASE WHEN 表达式以保证可读性与跨库性',
  },
  {
    re: /\bCONNECT\s+BY\b/i,
    msg: 'CONNECT BY 层次查询:DM 兼容大部分语法,但 NOCYCLE / SYS_CONNECT_BY_PATH 等高级特性需逐句复核',
  },
  {
    re: /\bMERGE\s+INTO\b/i,
    msg: 'MERGE INTO 复杂分支(含 DELETE WHERE / 多源 UPDATE)在 DM 上行为可能不一致,务必跑回归用例',
  },
  {
    re: /\bINSTEAD\s+OF\s+(INSERT|UPDATE|DELETE|TRIGGER)/i,
    msg: 'INSTEAD OF TRIGGER:DM 触发器语义有差异,触发器体需人工迁移',
  },
  {
    re: /\bSDO_GEOMETRY\b|\bMDSYS\./i,
    msg: 'Oracle Spatial (SDO_*) 在 DM 上没有等价,需评估改用 DMGeo 或第三方空间扩展',
  },
  {
    re: /\bDBMS_\w+/i,
    msg: 'DBMS_* 系统包:DM 仅模拟部分(如 DBMS_OUTPUT、DBMS_LOB),业务包(DBMS_SCHEDULER 等)需重写',
  },
  {
    re: /\bUTL_\w+/i,
    msg: 'UTL_* 工具包(UTL_HTTP/UTL_FILE 等)在 DM 上一般不支持,需用外部脚本替代',
  },
  {
    re: /\b(START\s+WITH|INTERVAL\s+\d)\s+(YEAR|MONTH|DAY|HOUR|MINUTE|SECOND)\s+TO\s+/i,
    msg: 'INTERVAL YEAR/DAY TO ... 精度限定:DM 部分版本只支持简化形式,需核对版本',
  },
  {
    re: /\bPIVOT\s*\(|\bUNPIVOT\s*\(/i,
    msg: 'PIVOT/UNPIVOT:DM 8.x 起部分支持,旧版本需改写为 CASE WHEN 聚合',
  },
  {
    re: /\bBULK\s+COLLECT\b|\bFORALL\b/i,
    msg: 'PL/SQL BULK COLLECT / FORALL 批量操作:DM 的 DMSQL 语法略有差异,需重写循环',
  },
]

// ── 翻译 API ───────────────────────────────────────────────────

export interface TranslateResult {
  /** 翻译后的 SQL(类型 + 函数已替换,复杂语法保留原样) */
  sql: string
  /** 需要人工 review 的告警,UI 直接列给用户 */
  warnings: string[]
}

/**
 * 翻译单个 Oracle 数据类型字符串到 DM。
 *
 * 入参可以是裸类型名(`VARCHAR2`)或带长度(`VARCHAR2(255)`),自动识别。
 * 不识别的类型原样回写,不报错——上游表设计器可能用了用户自定义类型。
 *
 * @param dtype 类型字符串,大小写不敏感
 * @param scale 兼容预留;NUMBER 类场景调用方可拼出 NUMERIC(p,s)
 */
export function translateOracleType(dtype: string, scale?: number): string {
  const raw = (dtype ?? '').trim()
  if (!raw) return raw
  // 拆"主类型 + 括号长度"
  // 字符类必须含 0-9,否则 VARCHAR2 / NVARCHAR2 这种类型名直接匹配不上 → 整体回退原样。
  const m = /^([A-Za-z0-9_ ]+?)\s*(\(([^)]*)\))?\s*$/.exec(raw)
  if (!m) return raw
  const baseRaw = m[1] ?? ''
  const len = m[3]
  const base = baseRaw.trim().toUpperCase().replace(/\s+/g, ' ')
  const mapped = TYPE_MAP[base]
  if (!mapped) return raw // 未识别,原样返回
  // NUMBER 特殊:若调用方指定 scale,拼 NUMERIC(p,s)
  if (base === 'NUMBER' && len) {
    // Oracle NUMBER(p) 或 NUMBER(p,s) → DM NUMERIC(p[,s])
    return `${mapped}(${len.trim()})`
  }
  if (base === 'NUMBER' && typeof scale === 'number') {
    return `${mapped}(38,${scale})`
  }
  // 普通带长度类型 → 直接转
  if (len) return `${mapped}(${len.trim()})`
  return mapped
}

/**
 * 翻译 Oracle DDL / SQL 文本到 DM。
 *
 * 策略:
 *  1) 取出所有 "列名 TYPE[(长度)]" 形式的列定义,用 TYPE_MAP 替换主类型
 *  2) 按 FN_MAP 把函数 / 关键字逐个替换
 *  3) 扫一遍 HARD_WARNINGS,命中的加 warning 但不动 SQL
 *  4) 输出 sql + warnings;调用方可在向导预览页 review
 *
 * 故意不做的事:
 *  - 不做 PL/SQL 块(BEGIN...END / 包体 / 触发器体)的语义级翻译;只翻外壳
 *  - 不解析 AST,不识别字符串字面量内"碰巧"出现的 NVL 等(用 \b 边界已足够规避大多数场景)
 *  - 不重排约束声明顺序;DM 一般能容忍
 */
export function translateDdl(oracleDdl: string): TranslateResult {
  const warnings: string[] = []
  let sql = oracleDdl ?? ''
  if (!sql.trim()) return { sql, warnings }

  // Step 1: 类型替换。覆盖列定义("列名 TYPE")与 CAST(... AS TYPE) 两种语境。
  // 为避免误伤标识符,要求类型名两侧是单词边界,且替换前归大写。
  // 多词类型("LONG RAW")必须排在前面单独处理,否则会被 LONG 抢匹配。
  const sortedTypes = Object.keys(TYPE_MAP).sort((a, b) => b.length - a.length)
  for (const t of sortedTypes) {
    // 转义空格:多词类型用 \s+ 匹配中间空白
    const pattern = t.replace(/\s+/g, '\\s+')
    // 后跟可选 (长度),后接空格 / 逗号 / 右括号 / 分号 / 行尾(列定义典型边界)
    const re = new RegExp(`\\b${pattern}\\b(\\s*\\([^)]*\\))?`, 'gi')
    let replaced = false
    sql = sql.replace(re, (_full, lenPart: string | undefined) => {
      replaced = true
      const target = TYPE_MAP[t]
      if (t === 'NUMBER' && !lenPart) {
        // 裸 NUMBER → NUMERIC,不补长度(DM NUMERIC 默认 38 精度)
        return target
      }
      return `${target}${lenPart ?? ''}`
    })
    if (replaced) {
      const note = TYPE_NOTES[t]
      if (note) warnings.push(`[type] ${t}: ${note}`)
    }
  }

  // Step 2: 函数 / 关键字替换。
  for (const { re, to, note } of FN_MAP) {
    if (re.test(sql)) {
      // re 是 /g 的,test 后需要重置 lastIndex 才能再 replace
      re.lastIndex = 0
      sql = sql.replace(re, to)
      if (note) warnings.push(`[fn] ${note}`)
    }
  }

  // Step 3: 复杂语法告警,但保留 SQL 原样。
  for (const { re, msg } of HARD_WARNINGS) {
    if (re.test(sql)) warnings.push(`[review] ${msg}`)
  }

  // 去重 warning(同一类型/函数可能被多语句触发多次,UI 只关心一次)
  const seen = new Set<string>()
  const uniq: string[] = []
  for (const w of warnings) {
    if (seen.has(w)) continue
    seen.add(w)
    uniq.push(w)
  }

  return { sql, warnings: uniq }
}

/**
 * 给一组对象的 Oracle DDL 批量翻译,汇总 warnings。
 * 仅是便利封装,逻辑上等价于 map(translateDdl)。
 */
export function translateBatch(
  items: Array<{ name: string; ddl: string }>,
): Array<{ name: string; result: TranslateResult }> {
  return items.map((it) => ({ name: it.name, result: translateDdl(it.ddl) }))
}

/** 暴露给单测 / 调试用,运行时不依赖。 */
export const __rules = {
  TYPE_MAP,
  FN_MAP,
  HARD_WARNINGS,
} as const
