/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创迁移 —— 抽象数据库模型(Logical IR)。
 *
 * 核心思路:不写「源库→目标库」的两两翻译器(N×M 爆炸),而是 hub-and-spoke:
 *   源库 DDL/元数据 ──parse──▶ Logical IR ──emit──▶ 目标库 DDL
 * 每个库只需 1 个 parser(→IR)+ 1 个 emitter(IR→),加库是 N+M 而非 N×M。
 *
 * 边界(已与用户确认):**结构走 IR,过程体交 AI**。
 *   - 表/列/类型/约束/索引/序列 → 确定性映射进 IR,emit 出目标 DDL
 *   - PL/SQL 过程体、复杂 SQL 表达式(CONNECT BY / DECODE / MERGE …)→ 原样挂在
 *     {@link LogicalProcedural} 上,标 needsAi,交 aiConvert 按 源→目标 翻译
 *
 * 本模块只定义模型与接口,无方言实现、无副作用,便于单测。
 */
import type { DbDialect } from '@db-tool/shared-types'

// ── 逻辑类型系统 ────────────────────────────────────────────────

/** 与具体方言无关的逻辑类型类目。 */
export type LogicalTypeKind =
  | 'string' // 定长/变长字符:length + fixed
  | 'text' // 无界文本(CLOB/TEXT)
  | 'integer' // 整数:bytes 决定宽度(2/4/8)
  | 'decimal' // 定点:precision + scale
  | 'float' // 浮点:precision 区分 real/double
  | 'boolean'
  | 'date' // 仅日期
  | 'time'
  | 'datetime' // 时间戳;withTimezone
  | 'interval'
  | 'binary' // 二进制(BLOB/RAW/bytea)
  | 'json'
  | 'xml'
  | 'uuid'
  | 'rowid' // Oracle 伪列类型,无通用等价
  | 'unknown' // 用户自定义 / 无法解析 → 保留 raw

/** 逻辑类型:源库类型解析成它,目标库再从它生成本地类型。 */
export interface LogicalType {
  kind: LogicalTypeKind
  /** 字符长度 或 二进制字节数。 */
  length?: number
  /** decimal 精度 / datetime 小数秒精度 / float 二进制位。 */
  precision?: number
  /** decimal 标度。 */
  scale?: number
  /** CHAR(true) vs VARCHAR(false)。 */
  fixed?: boolean
  /** 整数字节宽度(2=smallint,4=int,8=bigint)。 */
  bytes?: number
  /** 带时区(TIMESTAMP WITH TIME ZONE)。 */
  withTimezone?: boolean
  /** Unicode 变体(NVARCHAR2/NCHAR)。 */
  unicode?: boolean
  /** kind==='unknown' 时保留的源类型原文;也用于复核展示。 */
  raw?: string
}

// ── 转换告警(带分级,替代旧的字符串前缀约定) ──────────────────

/** 告警级别。info=语义差提示;review=需人工/AI 改写;blocker=无等价能力。 */
export type NoteLevel = 'info' | 'review' | 'blocker'

export interface ConvertNote {
  level: NoteLevel
  msg: string
}

export const note = (level: NoteLevel, msg: string): ConvertNote => ({ level, msg })

// ── 逻辑对象 ────────────────────────────────────────────────────

export type LogicalObjectKind =
  | 'table'
  | 'view'
  | 'sequence'
  | 'index'
  | 'synonym'
  | 'function'
  | 'procedure'
  | 'package'
  | 'trigger'
  | 'type'

export interface LogicalColumn {
  name: string
  type: LogicalType
  nullable: boolean
  /** 默认值表达式原文(可能含 SYSDATE 等,emit 时尽量改写,改不动则标 review)。 */
  default?: string
  comment?: string
  /** 解析该列时累积的语义差提示。 */
  notes?: ConvertNote[]
}

/** 唯一约束(列级 UNIQUE)。 */
export interface LogicalUnique {
  name?: string
  columns: string[]
}

/** 检查约束;expr 原文(可能含源库专有函数,emit 时若识别不了标 review)。 */
export interface LogicalCheck {
  name?: string
  expr: string
}

/** 索引(schema 级,引用所属表)。 */
export interface LogicalIndex {
  name: string
  table: string
  /** 表所在 schema;设了就生成限定名(避免 search_path 依赖)。 */
  schema?: string
  columns: string[]
  unique?: boolean
  /** 函数/表达式索引的原文;有则 columns 可能为空,emit 时标 review。 */
  expr?: string
}

/** 外键(schema 级,引用两张表)。 */
export interface LogicalForeignKey {
  name?: string
  table: string
  /** 子表所在 schema。 */
  schema?: string
  columns: string[]
  refTable: string
  /** 父表所在 schema(可跨 schema);缺省同 schema。 */
  refSchema?: string
  refColumns: string[]
  /** ON DELETE 行为(CASCADE / SET NULL / RESTRICT / NO ACTION)。 */
  onDelete?: string
}

export interface LogicalTable {
  kind: 'table'
  schema: string
  name: string
  columns: LogicalColumn[]
  primaryKey?: string[]
  uniques?: LogicalUnique[]
  checks?: LogicalCheck[]
  comment?: string
}

export interface LogicalSequence {
  kind: 'sequence'
  schema: string
  name: string
  start?: number
  increment?: number
  minValue?: number
  maxValue?: number
  cache?: number
  cycle?: boolean
}

/**
 * 过程化 / 复杂对象:不做确定性翻译,原样保留源 DDL 交给 AI。
 * 视图也归这里(SELECT 体可能含 Oracle 专有语法,确定性翻不稳)。
 */
export interface LogicalProcedural {
  kind: 'view' | 'function' | 'procedure' | 'package' | 'trigger' | 'type' | 'synonym' | 'index'
  schema: string
  name: string
  /** 源库原始 DDL。 */
  rawBody: string
  sourceDialect: DbDialect
}

export type LogicalObject = LogicalTable | LogicalSequence | LogicalProcedural

// ── 方言插件接口 ────────────────────────────────────────────────

/** 源库 → IR。每个源方言实现一个。 */
export interface DialectParser {
  dialect: DbDialect
  /** 解析单个本地类型字符串到逻辑类型(带语义差提示)。 */
  parseType(native: string): { type: LogicalType; notes: ConvertNote[] }
}

/** IR → 目标库。每个目标方言实现一个。 */
export interface DialectEmitter {
  dialect: DbDialect
  /** 由逻辑类型生成本地类型字符串(带语义差提示)。 */
  emitType(t: LogicalType): { sql: string; notes: ConvertNote[] }
  /** 标识符加引号(各库大小写/保留字策略不同)。 */
  quoteId(id: string): string
  /** 改写列默认值表达式;改不动返回 null 让上层标 review。 */
  emitDefault?(expr: string): { sql: string; notes: ConvertNote[] } | null
  /** 生成 CREATE SEQUENCE(各库 START WITH vs START 等关键字不同)。 */
  emitSequence?(seq: LogicalSequence): string
  /** 注释风格:'on'=独立 COMMENT ON 语句(PG/Oracle/DM);'inline'=写进 CREATE TABLE(MySQL)。缺省 'on'。 */
  commentStyle?: 'on' | 'inline'
  /** CREATE TABLE 结尾追加(如 MySQL 的 ` ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)。 */
  tableSuffix?: string
}
