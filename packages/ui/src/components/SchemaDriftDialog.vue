<script setup lang="ts">/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Schema 漂移检测（D6）：选两个真实连接（源 = 预期 / 基准；目标 = 怀疑漂移的），
 * 拉两边所有表的 DDL（MySQL 用 SHOW CREATE TABLE；PG 拼装 columns + indexes + FK），
 * 出报告（仅源有 / 仅目标有 / 内容不同），并一键生成「让目标对齐到源」的 ALTER 脚本。
 *
 * 与 SchemaSnapshotsDialog 的区别：那个是「同一连接、历史快照」对比；这个是「两个活连接」对比。
 * DDL 抓取走相似套路但独立实现（不交叉 import）：MySQL 直接 SHOW CREATE TABLE，
 * PG 用 information_schema 拼一份简化 DDL（列 + 主键 + 索引 + 外键）。
 *
 * 「对齐脚本」策略选最保守：
 *  - 仅源有 → CREATE TABLE（直接 DDL）
 *  - 仅目标有 → DROP TABLE（注释掉，需要人工去掉注释；防误删）
 *  - 内容不同 → 列 ALTER（增列、删列改为 注释 DROP、改类型 MODIFY/ALTER COLUMN）
 *  正交差异（视图/触发器等）不在范围内。
 */
import type { ConnectionConfig, MetadataNode, QueryResult } from '@db-tool/shared-types'
import { DbDialect, MetaNodeKind } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { confirm as appConfirm, toast } from '../dialog'
import { t } from '../i18n'
import Modal from './Modal.vue'

const client = useDataClient()
const emit = defineEmits<{ close: [] }>()

// ── 状态 ────────────────────────────────────────────────────────────
const conns = ref<ConnectionConfig[]>([])
const srcId = ref('')
const tgtId = ref('')
const scanning = ref(false)
const error = ref<string | null>(null)
/** 对齐脚本预览（追加式，每点一条 diff 行就追加该表的对齐 SQL） */
const alignScript = ref('')
const executing = ref(false)

/** 一张表的"标准化 DDL 单元"：用于对比 + 生成 alter */
interface TableProfile {
  name: string
  /** 原始 DDL 文本（用于人眼对比/展示） */
  ddl: string
  /** 列：name → 简化类型字符串（含 NULL/默认值，用于对比） */
  columns: Map<string, ColInfo>
  /** 索引：name → 列表（INDEX_NAME → columns + unique） */
  indexes: Map<string, IdxInfo>
  /** 外键：name → 描述串（CONSTRAINT_NAME → 列+目标） */
  fks: Map<string, string>
}
interface ColInfo {
  type: string
  nullable: boolean
  defaultValue: string | null
  primaryKey: boolean
}
interface IdxInfo {
  unique: boolean
  columns: string[]
}

/** 单条差异项 */
interface DriftRow {
  table: string
  status: 'only-src' | 'only-tgt' | 'changed'
  /** 列级差异（仅 status=changed 时填） */
  colChanges?: ColChange[]
  /** 索引差异 */
  idxChanges?: string[]
  /** FK 差异 */
  fkChanges?: string[]
  /** 双栏 DDL（用于展开） */
  srcDdl?: string
  tgtDdl?: string
}
interface ColChange {
  column: string
  kind: 'add' | 'drop' | 'modify'
  srcType?: string
  tgtType?: string
}

const drifts = ref<DriftRow[]>([])
const expanded = ref<string | null>(null) // 展开看双栏 DDL 的表名

// ── 辅助：方言归类 ───────────────────────────────────────────────────
function fam(d: DbDialect | undefined): 'mysql' | 'pg' | 'other' {
  if (d && [DbDialect.MySQL, DbDialect.MariaDB, DbDialect.OceanBase].includes(d)) return 'mysql'
  if (
    d &&
    [
      DbDialect.PostgreSQL,
      DbDialect.KingbaseES,
      DbDialect.CockroachDB,
      DbDialect.Greenplum,
      DbDialect.OpenGauss,
    ].includes(d)
  ) {
    return 'pg'
  }
  return 'other'
}
const connOf = (id: string): ConnectionConfig | undefined => conns.value.find((c) => c.id === id)

const supported = computed(() => {
  const s = connOf(srcId.value)
  const tg = connOf(tgtId.value)
  if (!s || !tg) return false
  if (fam(s.dialect) === 'other' || fam(tg.dialect) === 'other') return false
  // 跨方言对比意义不大（语法都对不上），强制同家族
  return fam(s.dialect) === fam(tg.dialect)
})

const summary = computed(() => ({
  onlySrc: drifts.value.filter((d) => d.status === 'only-src').length,
  onlyTgt: drifts.value.filter((d) => d.status === 'only-tgt').length,
  changed: drifts.value.filter((d) => d.status === 'changed').length,
}))

onMounted(async () => {
  try {
    conns.value = await client.connections.list()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
})

// ── 表清单：从 metadata 树拿（兼容多方言，不依赖 information_schema 拼 schema） ──
async function fetchTableList(conn: ConnectionConfig): Promise<MetadataNode[]> {
  const top: MetadataNode[] = await client.connections.metadata(conn.id, {
    parentKind: MetaNodeKind.Connection,
    path: [],
  })
  if (!top.length) return []
  // 简化：默认对第一个 database/schema 做漂移检测（与 SchemaSnapshotsDialog 同口径）
  const first = top[0]
  const tables = await client.connections
    .metadata(conn.id, {
      parentKind: MetaNodeKind.Group,
      path: [...first.path],
      group: 'tables',
    })
    .catch(() => [] as MetadataNode[])
  return tables
}

// ── 抓单表 profile ──────────────────────────────────────────────────
async function fetchProfile(conn: ConnectionConfig, table: MetadataNode): Promise<TableProfile> {
  const f = fam(conn.dialect)
  const tname = table.name
  const ref = table.sqlName ?? table.name
  const prof: TableProfile = {
    name: tname,
    ddl: '',
    columns: new Map(),
    indexes: new Map(),
    fks: new Map(),
  }
  if (f === 'mysql') {
    // 原始 DDL（人眼看）
    try {
      const r = await client.connections.execute(conn.id, `SHOW CREATE TABLE ${ref}`)
      const row = r.rows[0] as Record<string, unknown> | undefined
      prof.ddl = String(row?.['Create Table'] ?? '')
    } catch {
      /* 单表 DDL 失败不致命 */
    }
    // 列（用于对比）
    const schema = (conn.database ?? '').replace(/'/g, "''")
    const esc = tname.replace(/'/g, "''")
    const cols = (await client.connections.execute(
      conn.id,
      `SELECT COLUMN_NAME AS c, COLUMN_TYPE AS ty, IS_NULLABLE AS nul, COLUMN_KEY AS k, COLUMN_DEFAULT AS dflt
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${esc}'
       ORDER BY ORDINAL_POSITION`,
    )) as QueryResult
    for (const row of cols.rows as Record<string, unknown>[]) {
      prof.columns.set(String(row.c), {
        type: String(row.ty),
        nullable: String(row.nul).toUpperCase() === 'YES',
        defaultValue: row.dflt == null ? null : String(row.dflt),
        primaryKey: row.k === 'PRI',
      })
    }
    // 索引
    const idx = (await client.connections.execute(
      conn.id,
      `SELECT INDEX_NAME AS n, COLUMN_NAME AS c, NON_UNIQUE AS nu, SEQ_IN_INDEX AS pos
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${esc}'
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    )) as QueryResult
    for (const row of idx.rows as Record<string, unknown>[]) {
      const n = String(row.n)
      let info = prof.indexes.get(n)
      if (!info) {
        info = { unique: Number(row.nu) === 0, columns: [] }
        prof.indexes.set(n, info)
      }
      info.columns.push(String(row.c))
    }
    // 外键
    const fk = (await client.connections.execute(
      conn.id,
      `SELECT CONSTRAINT_NAME AS n,
        GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) AS cols,
        REFERENCED_TABLE_NAME AS rt,
        GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION) AS rcols
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${esc}' AND REFERENCED_TABLE_NAME IS NOT NULL
       GROUP BY CONSTRAINT_NAME, REFERENCED_TABLE_NAME`,
    )) as QueryResult
    for (const row of fk.rows as Record<string, unknown>[]) {
      prof.fks.set(String(row.n), `(${String(row.cols)}) → ${String(row.rt)}(${String(row.rcols)})`)
    }
  } else if (f === 'pg') {
    const schema = 'public'
    const esc = tname.replace(/'/g, "''")
    // 列
    const cols = (await client.connections.execute(
      conn.id,
      `SELECT column_name AS c, data_type AS ty, is_nullable AS nul, column_default AS dflt
       FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${esc}'
       ORDER BY ordinal_position`,
    )) as QueryResult
    // 主键
    const pkRes = (await client.connections.execute(
      conn.id,
      `SELECT kcu.column_name AS c
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema = '${schema}' AND tc.table_name = '${esc}'`,
    )) as QueryResult
    const pkSet = new Set(pkRes.rows.map((r) => String((r as Record<string, unknown>).c)))
    for (const row of cols.rows as Record<string, unknown>[]) {
      const c = String(row.c)
      prof.columns.set(c, {
        type: String(row.ty),
        nullable: String(row.nul).toUpperCase() === 'YES',
        defaultValue: row.dflt == null ? null : String(row.dflt),
        primaryKey: pkSet.has(c),
      })
    }
    // 索引（PG）：用 pg_indexes 的 indexdef 解析
    try {
      const idx = (await client.connections.execute(
        conn.id,
        `SELECT indexname AS n, indexdef AS def
         FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${esc}'`,
      )) as QueryResult
      for (const row of idx.rows as Record<string, unknown>[]) {
        const def = String(row.def)
        const unique = /CREATE\s+UNIQUE/i.test(def)
        const m = /\(([^)]+)\)/.exec(def)
        const columns = m ? m[1].split(',').map((s) => s.trim().replace(/"/g, '')) : []
        prof.indexes.set(String(row.n), { unique, columns })
      }
    } catch {
      /* PG 索引拉失败不致命 */
    }
    // 外键
    try {
      const fk = (await client.connections.execute(
        conn.id,
        `SELECT tc.constraint_name AS n,
          string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols,
          ccu.table_name AS rt,
          string_agg(ccu.column_name, ',' ORDER BY kcu.ordinal_position) AS rcols
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
         WHERE tc.constraint_type = 'FOREIGN KEY'
           AND tc.table_schema = '${schema}' AND tc.table_name = '${esc}'
         GROUP BY tc.constraint_name, ccu.table_name`,
      )) as QueryResult
      for (const row of fk.rows as Record<string, unknown>[]) {
        prof.fks.set(
          String(row.n),
          `(${String(row.cols)}) → ${String(row.rt)}(${String(row.rcols)})`,
        )
      }
    } catch {
      /* FK 拉失败不致命 */
    }
    // 简化 DDL（人眼看）
    prof.ddl = composePgDdl(ref, prof)
  }
  return prof
}

function composePgDdl(tableRef: string, p: TableProfile): string {
  const colLines: string[] = []
  for (const [name, info] of p.columns) {
    colLines.push(
      `  ${name} ${info.type}${info.nullable ? '' : ' NOT NULL'}${
        info.defaultValue ? ` DEFAULT ${info.defaultValue}` : ''
      }${info.primaryKey ? ' PRIMARY KEY' : ''}`,
    )
  }
  const idxLines: string[] = []
  for (const [n, info] of p.indexes) {
    idxLines.push(`-- ${info.unique ? 'UNIQUE ' : ''}INDEX ${n} (${info.columns.join(', ')})`)
  }
  const fkLines: string[] = []
  for (const [n, d] of p.fks) fkLines.push(`-- FK ${n} ${d}`)
  return [`CREATE TABLE ${tableRef} (`, colLines.join(',\n'), ');', ...idxLines, ...fkLines].join(
    '\n',
  )
}

// ── 对比两份 profile → DriftRow ──────────────────────────────────────
function diffProfiles(src: TableProfile, tgt: TableProfile): DriftRow | null {
  const colChanges: ColChange[] = []
  const allCols = new Set([...src.columns.keys(), ...tgt.columns.keys()])
  for (const c of allCols) {
    const a = src.columns.get(c)
    const b = tgt.columns.get(c)
    if (a && !b) colChanges.push({ column: c, kind: 'add', srcType: a.type })
    else if (!a && b) colChanges.push({ column: c, kind: 'drop', tgtType: b.type })
    else if (a && b) {
      const sigA = `${a.type}|${a.nullable}|${a.defaultValue}|${a.primaryKey}`
      const sigB = `${b.type}|${b.nullable}|${b.defaultValue}|${b.primaryKey}`
      if (sigA !== sigB) {
        colChanges.push({ column: c, kind: 'modify', srcType: a.type, tgtType: b.type })
      }
    }
  }
  const idxChanges: string[] = []
  const allIdx = new Set([...src.indexes.keys(), ...tgt.indexes.keys()])
  for (const n of allIdx) {
    const a = src.indexes.get(n)
    const b = tgt.indexes.get(n)
    if (a && !b) idxChanges.push(`+ ${n}`)
    else if (!a && b) idxChanges.push(`- ${n}`)
    else if (a && b && (a.unique !== b.unique || a.columns.join(',') !== b.columns.join(','))) {
      idxChanges.push(`~ ${n}`)
    }
  }
  const fkChanges: string[] = []
  const allFk = new Set([...src.fks.keys(), ...tgt.fks.keys()])
  for (const n of allFk) {
    const a = src.fks.get(n)
    const b = tgt.fks.get(n)
    if (a && !b) fkChanges.push(`+ ${n} ${a}`)
    else if (!a && b) fkChanges.push(`- ${n} ${b}`)
    else if (a && b && a !== b) fkChanges.push(`~ ${n}`)
  }
  if (!colChanges.length && !idxChanges.length && !fkChanges.length) return null
  return {
    table: src.name,
    status: 'changed',
    colChanges,
    idxChanges,
    fkChanges,
    srcDdl: src.ddl,
    tgtDdl: tgt.ddl,
  }
}

// ── 扫描 ────────────────────────────────────────────────────────────
async function runScan(): Promise<void> {
  const s = connOf(srcId.value)
  const tg = connOf(tgtId.value)
  if (!s || !tg) return
  scanning.value = true
  error.value = null
  drifts.value = []
  alignScript.value = ''
  expanded.value = null
  try {
    const [srcTables, tgtTables] = await Promise.all([fetchTableList(s), fetchTableList(tg)])
    const srcNames = new Set(srcTables.map((t) => t.name))
    const tgtNames = new Set(tgtTables.map((t) => t.name))

    // 仅源有
    for (const t of srcTables) {
      if (!tgtNames.has(t.name)) {
        // 顺手抓源端 DDL，方便生成 CREATE
        const prof = await fetchProfile(s, t).catch(
          () =>
            ({
              name: t.name,
              ddl: '',
              columns: new Map(),
              indexes: new Map(),
              fks: new Map(),
            }) as TableProfile,
        )
        drifts.value.push({ table: t.name, status: 'only-src', srcDdl: prof.ddl })
      }
    }
    // 仅目标有
    for (const t of tgtTables) {
      if (!srcNames.has(t.name)) {
        const prof = await fetchProfile(tg, t).catch(
          () =>
            ({
              name: t.name,
              ddl: '',
              columns: new Map(),
              indexes: new Map(),
              fks: new Map(),
            }) as TableProfile,
        )
        drifts.value.push({ table: t.name, status: 'only-tgt', tgtDdl: prof.ddl })
      }
    }
    // 都有 → 对比
    for (const t of srcTables) {
      if (!tgtNames.has(t.name)) continue
      const tgtT = tgtTables.find((x) => x.name === t.name)
      if (!tgtT) continue
      try {
        const [a, b] = await Promise.all([fetchProfile(s, t), fetchProfile(tg, tgtT)])
        const row = diffProfiles(a, b)
        if (row) drifts.value.push(row)
      } catch (e) {
        // 单表失败：记录但不中断整次扫描
        drifts.value.push({
          table: t.name,
          status: 'changed',
          colChanges: [],
          idxChanges: [`!! ${e instanceof Error ? e.message : String(e)}`],
          fkChanges: [],
        })
      }
    }
    if (!drifts.value.length) toast.success(t('drift.noDrift'))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    scanning.value = false
  }
}

// ── 生成对齐 SQL（追加到脚本预览） ───────────────────────────────────
function alignFor(row: DriftRow): string {
  const tg = connOf(tgtId.value)
  if (!tg) return ''
  const f = fam(tg.dialect)
  const q = (s: string): string => (f === 'mysql' ? `\`${s}\`` : `"${s}"`)
  const lines: string[] = []
  lines.push(`-- ${t('drift.alignFor')} ${row.table}`)
  if (row.status === 'only-src') {
    // 让目标"补建"这张表：直接抄源端 DDL
    if (row.srcDdl) {
      lines.push(row.srcDdl.trim().endsWith(';') ? row.srcDdl.trim() : `${row.srcDdl.trim()};`)
    } else {
      lines.push(`-- ${t('drift.noSrcDdl')}`)
    }
  } else if (row.status === 'only-tgt') {
    // 让目标"删掉"多余的表：注释掉防止误删
    lines.push(`-- DROP TABLE ${q(row.table)}; -- ${t('drift.dropHint')}`)
  } else {
    // 列差异
    for (const ch of row.colChanges ?? []) {
      if (ch.kind === 'add') {
        lines.push(
          `ALTER TABLE ${q(row.table)} ADD COLUMN ${q(ch.column)} ${ch.srcType ?? 'TEXT'};`,
        )
      } else if (ch.kind === 'drop') {
        // 删列默认注释
        lines.push(
          `-- ALTER TABLE ${q(row.table)} DROP COLUMN ${q(ch.column)}; -- ${t('drift.dropColHint')}`,
        )
      } else {
        if (f === 'mysql') {
          lines.push(
            `ALTER TABLE ${q(row.table)} MODIFY COLUMN ${q(ch.column)} ${ch.srcType ?? ''};`,
          )
        } else {
          lines.push(
            `ALTER TABLE ${q(row.table)} ALTER COLUMN ${q(ch.column)} TYPE ${ch.srcType ?? ''};`,
          )
        }
      }
    }
    // 索引差异：只给出提示，不自动生成（索引 DDL 复杂，留人工）
    for (const i of row.idxChanges ?? []) lines.push(`-- INDEX ${i}`)
    for (const fk of row.fkChanges ?? []) lines.push(`-- FK ${fk}`)
  }
  return `${lines.join('\n')}\n`
}

function appendAlign(row: DriftRow): void {
  const sql = alignFor(row)
  if (!sql) return
  alignScript.value = (alignScript.value ? `${alignScript.value}\n` : '') + sql
}
function clearScript(): void {
  alignScript.value = ''
}
function copyScript(): void {
  if (alignScript.value) void navigator.clipboard?.writeText(alignScript.value)
}

async function execScript(): Promise<void> {
  if (!alignScript.value.trim() || !tgtId.value) return
  const ok = await appConfirm({
    message: t('drift.execConfirm'),
    variant: 'danger',
    confirmText: t('drift.execScript'),
  })
  if (!ok) return
  executing.value = true
  try {
    // 简单按分号切（注释/字符串里有分号会出问题，但本脚本由我们自己生成，比较安全）
    const stmts = alignScript.value
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('--'))
    await client.connections.executeBatch(tgtId.value, stmts)
    toast.success(t('drift.execDone'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    executing.value = false
  }
}
</script>

<template>
  <Modal :title="t('drift.title')" width="xl" fixed-height storage-key="schema-drift" @close="emit('close')">
    <div class="drift">
      <!-- 连接选择 -->
      <div class="pickers">
        <div class="side">
          <label>{{ t('drift.sourceConn') }}</label>
          <select v-model="srcId">
            <option value="" disabled>{{ t('diff.selectConn') }}</option>
            <option v-for="c in conns" :key="c.id" :value="c.id">
              {{ c.name }} · {{ c.dialect }}
            </option>
          </select>
        </div>
        <span class="arrow">→</span>
        <div class="side">
          <label>{{ t('drift.targetConn') }}</label>
          <select v-model="tgtId">
            <option value="" disabled>{{ t('diff.selectConn') }}</option>
            <option v-for="c in conns" :key="c.id" :value="c.id">
              {{ c.name }} · {{ c.dialect }}
            </option>
          </select>
        </div>
        <button
          class="primary scan-btn"
          :disabled="scanning || !supported || !srcId || !tgtId"
          @click="runScan"
        >
          {{ scanning ? t('drift.scanning') : t('drift.scan') }}
        </button>
      </div>
      <div v-if="srcId && tgtId && !supported" class="warn">{{ t('drift.unsupported') }}</div>
      <div v-if="error" class="banner err">✗ {{ error }}</div>

      <!-- 结果三栏 -->
      <div v-if="drifts.length" class="report">
        <div class="col">
          <div class="col-h">
            {{ t('drift.onlyInSource') }} <span class="cnt">{{ summary.onlySrc }}</span>
          </div>
          <div class="col-body">
            <div
              v-for="d in drifts.filter((x) => x.status === 'only-src')"
              :key="d.table"
              class="row only-src"
              :class="{ on: expanded === d.table }"
              @click="expanded = expanded === d.table ? null : d.table"
            >
              <span class="t-name">{{ d.table }}</span>
              <button class="ghost sm" @click.stop="appendAlign(d)">
                + {{ t('drift.alignBtn') }}
              </button>
            </div>
          </div>
        </div>

        <div class="col">
          <div class="col-h">
            {{ t('drift.onlyInTarget') }} <span class="cnt">{{ summary.onlyTgt }}</span>
          </div>
          <div class="col-body">
            <div
              v-for="d in drifts.filter((x) => x.status === 'only-tgt')"
              :key="d.table"
              class="row only-tgt"
              :class="{ on: expanded === d.table }"
              @click="expanded = expanded === d.table ? null : d.table"
            >
              <span class="t-name">{{ d.table }}</span>
              <button class="ghost sm" @click.stop="appendAlign(d)">
                + {{ t('drift.alignBtn') }}
              </button>
            </div>
          </div>
        </div>

        <div class="col">
          <div class="col-h">
            {{ t('drift.different') }} <span class="cnt">{{ summary.changed }}</span>
          </div>
          <div class="col-body">
            <div
              v-for="d in drifts.filter((x) => x.status === 'changed')"
              :key="d.table"
              class="row changed"
              :class="{ on: expanded === d.table }"
              @click="expanded = expanded === d.table ? null : d.table"
            >
              <div class="row-top">
                <span class="t-name">{{ d.table }}</span>
                <button class="ghost sm" @click.stop="appendAlign(d)">
                  + {{ t('drift.alignBtn') }}
                </button>
              </div>
              <div class="badges">
                <span
                  v-for="ch in d.colChanges ?? []"
                  :key="`c-${ch.column}`"
                  class="badge"
                  :class="ch.kind"
                  >{{ ch.kind === 'add' ? '+' : ch.kind === 'drop' ? '−' : '~' }}{{ ch.column }}</span
                >
                <span v-for="ix in d.idxChanges ?? []" :key="`i-${ix}`" class="badge idx">{{
                  ix
                }}</span>
                <span v-for="fk in d.fkChanges ?? []" :key="`f-${fk}`" class="badge fk">{{
                  fk
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 展开行的双栏 DDL diff -->
      <div v-if="expanded" class="ddl-panes">
        <div class="ddl-pane">
          <div class="pane-h">{{ t('drift.sourceDdl') }} — {{ expanded }}</div>
          <pre>{{ drifts.find((d) => d.table === expanded)?.srcDdl ?? '—' }}</pre>
        </div>
        <div class="ddl-pane">
          <div class="pane-h">{{ t('drift.targetDdl') }} — {{ expanded }}</div>
          <pre>{{ drifts.find((d) => d.table === expanded)?.tgtDdl ?? '—' }}</pre>
        </div>
      </div>

      <!-- 对齐脚本预览 -->
      <div class="script">
        <div class="script-h">
          <span>{{ t('drift.alignScript') }}</span>
          <span class="grow" />
          <button class="ghost sm" :disabled="!alignScript" @click="clearScript">
            {{ t('drift.clear') }}
          </button>
          <button class="ghost sm" :disabled="!alignScript" @click="copyScript">
            {{ t('common.copy') }}
          </button>
          <button
            class="danger sm"
            :disabled="!alignScript || executing"
            @click="execScript"
          >
            {{ executing ? '…' : t('drift.execScript') }}
          </button>
        </div>
        <pre v-if="alignScript" class="sql">{{ alignScript }}</pre>
        <div v-else class="empty">{{ t('drift.scriptEmpty') }}</div>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.drift {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
}
.pickers {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
.side {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.side label {
  font-size: 12px;
  color: var(--muted);
}
.side select {
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.arrow {
  padding-bottom: 8px;
  color: var(--muted);
}
.scan-btn {
  align-self: flex-end;
  padding: 6px 16px;
}
.warn {
  font-size: 12px;
  color: #e0a020;
}
.banner.err {
  color: var(--err, #e04050);
  font-size: 13px;
}
.report {
  display: grid;
  grid-template-columns: 1fr 1fr 1.4fr;
  gap: 8px;
  min-height: 180px;
  max-height: 280px;
}
.col {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  min-height: 0;
}
.col-h {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--muted);
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 6px;
}
.col-h .cnt {
  margin-left: auto;
  font-family: ui-monospace, monospace;
  color: var(--text);
}
.col-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  font-size: 12px;
}
.row:hover {
  background: rgba(124, 108, 255, 0.06);
}
.row.on {
  background: rgba(124, 108, 255, 0.14);
}
.row.only-src .t-name {
  color: #4caf50;
}
.row.only-tgt .t-name {
  color: var(--err, #e04050);
}
.row.changed .t-name {
  color: #e0a020;
}
.row-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.t-name {
  flex: 1;
  font-family: ui-monospace, monospace;
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  background: rgba(124, 108, 255, 0.18);
  color: var(--text);
}
.badge.add {
  background: rgba(76, 175, 80, 0.25);
}
.badge.drop {
  background: rgba(224, 64, 80, 0.25);
}
.badge.modify {
  background: rgba(224, 160, 32, 0.25);
}
.badge.idx {
  background: rgba(124, 108, 255, 0.25);
}
.badge.fk {
  background: rgba(80, 160, 224, 0.25);
}
.ghost.sm {
  padding: 2px 8px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.ghost.sm:hover {
  background: rgba(124, 108, 255, 0.08);
}
.ghost.sm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ddl-panes {
  display: flex;
  gap: 8px;
  min-height: 160px;
  max-height: 220px;
}
.ddl-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.pane-h {
  padding: 4px 8px;
  background: var(--panel);
  font-size: 11px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}
.ddl-pane pre {
  flex: 1;
  margin: 0;
  padding: 6px 8px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
  background: var(--bg);
}
.script {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 120px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.script-h {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--panel);
  font-size: 12px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}
.script-h .grow {
  flex: 1;
}
.danger.sm {
  padding: 2px 10px;
  font-size: 11px;
  border: 1px solid var(--err, #e04050);
  border-radius: 4px;
  background: var(--err, #e04050);
  color: #fff;
  cursor: pointer;
}
.danger.sm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sql {
  flex: 1;
  margin: 0;
  padding: 8px 10px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  overflow: auto;
  background: var(--bg);
}
.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--muted);
}
</style>
