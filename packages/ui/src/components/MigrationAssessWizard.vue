<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 信创「去O」迁移评估向导
 *
 * 把一个 Oracle/DM 源库评估成「迁去 openGauss 系国产库」的可行性报告。5 步:
 *   1) 连接   :选源库(可画像方言)+ 目标库(有结构转换通道的方言)
 *   2) 画像   :列 database/schema(过滤系统),勾选要迁的 schema,出对象数/表数/
 *               行数分桶(≥100万/1000万/1亿)/表空间大小 —— 源库精准画像
 *   3) 评估   :拉所选 schema 的对象,确定性 IR 转换打 A/B/C/D 等级 + 就绪度
 *   4) AI 转换:把 C 级(PL/SQL 过程体等)逐个交 AI 翻成目标方言(只读,供复核)
 *   5) 报告   :Markdown 汇总,可复制 / 落盘
 *
 * 逻辑全在 ../migrate/*(已单测 + 活库验证);本组件只做编排 + 展示。
 * 集成:父组件 ref 本组件,调 open();不直接挂菜单。
 */
import {
  type ConnectionConfig,
  type DbDialect,
  MetaNodeKind,
  type MetadataNode,
} from '@db-tool/shared-types'
import { computed, ref } from 'vue'
import { useDataClient } from '../data-client'
import { formatBytes, objectDdlQuery } from '../ddl'
import { confirm, toast } from '../dialog'
import { reportError } from '../errorReporter'
import { locale } from '../i18n'
import { convertObjectValidated } from '../migrate/aiConvert'
import { type ApplyResult, applyScript } from '../migrate/apply'
import { assessBatch } from '../migrate/assess'
import { convertSchema, hasStructuralPath } from '../migrate/convert'
import {
  buildColumnStats,
  buildCount,
  buildInsertParams,
  buildPagedSelect,
  chunkRows,
  compareColumnStats,
  copyTable,
  maxRowsPerInsert,
  parseColumnStats,
  reconcile,
  runPool,
  supportsConflictSkip,
} from '../migrate/dataMigrate'
import { buildExcel, buildHtmlDoc, openPrintWindow } from '../migrate/export'
import { canIntrospect, readSchema } from '../migrate/introspect'
import {
  type JobSummary,
  type MigJob,
  deleteJob,
  listJobs,
  loadJob,
  newJobId,
  saveJob,
} from '../migrate/jobStore'
import { type PreflightIssue, checkTable, summarize } from '../migrate/preflight'
import {
  CATEGORY_LABEL,
  type DatabaseInfo,
  OBJECT_CATEGORIES,
  type ObjectCategory,
  type ObjectInventory,
  type SchemaInfo,
  type SourceProfile,
  canProfile,
  profileSource,
} from '../migrate/profile'
import { buildReport } from '../migrate/report'
import {
  type AssessInput,
  type AssessItem,
  type AssessSummary,
  type ConvertResult,
  GRADE_LABEL,
} from '../migrate/types'
import { type StmtRunner, supportsTxnValidation } from '../migrate/validate'
import { saveFileWithDialog } from '../saveFile'
import Modal from './Modal.vue'

const client = useDataClient()
/** 自包含双语助手(本付费组件不铺 i18n.ts)。 */
const L = (zh: string, en: string): string => (locale.value === 'en' ? en : zh)

/** 盘点类目标签(随界面语言)。 */
const catLabel = (c: ObjectCategory): string => {
  const [zh, en] = CATEGORY_LABEL[c]
  return L(zh, en)
}
/** 盘点单元格:数字或 —(库不支持/未取到)。 */
const invCell = (inv: ObjectInventory, c: ObjectCategory): string => {
  const v = inv[c]
  return v == null ? '—' : String(v)
}
/** 风险指标:数字或 —。 */
const metricCell = (v: number | null | undefined): string => (v == null ? '—' : String(v))
/** 暴露给模板的类目常量。 */
const CATEGORIES = OBJECT_CATEGORIES

// ── 步骤 ────────────────────────────────────────────────────────
type StepId = 'conn' | 'profile' | 'assess' | 'convert' | 'report' | 'migrate'
const STEPS: { id: StepId; label: () => string }[] = [
  { id: 'conn', label: () => L('连接', 'Connect') },
  { id: 'profile', label: () => L('源库画像', 'Profile') },
  { id: 'assess', label: () => L('评估', 'Assess') },
  { id: 'convert', label: () => L('AI 转换', 'AI Convert') },
  { id: 'report', label: () => L('报告', 'Report') },
  { id: 'migrate', label: () => L('数据迁移', 'Data') },
]
const open = ref(false)
const step = ref<StepId>('conn')
const stepIdx = (s: StepId): number => STEPS.findIndex((x) => x.id === s)

// ── Step 1:连接 ────────────────────────────────────────────────
const conns = ref<ConnectionConfig[]>([])
const srcConnId = ref('')
const tgtConnId = ref('')
const loadingConns = ref(false)

const srcConn = computed(() => conns.value.find((c) => c.id === srcConnId.value))
const tgtConn = computed(() => conns.value.find((c) => c.id === tgtConnId.value))
const srcDialect = computed(() => srcConn.value?.dialect)
const tgtDialect = computed(() => tgtConn.value?.dialect)
/** 源库:能画像的(Oracle/DM/PG 系)。 */
const sourceConns = computed(() => conns.value.filter((c) => canProfile(c.dialect)))
/** 目标库:有确定性结构转换通道的(PG 系 / DM)。 */
const targetConns = computed(() =>
  conns.value.filter((c) => srcDialect.value && hasStructuralPath(srcDialect.value, c.dialect)),
)
const connReady = computed(
  () =>
    !!srcConnId.value &&
    !!tgtConnId.value &&
    srcConnId.value !== tgtConnId.value &&
    !!srcDialect.value &&
    !!tgtDialect.value &&
    hasStructuralPath(srcDialect.value, tgtDialect.value),
)

async function loadConns(): Promise<void> {
  loadingConns.value = true
  try {
    conns.value = await client.connections.list()
  } catch (e) {
    reportError(e, { tag: 'mig.loadConns' })
  } finally {
    loadingConns.value = false
  }
}

/** 包 execute 成 profiler / DDL 用的行执行器。 */
const execRows = (sql: string): Promise<Array<Record<string, unknown>>> =>
  client.connections.execute(srcConnId.value, sql).then((r) => r.rows)

// ── Step 2:画像 ────────────────────────────────────────────────
const profiling = ref(false)
const profile = ref<SourceProfile | null>(null)
const databases = ref<DatabaseInfo[]>([])
const schemas = ref<SchemaInfo[]>([])
const pickedSchemas = ref<Set<string>>(new Set())
const showSystem = ref(false)

const visibleSchemas = computed(() =>
  showSystem.value ? schemas.value : schemas.value.filter((s) => !s.system),
)

async function runProfileList(): Promise<void> {
  if (!srcDialect.value) return
  profiling.value = true
  try {
    const p = await profileSource(execRows, srcDialect.value, { schemas: [] })
    databases.value = p.databases
    schemas.value = p.schemas
    // 默认勾选所有非系统 schema
    pickedSchemas.value = new Set(p.schemas.filter((s) => !s.system).map((s) => s.name))
  } catch (e) {
    reportError(e, { tag: 'mig.profileList' })
    toast.info(L('画像失败,请检查源库权限', 'Profiling failed — check source privileges'))
  } finally {
    profiling.value = false
  }
}

function toggleSchema(name: string): void {
  const s = new Set(pickedSchemas.value)
  s.has(name) ? s.delete(name) : s.add(name)
  pickedSchemas.value = s
}

async function runDeepProfile(): Promise<void> {
  if (!srcDialect.value) return
  const picks = [...pickedSchemas.value]
  if (!picks.length) {
    toast.info(L('请至少勾选一个 schema', 'Pick at least one schema'))
    return
  }
  profiling.value = true
  try {
    profile.value = await profileSource(execRows, srcDialect.value, { schemas: picks })
  } catch (e) {
    reportError(e, { tag: 'mig.deepProfile' })
  } finally {
    profiling.value = false
  }
}

// ── Step 3:评估 ────────────────────────────────────────────────
const assessing = ref(false)
const assessProgress = ref('')
const summary = ref<AssessSummary | null>(null)

/** metadata group → 迁移对象类型。 */
const PROC_GROUPS: Array<[group: string, kind: AssessInput['kind']]> = [
  ['views', 'view'],
  ['functions', 'function'],
  ['procedures', 'procedure'],
  ['packages', 'package'],
  ['triggers', 'trigger'],
  ['types', 'type'],
  ['sequences', 'sequence'],
  ['synonyms', 'synonym'],
]

async function meta(path: string[], group: string): Promise<MetadataNode[]> {
  return client.connections
    .metadata(srcConnId.value, { parentKind: MetaNodeKind.Group, path, group })
    .catch(() => [])
}

async function runAssess(): Promise<void> {
  if (!srcDialect.value || !tgtDialect.value) return
  assessing.value = true
  assessProgress.value = ''
  try {
    const inputs: AssessInput[] = []
    for (const schema of pickedSchemas.value) {
      // 表:拉列元数据走确定性 IR
      const tableNodes = await meta([schema], 'tables')
      for (const tn of tableNodes) {
        assessProgress.value = L(`读取表 ${schema}.${tn.name}`, `Reading ${schema}.${tn.name}`)
        const cols = await meta([schema, tn.name], 'columns')
        inputs.push({
          kind: 'table',
          schema,
          name: tn.name,
          columns: cols.map((c) => ({
            name: c.name,
            dataType: c.detail?.dataType ?? '',
            nullable: c.detail?.nullable ?? true,
            default: c.detail?.defaultValue == null ? undefined : String(c.detail.defaultValue),
            comment: c.detail?.comment,
          })),
          primaryKey: cols.filter((c) => c.detail?.primaryKey).map((c) => c.name),
        })
      }
      // 过程化对象:只记类型/名,DDL 留到 AI 转换阶段再拉
      for (const [group, kind] of PROC_GROUPS) {
        const nodes = await meta([schema], group)
        for (const n of nodes) inputs.push({ kind, schema, name: n.name })
      }
    }
    summary.value = assessBatch(inputs, srcDialect.value, tgtDialect.value)
    conversions.value = []
  } catch (e) {
    reportError(e, { tag: 'mig.assess' })
  } finally {
    assessing.value = false
    assessProgress.value = ''
  }
}

const gradeOrder = ['A', 'B', 'C', 'D'] as const
function gradeText(g: 'A' | 'B' | 'C' | 'D'): string {
  const [zh, en] = GRADE_LABEL[g]
  return `${g} ${L(zh, en)}`
}

// ── Step 4:AI 转换 ─────────────────────────────────────────────
const converting = ref(false)
const convertProgress = ref({ done: 0, total: 0 })
const conversions = ref<ConvertResult[]>([])
let abort: AbortController | null = null

const aiItems = computed<AssessItem[]>(() => summary.value?.items.filter((i) => i.needsAi) ?? [])

/** 取单个对象的源 DDL(过程体)供 AI 翻译。 */
async function fetchDdl(item: AssessItem): Promise<string> {
  if (!srcDialect.value) return ''
  const ref0 = `${item.schema}.${item.name}`
  const q = objectDdlQuery(srcDialect.value, item.kind as never, ref0)
  if (!q) return ''
  try {
    const r = await client.connections.execute(srcConnId.value, q.sql)
    const row = r.rows[0] ?? {}
    const k = Object.keys(row).find((x) => /ddl|text|definition|body/i.test(x))
    return String(row[k ?? Object.keys(row)[0] ?? ''] ?? '').trim()
  } catch {
    return ''
  }
}

const selfRepair = ref(true)
/** 目标库支持事务内 DDL 校验(PG 系)才能开自修复。 */
const canSelfRepair = computed(() => !!tgtDialect.value && supportsTxnValidation(tgtDialect.value))

async function runConvert(): Promise<void> {
  if (!srcDialect.value || !tgtDialect.value) return
  const items = aiItems.value
  if (!items.length) {
    toast.info(L('没有需要 AI 转换的对象', 'Nothing needs AI conversion'))
    return
  }
  // 在目标库事务内跑 DDL 做校验(BEGIN…ROLLBACK,不留痕);出错回喂 AI 自修复。
  const targetRun: StmtRunner = async (sql) => {
    try {
      await client.connections.execute(tgtConnId.value, sql)
      return {}
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }
  converting.value = true
  abort = new AbortController()
  convertProgress.value = { done: 0, total: items.length }
  conversions.value = []
  try {
    for (const item of items) {
      if (abort.signal.aborted) break
      const ddl = await fetchDdl(item)
      const r = await convertObjectValidated({ ...item, ddl }, srcDialect.value, tgtDialect.value, {
        run: selfRepair.value && canSelfRepair.value ? targetRun : undefined,
        maxAttempts: 3,
        signal: abort.signal,
      })
      conversions.value = [...conversions.value, r]
      convertProgress.value = { done: conversions.value.length, total: items.length }
    }
  } catch (e) {
    reportError(e, { tag: 'mig.convert' })
  } finally {
    converting.value = false
    abort = null
  }
}

function cancelConvert(): void {
  abort?.abort()
}

// ── Step 5:报告 + 导出 ────────────────────────────────────────
const reportMd = computed(() =>
  summary.value
    ? buildReport(summary.value, {
        conversions: conversions.value.length ? conversions.value : undefined,
        profile: profile.value ?? undefined,
      })
    : '',
)

const stamp = (): string => new Date().toISOString().slice(0, 10)
const docTitle = (): string => L('信创迁移评估报告', 'Migration Assessment Report')

async function copyReport(): Promise<void> {
  try {
    await navigator.clipboard.writeText(reportMd.value)
    toast.success(L('已复制到剪贴板', 'Copied to clipboard'))
  } catch (e) {
    reportError(e, { tag: 'mig.copyReport' })
  }
}

async function exportMarkdown(): Promise<void> {
  await saveFileWithDialog({
    defaultName: `migration-assess-${stamp()}.md`,
    content: reportMd.value,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
}

const exporting = ref(false)
async function exportExcel(): Promise<void> {
  if (!profile.value) return
  exporting.value = true
  try {
    const bytes = await buildExcel(profile.value, summary.value, conversions.value)
    await saveFileWithDialog({
      defaultName: `migration-assess-${stamp()}.xlsx`,
      content: bytes,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    })
  } catch (e) {
    reportError(e, { tag: 'mig.exportExcel' })
  } finally {
    exporting.value = false
  }
}

async function exportWord(): Promise<void> {
  const html = buildHtmlDoc(reportMd.value, { title: docTitle() })
  await saveFileWithDialog({
    defaultName: `migration-assess-${stamp()}.doc`,
    content: html,
    filters: [{ name: 'Word', extensions: ['doc'] }],
  })
}

function exportPdf(): void {
  const html = buildHtmlDoc(reportMd.value, { title: docTitle(), autoPrint: true })
  if (!openPrintWindow(html)) {
    toast.info(L('弹窗被拦截,请允许弹窗后重试', 'Popup blocked — allow popups and retry'))
  }
}

// ── 整库迁移脚本(确定性结构)+ 一键建库 ─────────────────────────
const canScript = computed(() => !!srcDialect.value && canIntrospect(srcDialect.value))
const scripting = ref(false)
const fullScript = ref('')

/** 读所选 schema 的完整结构 → convertSchema → 拼成整库迁移脚本。 */
async function generateScript(): Promise<void> {
  if (!srcDialect.value || !tgtDialect.value) return
  scripting.value = true
  try {
    const parts: string[] = []
    for (const schema of pickedSchemas.value) {
      const si = await readSchema(execRows, srcDialect.value, schema)
      if (!si.tables.length && !si.sequences?.length) continue
      // 跨 schema 改名:把读到的结构改写到目标 schema 名
      const tgt = targetSchemaOf(schema)
      if (tgt !== schema) {
        for (const t of si.tables) t.schema = tgt
        for (const s of si.sequences ?? []) s.schema = tgt
        for (const i of si.indexes ?? []) i.schema = tgt
        for (const f of si.foreignKeys ?? []) {
          f.schema = tgt
          if (f.refSchema === schema) f.refSchema = tgt
        }
      }
      const { sql } = convertSchema(si, srcDialect.value, tgtDialect.value)
      const label = tgt === schema ? schema : `${schema} → ${tgt}`
      if (sql.trim()) parts.push(`-- ════ schema: ${label} ════\n${sql}`)
    }
    fullScript.value = parts.join('\n\n')
    if (!fullScript.value) toast.info(L('没有可生成的结构', 'Nothing to generate'))
  } catch (e) {
    reportError(e, { tag: 'mig.generateScript' })
  } finally {
    scripting.value = false
  }
}

async function exportScript(): Promise<void> {
  await saveFileWithDialog({
    defaultName: `migration-schema-${stamp()}.sql`,
    content: fullScript.value,
    filters: [{ name: 'SQL', extensions: ['sql'] }],
  })
}

const applying = ref(false)
const applyOutcome = ref<ApplyResult | null>(null)

/** 一键建库:先 dry-run(PG 系事务内试跑),通过再确认提交。 */
async function applyToTarget(): Promise<void> {
  if (!tgtDialect.value || !fullScript.value) return
  const run: StmtRunner = async (sql) => {
    try {
      await client.connections.execute(tgtConnId.value, sql)
      return {}
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }
  applying.value = true
  applyOutcome.value = null
  try {
    // 1) dry-run(仅 PG 系支持;非事务库直接进确认)
    if (supportsTxnValidation(tgtDialect.value)) {
      const dry = await applyScript(run, fullScript.value, tgtDialect.value, { commit: false })
      if (!dry.ok) {
        applyOutcome.value = dry
        toast.info(L('试跑未通过,未建库', 'Dry-run failed — nothing applied'))
        return
      }
    }
    const proceed = await confirm({
      message: L(
        `将在目标库执行 ${fullScript.value.split(';').length - 1} 条语句建库。继续?`,
        'This will run the migration script on the target database. Continue?',
      ),
      confirmText: L('建库', 'Apply'),
    })
    if (!proceed) return
    applyOutcome.value = await applyScript(run, fullScript.value, tgtDialect.value, {
      commit: true,
    })
    if (applyOutcome.value.ok) toast.success(L('建库完成', 'Schema applied'))
    else toast.info(L('建库中断,请看结果', 'Apply stopped — see result'))
  } catch (e) {
    reportError(e, { tag: 'mig.applyToTarget' })
  } finally {
    applying.value = false
  }
}

// ── Step 6:数据迁移 ────────────────────────────────────────────
interface MigTable {
  schema: string
  name: string
  columns: string[]
  pk: string[]
  sel: boolean
  status: 'pending' | 'running' | 'done' | 'error'
  copied: number
  rowsOk?: boolean
  colsOk?: boolean
  detail?: string
}
const migTables = ref<MigTable[]>([])
const migPreparing = ref(false)
const migrating = ref(false)
const migBatchSize = ref(1000)
const migDeepCheck = ref(true)
let migAbort: AbortController | null = null
const canMigrate = computed(() => !!srcDialect.value && canIntrospect(srcDialect.value))

/** 源 schema → 目标 schema 改名映射(缺省同名)。 */
const schemaRemap = ref<Record<string, string>>({})
const targetSchemaOf = (s: string): string => schemaRemap.value[s]?.trim() || s

// 并发 / 增量 / 预检
const migConcurrency = ref(4)
const migIncremental = ref(false)
const incrementalUsable = computed(
  () => !!tgtDialect.value && supportsConflictSkip(tgtDialect.value),
)
const preflighting = ref(false)
const preflightIssues = ref<PreflightIssue[]>([])
const preflightDone = ref(false)
const preflightSummary = computed(() => summarize(preflightIssues.value))

/** 开搬前预检:目标表存在 / 列齐 / 主键 / 目标非空。 */
async function runPreflight(): Promise<void> {
  const tgt = tgtDialect.value
  if (!tgt || !migTables.value.length) return
  preflighting.value = true
  try {
    const tgtExec = (sql: string): Promise<Array<Record<string, unknown>>> =>
      client.connections.execute(tgtConnId.value, sql).then((r) => r.rows)
    const bySchema = new Map<string, MigTable[]>()
    for (const t of migTables.value.filter((x) => x.sel)) {
      const ts = targetSchemaOf(t.schema)
      if (!bySchema.has(ts)) bySchema.set(ts, [])
      bySchema.get(ts)?.push(t)
    }
    const issues: PreflightIssue[] = []
    for (const [ts, tables] of bySchema) {
      const si = canIntrospect(tgt)
        ? await readSchema(tgtExec, tgt, ts)
        : { tables: [] as { name: string; columns: { name: string }[] }[] }
      const tmap = new Map(
        si.tables.map((x) => [x.name.toLowerCase(), x.columns.map((c) => c.name)]),
      )
      for (const t of tables) {
        const cols = tmap.get(t.name.toLowerCase())
        let rowCount = 0
        if (cols) {
          try {
            rowCount = Number((await tgtExec(buildCount(tgt, ts, t.name)))[0]?.n ?? 0)
          } catch {
            /* 行数取不到不致命 */
          }
        }
        issues.push(
          ...checkTable(
            { schema: t.schema, name: t.name, columns: t.columns, pk: t.pk },
            { exists: !!cols, columns: cols ?? [], rowCount },
          ),
        )
      }
    }
    preflightIssues.value = issues
    preflightDone.value = true
    const s = summarize(issues)
    toast.info(
      s.ok
        ? L(`预检通过(${s.warns} 提醒)`, `Pre-flight ok (${s.warns} warnings)`)
        : L(`预检发现 ${s.errors} 个阻断问题`, `Pre-flight: ${s.errors} blocking issues`),
    )
  } catch (e) {
    reportError(e, { tag: 'mig.preflight' })
  } finally {
    preflighting.value = false
  }
}

/** 读所选 schema 的表 + 列 + 主键,作为搬运清单。 */
async function prepareMigration(): Promise<void> {
  if (!srcDialect.value) return
  preflightDone.value = false
  preflightIssues.value = []
  migPreparing.value = true
  try {
    const out: MigTable[] = []
    for (const schema of pickedSchemas.value) {
      const si = await readSchema(execRows, srcDialect.value, schema)
      for (const t of si.tables) {
        out.push({
          schema,
          name: t.name,
          columns: t.columns.map((c) => c.name),
          pk: t.primaryKey ?? [],
          sel: true,
          status: 'pending',
          copied: 0,
        })
      }
    }
    migTables.value = out
    if (!out.length) toast.info(L('没有可迁移的表', 'No tables to migrate'))
  } catch (e) {
    reportError(e, { tag: 'mig.prepare' })
  } finally {
    migPreparing.value = false
  }
}

const rows1 = (sql: string, connId: string): Promise<Array<Record<string, unknown>>> =>
  client.connections.execute(connId, sql).then((r) => r.rows)

/** 搬一张表 + 行/列对账。失败记到 t.detail,不抛(让并发池继续别的表)。 */
async function migrateOneTable(t: MigTable, src: DbDialect, tgt: DbDialect): Promise<void> {
  if (migAbort?.signal.aborted) return
  t.status = 'running'
  t.copied = 0
  t.detail = undefined
  const orderBy = t.pk.length ? t.pk : t.columns.slice(0, 1)
  const tSchema = targetSchemaOf(t.schema)
  const perStmt = maxRowsPerInsert(tgt, t.columns.length)
  // 增量:目标支持冲突跳过 + 有主键时,主键冲突 DO NOTHING(可重复跑、追平)
  const onConflict =
    migIncremental.value && supportsConflictSkip(tgt) && t.pk.length ? t.pk : undefined
  try {
    const res = await copyTable(
      (offset, limit) =>
        rows1(buildPagedSelect(src, t.schema, t.name, orderBy, offset, limit), srcConnId.value),
      async (batch) => {
        for (const sub of chunkRows(batch, perStmt)) {
          const { sql, params } = buildInsertParams(tgt, tSchema, t.name, t.columns, sub, {
            onConflict,
          })
          await client.connections.execute(tgtConnId.value, sql, params)
        }
      },
      {
        batchSize: migBatchSize.value,
        signal: migAbort?.signal,
        onProgress: (p) => {
          t.copied = p.copied
        },
      },
    )
    if (res.aborted) {
      t.status = 'pending'
      return
    }
    const sc = Number((await rows1(buildCount(src, t.schema, t.name), srcConnId.value))[0]?.n ?? 0)
    const tc = Number((await rows1(buildCount(tgt, tSchema, t.name), tgtConnId.value))[0]?.n ?? 0)
    // 增量模式目标行数可能 ≥ 源(已有数据),只在全量模式严格对账
    t.rowsOk = onConflict ? tc >= sc : reconcile(sc, tc).ok
    if (migDeepCheck.value && t.pk.length) {
      const ss = parseColumnStats(
        (await rows1(buildColumnStats(src, t.schema, t.name, t.pk), srcConnId.value))[0] ?? {},
        t.pk,
      )
      const ts = parseColumnStats(
        (await rows1(buildColumnStats(tgt, tSchema, t.name, t.pk), tgtConnId.value))[0] ?? {},
        t.pk,
      )
      const cmp = compareColumnStats(ss, ts)
      t.colsOk = cmp.ok
      if (!cmp.ok)
        t.detail = cmp.diffs
          .filter((d) => !d.ok)
          .map((d) => `${d.column}: ${d.detail}`)
          .join('; ')
    }
    t.status = 'done'
  } catch (e) {
    t.status = 'error'
    t.detail = e instanceof Error ? e.message : String(e)
  }
  persistJob() // 每表落一次盘 → 关窗口也能续
}

/** 并发搬运所选表(限并发);已 done 的跳过(断点续)。 */
async function runMigration(): Promise<void> {
  const src = srcDialect.value
  const tgt = tgtDialect.value
  if (!src || !tgt) return
  const todo = migTables.value.filter((t) => t.sel && t.status !== 'done')
  migAbort = new AbortController()
  migrating.value = true
  try {
    await runPool(todo, migConcurrency.value, (t) => migrateOneTable(t, src, tgt), migAbort.signal)
    if (migTables.value.some((t) => t.sel && t.status === 'done')) {
      toast.success(L('数据迁移完成', 'Data migration done'))
    }
  } catch (e) {
    reportError(e, { tag: 'mig.runMigration' })
  } finally {
    migrating.value = false
    migAbort = null
  }
}
function cancelMigration(): void {
  migAbort?.abort()
}
const migDone = computed(() => migTables.value.filter((t) => t.status === 'done').length)

// ── 任务持久化 + 历史(localStorage,跨会话断点续) ───────────────
let currentJobId = ''
const savedJobs = ref<JobSummary[]>([])
function refreshJobs(): void {
  savedJobs.value = listJobs()
}
/** 把当前迁移状态存盘(轻状态:不含列结构,恢复时重读)。 */
function persistJob(): void {
  if (!migTables.value.length) return
  if (!currentJobId) currentJobId = newJobId(Date.now(), Math.random())
  const now = Date.now()
  const job: MigJob = {
    id: currentJobId,
    createdAt: now,
    updatedAt: now,
    srcConnId: srcConnId.value,
    tgtConnId: tgtConnId.value,
    srcName: srcConn.value?.name ?? '',
    tgtName: tgtConn.value?.name ?? '',
    schemas: [...pickedSchemas.value],
    tables: migTables.value.map((t) => ({
      schema: t.schema,
      name: t.name,
      status: t.status,
      copied: t.copied,
      rowsOk: t.rowsOk,
      colsOk: t.colsOk,
    })),
  }
  saveJob(job)
  refreshJobs()
}
/** 恢复一个保存的任务:重读表清单,合并已存状态(done 的会被跳过)。 */
async function resumeJob(id: string): Promise<void> {
  const job = loadJob(id)
  if (!job) return
  currentJobId = id
  pickedSchemas.value = new Set(job.schemas)
  await prepareMigration()
  const byKey = new Map(job.tables.map((t) => [`${t.schema}.${t.name}`, t]))
  for (const t of migTables.value) {
    const saved = byKey.get(`${t.schema}.${t.name}`)
    if (saved) {
      t.status = saved.status === 'running' ? 'pending' : saved.status
      t.copied = saved.copied
      t.rowsOk = saved.rowsOk
      t.colsOk = saved.colsOk
    }
  }
  toast.info(
    L('已恢复任务,继续迁移会跳过已完成的表', 'Job restored — Resume skips finished tables'),
  )
}
function dropJob(id: string): void {
  deleteJob(id)
  if (currentJobId === id) currentJobId = ''
  refreshJobs()
}
const fmtTime = (t: number): string => new Date(t).toLocaleString()

// ── 导航 ────────────────────────────────────────────────────────
function next(): void {
  const i = stepIdx(step.value)
  if (i < STEPS.length - 1) step.value = STEPS[i + 1].id
}
function prev(): void {
  const i = stepIdx(step.value)
  if (i > 0) step.value = STEPS[i - 1].id
}
const canNext = computed(() => {
  switch (step.value) {
    case 'conn':
      return connReady.value
    case 'profile':
      return pickedSchemas.value.size > 0
    case 'assess':
      return !!summary.value
    default:
      return true
  }
})

function openWizard(opts?: { srcConnId?: string }): void {
  open.value = true
  step.value = 'conn'
  summary.value = null
  profile.value = null
  conversions.value = []
  migTables.value = []
  currentJobId = ''
  refreshJobs()
  loadConns().then(() => {
    if (opts?.srcConnId) srcConnId.value = opts.srcConnId
  })
}
defineExpose({ open: openWizard })
</script>

<template>
  <Modal v-if="open" :title="L('信创迁移评估', 'XinChuang Migration Assessment')" width="wide" @close="open = false">
    <div class="mig">
      <!-- 步骤指示 -->
      <ol class="steps">
        <li
          v-for="(s, i) in STEPS"
          :key="s.id"
          :class="{ active: s.id === step, done: stepIdx(step) > i }"
        >
          <span class="n">{{ i + 1 }}</span>{{ s.label() }}
        </li>
      </ol>

      <!-- Step 1: 连接 -->
      <section v-if="step === 'conn'" class="panel">
        <p class="hint">
          {{ L('选择源库(待迁出的 Oracle/DM)和目标国产库(openGauss 系 / DM)。',
                'Pick the source (Oracle/DM to migrate off) and the target domestic DB (openGauss-kernel / DM).') }}
        </p>
        <div class="row2">
          <label>
            <span>{{ L('源库', 'Source') }}</span>
            <select v-model="srcConnId">
              <option value="">{{ loadingConns ? '…' : L('选择源库', 'select source') }}</option>
              <option v-for="c in sourceConns" :key="c.id" :value="c.id">
                {{ c.name }} ({{ c.dialect }})
              </option>
            </select>
          </label>
          <label>
            <span>{{ L('目标库', 'Target') }}</span>
            <select v-model="tgtConnId">
              <option value="">{{ L('选择目标库', 'select target') }}</option>
              <option v-for="c in targetConns" :key="c.id" :value="c.id">
                {{ c.name }} ({{ c.dialect }})
              </option>
            </select>
          </label>
        </div>
        <p v-if="srcConnId && tgtConnId && !connReady" class="warn">
          {{ L('该源 → 目标组合暂无确定性结构转换通道。', 'No structural conversion path for this source → target pair.') }}
        </p>
      </section>

      <!-- Step 2: 画像 -->
      <section v-else-if="step === 'profile'" class="panel">
        <div class="bar">
          <button class="primary" :disabled="profiling" @click="runProfileList">
            {{ profiling ? L('画像中…', 'profiling…') : L('① 列举库 / schema', '① List DBs / schemas') }}
          </button>
          <label class="chk"><input type="checkbox" v-model="showSystem" />{{ L('显示系统对象', 'show system') }}</label>
          <button :disabled="profiling || !pickedSchemas.size" @click="runDeepProfile">
            {{ L('② 评估所选 schema', '② Profile selected') }}
          </button>
        </div>

        <div v-if="databases.length" class="dbgrid">
          <div class="card">
            <h4>{{ L('数据库', 'Databases') }} · {{ databases.length }}</h4>
            <ul class="mini">
              <li v-for="d in databases" :key="d.name">
                {{ d.name }}<span v-if="d.system" class="tag">sys</span>
                <span class="sz">{{ formatBytes(d.sizeBytes ?? 0) }}</span>
              </li>
            </ul>
          </div>
          <div class="card">
            <h4>{{ L('Schema', 'Schemas') }} · {{ visibleSchemas.length }}</h4>
            <ul class="mini scroll">
              <li v-for="s in visibleSchemas" :key="s.name">
                <label class="chk">
                  <input
                    type="checkbox"
                    :checked="pickedSchemas.has(s.name)"
                    @change="toggleSchema(s.name)"
                  />
                  {{ s.name }}<span v-if="s.system" class="tag">sys</span>
                </label>
              </li>
            </ul>
          </div>
        </div>

        <div v-if="profile && profile.schemaProfiles.length" class="prof">
          <h4>{{ L('源库画像', 'Source profile') }}</h4>
          <div class="totals">
            <span>{{ L('schema', 'schemas') }}: <b>{{ profile.totals.schemas }}</b></span>
            <span>{{ L('表', 'tables') }}: <b>{{ profile.totals.tables }}</b></span>
            <span>{{ L('对象', 'objects') }}: <b>{{ profile.totals.objects }}</b></span>
            <span>{{ L('总大小', 'size') }}: <b>{{ formatBytes(profile.totals.sizeBytes) }}</b></span>
            <span>{{ L('估算行数', 'rows') }}: <b>{{ profile.totals.metrics.totalRows.toLocaleString() }}</b></span>
          </div>
          <div class="buckets">
            <span class="bk">≥100万: <b>{{ profile.totals.rowBuckets.over1M }}</b></span>
            <span class="bk">≥1000万: <b>{{ profile.totals.rowBuckets.over10M }}</b></span>
            <span class="bk">≥1亿: <b>{{ profile.totals.rowBuckets.over100M }}</b></span>
            <span class="note">{{ L('行数为统计估算值', 'estimated rows') }}</span>
          </div>
          <div class="buckets risk">
            <span>{{ L('无主键表', 'no-PK tables') }}: <b>{{ metricCell(profile.totals.metrics.tablesWithoutPk) }}</b></span>
            <span>{{ L('LOB 列', 'LOB cols') }}: <b>{{ metricCell(profile.totals.metrics.lobColumns) }}</b></span>
            <span>{{ L('带触发器表', 'w/ triggers') }}: <b>{{ metricCell(profile.totals.metrics.tablesWithTriggers) }}</b></span>
            <span>{{ L('有注释表', 'w/ comments') }}: <b>{{ metricCell(profile.totals.metrics.tablesWithComment) }}</b></span>
          </div>

          <h4>{{ L('对象盘点', 'Object inventory') }} <small>{{ L('(— = 该库不支持)', '(— = unsupported)') }}</small></h4>
          <div class="invscroll">
            <table class="tbl">
              <thead><tr>
                <th>Schema</th>
                <th v-for="c in CATEGORIES" :key="c">{{ catLabel(c) }}</th>
              </tr></thead>
              <tbody>
                <tr v-for="sp in profile.schemaProfiles" :key="sp.schema">
                  <td>{{ sp.schema }}</td>
                  <td v-for="c in CATEGORIES" :key="c">{{ invCell(sp.inventory, c) }}</td>
                </tr>
                <tr class="totrow">
                  <td>{{ L('合计', 'Total') }}</td>
                  <td v-for="c in CATEGORIES" :key="c">{{ invCell(profile.totals.inventory, c) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Step 3: 评估 -->
      <section v-else-if="step === 'assess'" class="panel">
        <div class="bar">
          <button class="primary" :disabled="assessing" @click="runAssess">
            {{ assessing ? L('评估中…', 'assessing…') : L('开始评估', 'Run assessment') }}
          </button>
          <span class="prog">{{ assessProgress }}</span>
        </div>
        <div v-if="summary" class="assess">
          <div class="readiness" :class="{
            good: summary.readiness >= 70, mid: summary.readiness >= 40 && summary.readiness < 70,
            bad: summary.readiness < 40 }">
            {{ L('可迁移就绪度', 'Readiness') }}: <b>{{ summary.readiness }}</b>/100
          </div>
          <div class="grades">
            <span v-for="g in gradeOrder" :key="g" :class="['gr', 'g' + g]">
              {{ gradeText(g) }}: <b>{{ summary.byGrade[g] }}</b>
            </span>
            <span class="ai">{{ L('待 AI 转换', 'AI candidates') }}: <b>{{ summary.aiCandidates }}</b></span>
          </div>
          <table class="tbl scroll">
            <thead><tr>
              <th>{{ L('对象', 'object') }}</th><th>{{ L('类型', 'kind') }}</th>
              <th>{{ L('等级', 'grade') }}</th><th>{{ L('关注点', 'concerns') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="(it, i) in summary.items" :key="i">
                <td>{{ it.schema }}.{{ it.name }}</td>
                <td>{{ it.kind }}</td>
                <td :class="'g' + it.grade">{{ it.grade }}</td>
                <td class="concern">{{ it.notes.map((n) => n.msg).join('; ') || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Step 4: AI 转换 -->
      <section v-else-if="step === 'convert'" class="panel">
        <p class="hint">
          {{ L(`将 ${aiItems.length} 个 C 级对象(过程体/复杂 SQL)交 AI 翻成目标方言。结果只读,供人工复核。`,
                `Hand ${aiItems.length} grade-C objects (PL/SQL / complex SQL) to AI. Results are review-only.`) }}
        </p>
        <div class="bar">
          <button class="primary" :disabled="converting || !aiItems.length" @click="runConvert">
            {{ L('开始 AI 转换', 'Start AI conversion') }}
          </button>
          <button v-if="converting" @click="cancelConvert">{{ L('取消', 'Cancel') }}</button>
          <label class="chk" :title="canSelfRepair ? '' : L('目标库不支持事务内 DDL 校验', 'target lacks transactional DDL')">
            <input type="checkbox" v-model="selfRepair" :disabled="!canSelfRepair" />
            {{ L('目标库校验 + 自修复', 'Validate on target + self-repair') }}
          </label>
          <span v-if="convertProgress.total" class="prog">
            {{ convertProgress.done }} / {{ convertProgress.total }}
          </span>
        </div>
        <p class="hint" v-if="selfRepair && canSelfRepair">
          {{ L('每个对象转换后在目标库事务内试跑(BEGIN…ROLLBACK,不留痕),报错回喂 AI 自动重修,最多 3 次。',
                'Each result is dry-run on the target (BEGIN…ROLLBACK), and errors are fed back to AI to self-repair, up to 3 attempts.') }}
        </p>
        <div v-for="(c, i) in conversions" :key="i" class="conv">
          <h5>
            {{ c.schema }}.{{ c.name }} <small>({{ c.kind }})</small>
            <span v-if="c.validated === true" class="badge ok">✅ {{ L('目标库已验证', 'validated') }}<template v-if="(c.attempts ?? 1) > 1"> · {{ L('修复', 'fixed') }} ×{{ (c.attempts ?? 1) - 1 }}</template></span>
            <span v-else-if="c.validated === false" class="badge bad">❌ {{ L('校验未过', 'invalid') }}</span>
          </h5>
          <p v-if="c.error" class="warn">❌ {{ c.error }}</p>
          <template v-else>
            <p v-if="c.validated === false && c.validationError" class="warn">{{ c.validationError }}</p>
            <pre v-if="c.sql" class="sql">{{ c.sql }}</pre>
            <p v-if="c.notes" class="cnotes">{{ c.notes }}</p>
          </template>
        </div>
      </section>

      <!-- Step 5: 报告 -->
      <section v-else-if="step === 'report'" class="panel">
        <div class="bar">
          <button class="primary" @click="copyReport">{{ L('复制', 'Copy') }}</button>
          <button @click="exportMarkdown">Markdown</button>
          <button :disabled="exporting || !profile" @click="exportExcel">
            {{ exporting ? '…' : 'Excel' }}
          </button>
          <button @click="exportWord">Word</button>
          <button @click="exportPdf">PDF</button>
          <span class="note">{{ L('PDF 在新窗口用浏览器「另存为 PDF」', 'PDF via browser Save-as-PDF in new window') }}</span>
        </div>

        <!-- 完整迁移脚本 + 一键建库(确定性结构) -->
        <div class="scriptbox">
          <div v-if="pickedSchemas.size" class="remap">
            <span class="note">{{ L('目标 schema(默认同名,可改名迁移;建库 + 数据迁移都生效)', 'Target schema (default same name; rename applies to apply + data migration)') }}</span>
            <label v-for="s in [...pickedSchemas]" :key="s" class="remapItem">
              {{ s }} → <input v-model="schemaRemap[s]" :placeholder="s" style="width: 120px" />
            </label>
          </div>
          <div class="bar">
            <button class="primary" :disabled="scripting || !canScript" @click="generateScript">
              {{ scripting ? '…' : L('生成完整迁移脚本', 'Generate migration script') }}
            </button>
            <button :disabled="!fullScript" @click="exportScript">{{ L('导出 .sql', 'Export .sql') }}</button>
            <button class="danger" :disabled="applying || !fullScript" @click="applyToTarget">
              {{ applying ? L('建库中…', 'applying…') : L('一键建库到目标', 'Apply to target') }}
            </button>
            <span v-if="!canScript" class="note">{{ L('该源方言暂不支持结构读取', 'introspection not supported for this source dialect') }}</span>
          </div>
          <p v-if="applyOutcome" :class="['apply-res', applyOutcome.ok ? 'ok' : 'bad']">
            <template v-if="applyOutcome.ok">✅ {{ applyOutcome.committed ? L('建库完成', 'applied') : L('试跑通过', 'dry-run ok') }} · {{ applyOutcome.succeeded }}/{{ applyOutcome.total }}</template>
            <template v-else>❌ {{ L('第', '#') }}{{ applyOutcome.succeeded + 1 }} {{ L('句失败', 'failed') }}:{{ applyOutcome.error }}<br /><code>{{ applyOutcome.failedStatement }}</code></template>
          </p>
          <pre v-if="fullScript" class="sql">{{ fullScript }}</pre>
        </div>

        <pre class="report">{{ reportMd }}</pre>
      </section>

      <!-- Step 6: 数据迁移 -->
      <section v-else class="panel">
        <p class="hint">
          {{ L('结构建好后,把源库行数据分块搬到目标库(目标表需已存在)。逐表行数对账,主键列做列级对账。',
                'After the schema exists, copy row data in chunks to the target (target tables must exist). Row-count reconcile per table; PK columns are checked column-level.') }}
        </p>
        <!-- 已保存任务(跨会话断点续) -->
        <div v-if="savedJobs.length" class="jobs">
          <h4>{{ L('已保存任务', 'Saved jobs') }}</h4>
          <div v-for="j in savedJobs" :key="j.id" class="jobrow">
            <span>{{ j.srcName }} → {{ j.tgtName }}</span>
            <span class="note">{{ j.done }}/{{ j.total }} {{ L('表', 'tables') }} · {{ j.copied.toLocaleString() }} {{ L('行', 'rows') }} · {{ fmtTime(j.updatedAt) }}</span>
            <button :disabled="migrating || !canMigrate" @click="resumeJob(j.id)">{{ L('恢复', 'Restore') }}</button>
            <button @click="dropJob(j.id)">{{ L('删除', 'Delete') }}</button>
          </div>
        </div>
        <div class="bar">
          <button class="primary" :disabled="migPreparing || !canMigrate" @click="prepareMigration">
            {{ migPreparing ? '…' : L('准备表清单', 'Prepare tables') }}
          </button>
          <button v-if="migTables.length && !migrating" :disabled="preflighting" @click="runPreflight">
            {{ preflighting ? '…' : L('预检', 'Pre-flight') }}
          </button>
          <button
            v-if="migTables.length && !migrating"
            class="danger"
            :disabled="preflightDone && !preflightSummary.ok"
            @click="runMigration"
          >
            {{ migDone ? L('继续迁移', 'Resume') : L('开始数据迁移', 'Start migration') }}
          </button>
          <button v-if="migrating" @click="cancelMigration">{{ L('取消', 'Cancel') }}</button>
          <label class="chk">{{ L('每批', 'batch') }}
            <input type="number" v-model.number="migBatchSize" min="100" step="100" style="width: 72px" />
          </label>
          <label class="chk">{{ L('并发', 'parallel') }}
            <input type="number" v-model.number="migConcurrency" min="1" max="16" style="width: 56px" />
          </label>
          <label class="chk"><input type="checkbox" v-model="migDeepCheck" />{{ L('主键列对账', 'PK column check') }}</label>
          <label class="chk" :title="incrementalUsable ? '' : L('目标库不支持冲突跳过', 'target lacks conflict-skip')">
            <input type="checkbox" v-model="migIncremental" :disabled="!incrementalUsable" />{{ L('增量(冲突跳过,可重复跑)', 'Incremental (skip conflicts)') }}
          </label>
          <span v-if="migTables.length" class="note">{{ migDone }}/{{ migTables.length }} {{ L('表完成', 'done') }}</span>
          <span v-if="!canMigrate" class="note">{{ L('该源方言暂不支持结构读取', 'introspection not supported for this source') }}</span>
        </div>
        <div v-if="preflightDone" :class="['apply-res', preflightSummary.ok ? 'ok' : 'bad']">
          <template v-if="!preflightIssues.length">✅ {{ L('预检全部通过', 'Pre-flight all clear') }}</template>
          <template v-else>
            {{ preflightSummary.ok ? '⚠️' : '❌' }} {{ preflightSummary.errors }} {{ L('阻断', 'errors') }} · {{ preflightSummary.warns }} {{ L('提醒', 'warnings') }}
            <div v-for="(iss, i) in preflightIssues.slice(0, 20)" :key="i" class="mdetail">
              {{ iss.level === 'error' ? '❌' : '⚠️' }} {{ iss.table }}:{{ iss.msg }}
            </div>
          </template>
        </div>
        <table v-if="migTables.length" class="tbl scroll">
          <thead><tr>
            <th><input type="checkbox" :checked="migTables.every((t) => t.sel)" @change="(e) => migTables.forEach((t) => { t.sel = (e.target as HTMLInputElement).checked })" /></th>
            <th>{{ L('表', 'Table') }}</th><th>{{ L('已搬', 'Copied') }}</th>
            <th>{{ L('行对账', 'Rows') }}</th><th>{{ L('列对账', 'Cols') }}</th><th>{{ L('状态', 'Status') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="(t, i) in migTables" :key="i">
              <td><input type="checkbox" v-model="t.sel" :disabled="migrating" /></td>
              <td>{{ t.schema }}.{{ t.name }}</td>
              <td>{{ t.copied.toLocaleString() }}</td>
              <td>{{ t.rowsOk === undefined ? '—' : t.rowsOk ? '✅' : '❌' }}</td>
              <td>{{ t.colsOk === undefined ? '—' : t.colsOk ? '✅' : '❌' }}</td>
              <td>
                <span :class="['mstat', t.status]">{{ t.status }}</span>
                <span v-if="t.detail" class="mdetail">{{ t.detail }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <template #footer>
      <button v-if="stepIdx(step) > 0" @click="prev">{{ L('上一步', 'Back') }}</button>
      <span class="sp" />
      <button v-if="stepIdx(step) < STEPS.length - 1" class="primary" :disabled="!canNext" @click="next">
        {{ L('下一步', 'Next') }}
      </button>
      <button v-else @click="open = false">{{ L('完成', 'Done') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.mig { display: flex; flex-direction: column; gap: 12px; min-width: 720px; }
.steps { display: flex; gap: 6px; list-style: none; padding: 0; margin: 0; font-size: 12px; }
.steps li { display: flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 14px; background: var(--bg-subtle, #f1f1f1); color: var(--fg-muted, #888); }
.steps li.active { background: var(--accent, #2d7ff9); color: #fff; }
.steps li.done { color: var(--accent, #2d7ff9); }
.steps .n { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; background: rgba(0,0,0,.12); font-size: 10px; }
.panel { min-height: 320px; }
.hint { font-size: 13px; color: var(--fg-muted, #777); margin: 0 0 10px; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.row2 label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
select { padding: 6px; }
.bar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.chk { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; }
.prog { font-size: 12px; color: var(--fg-muted, #888); }
.warn { color: #c0392b; font-size: 12px; }
.dbgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.card { border: 1px solid var(--border, #e3e3e3); border-radius: 8px; padding: 10px; }
.card h4 { margin: 0 0 8px; font-size: 13px; }
.mini { list-style: none; margin: 0; padding: 0; font-size: 12px; }
.mini li { padding: 2px 0; display: flex; align-items: center; gap: 6px; }
.mini.scroll { max-height: 200px; overflow: auto; }
.tag { font-size: 10px; background: #eee; color: #999; border-radius: 3px; padding: 0 4px; }
.sz { margin-left: auto; color: var(--fg-muted, #999); }
.prof { margin-top: 14px; }
.totals, .buckets { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; margin: 6px 0; }
.buckets .note { color: var(--fg-muted, #aaa); font-size: 11px; }
.bk b { color: #d35400; }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
.tbl th, .tbl td { border: 1px solid var(--border, #e8e8e8); padding: 4px 8px; text-align: left; }
.tbl.scroll { display: block; max-height: 260px; overflow: auto; }
.buckets.risk b { color: #c0392b; }
.invscroll { overflow-x: auto; max-width: 100%; }
.invscroll .tbl { font-size: 11px; white-space: nowrap; }
.invscroll .totrow { font-weight: 700; background: var(--bg-subtle, #f7f7f7); }
.readiness { font-size: 16px; padding: 8px 12px; border-radius: 8px; display: inline-block; }
.readiness.good { background: #e8f6ec; color: #1e7e34; }
.readiness.mid { background: #fff5e6; color: #c87f0a; }
.readiness.bad { background: #fdecea; color: #c0392b; }
.grades { display: flex; gap: 12px; flex-wrap: wrap; margin: 10px 0; font-size: 13px; }
.gr { padding: 2px 8px; border-radius: 6px; background: #f3f3f3; }
.gA { color: #1e7e34; } .gB { color: #2d7ff9; } .gC { color: #c87f0a; } .gD { color: #c0392b; }
td.gA, td.gB, td.gC, td.gD { font-weight: 700; }
.ai { margin-left: auto; }
.concern { color: var(--fg-muted, #888); max-width: 360px; }
.badge { font-size: 11px; padding: 1px 6px; border-radius: 4px; margin-left: 8px; font-weight: 400; }
.badge.ok { background: #e8f6ec; color: #1e7e34; }
.badge.bad { background: #fdecea; color: #c0392b; }
.conv { border-top: 1px solid var(--border, #eee); padding: 8px 0; }
.conv h5 { margin: 0 0 6px; font-size: 13px; }
.sql, .report { background: var(--bg-code, #1e1e1e); color: #dcdcdc; padding: 10px; border-radius: 6px; font-size: 12px; overflow: auto; max-height: 360px; white-space: pre-wrap; }
.cnotes { font-size: 12px; color: var(--fg-muted, #777); white-space: pre-wrap; }
.sp { flex: 1; }
.primary { background: var(--accent, #2d7ff9); color: #fff; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
.primary:disabled { opacity: .5; cursor: default; }
.danger { background: #c0392b; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
.danger:disabled { opacity: .5; cursor: default; }
.scriptbox { border-top: 1px dashed var(--border, #ddd); margin-top: 14px; padding-top: 12px; }
.apply-res { font-size: 12px; padding: 6px 10px; border-radius: 6px; }
.apply-res.ok { background: #e8f6ec; color: #1e7e34; }
.apply-res.bad { background: #fdecea; color: #c0392b; }
.apply-res code { display: block; margin-top: 4px; font-size: 11px; }
.mstat { font-size: 11px; padding: 1px 6px; border-radius: 4px; }
.mstat.pending { background: #eee; color: #888; }
.mstat.running { background: #fff5e6; color: #c87f0a; }
.mstat.done { background: #e8f6ec; color: #1e7e34; }
.mstat.error { background: #fdecea; color: #c0392b; }
.mdetail { display: block; font-size: 10px; color: #c0392b; max-width: 320px; }
.jobs { border: 1px solid var(--border, #e3e3e3); border-radius: 8px; padding: 8px 10px; margin-bottom: 12px; }
.jobs h4 { margin: 0 0 6px; font-size: 12px; }
.jobrow { display: flex; align-items: center; gap: 10px; font-size: 12px; padding: 3px 0; }
.jobrow .note { margin-right: auto; }
.remap { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 10px; }
.remapItem { font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
</style>
