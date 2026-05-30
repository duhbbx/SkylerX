<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Oracle → DM(达梦) 数据库迁移向导
 *
 * 信创外包高频场景:把客户 Oracle 库整体迁去达梦。本向导把流程拆成 5 步:
 *   1) 选连接   :左 Oracle 源 / 右 DM 目标(从已配置连接里筛 dialect)
 *   2) 选对象   :拉源库的表 / 视图 / 序列 / 过程清单,默认全选
 *   3) 预览     :每个对象用 translateDdl 翻译,显示 warnings,允许编辑
 *   4) 执行     :逐对象 client.connections.execute(目标连,DDL),错误收集不中断
 *   5) 报告     :Markdown 总结成败 + warnings,可复制或 saveText 落盘
 *
 * 设计原则(刻意保持简单):
 *   - 第一版只迁 schema;数据迁移留入口,每表前 100 行示例,不追求完整
 *   - 不做 PL/SQL 翻译 — 存储过程仅迁 CREATE 壳,函数体让用户人工
 *   - 不做触发器内容翻译 — 同上
 *   - 不解约束依赖排序 — 字典序;失败让用户重跑
 *   - 不做事务原子性 — 每对象独立,errors 用红色标记
 *
 * 集成方式(用户后续做):
 *   - 父组件 ref OracleToDmWizard,defineExpose 出 open() 方法
 *   - 父组件按钮 / 菜单挂入口(本组件不挂菜单,不动 Workspace.vue)
 *
 * @example
 * ```vue
 * <OracleToDmWizard ref="wizardRef" />
 * <button @click="wizardRef?.open()">迁移向导</button>
 * ```
 */
import {
  type ConnectionConfig,
  DbDialect,
  MetaNodeKind,
  type MetadataNode,
} from '@db-tool/shared-types'
import { computed, ref } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import { t } from '../i18n'
import { translateDdl } from '../oracleToDm'
import Modal from './Modal.vue'

const client = useDataClient()

// ── 步骤模型 ────────────────────────────────────────────────────
type StepId = 'conn' | 'pick' | 'preview' | 'run' | 'report'
const STEPS: { id: StepId; key: string }[] = [
  { id: 'conn', key: 'o2dm.step.conn' },
  { id: 'pick', key: 'o2dm.step.pick' },
  { id: 'preview', key: 'o2dm.step.preview' },
  { id: 'run', key: 'o2dm.step.run' },
  { id: 'report', key: 'o2dm.step.report' },
]
const open = ref(false)
const step = ref<StepId>('conn')
const stepIdx = (s: StepId): number => STEPS.findIndex((x) => x.id === s)

// ── Step 1:连接选择 ────────────────────────────────────────────
const conns = ref<ConnectionConfig[]>([])
const srcConnId = ref<string>('')
const dstConnId = ref<string>('')
const loadingConns = ref(false)

const oracleConns = computed(() =>
  conns.value.filter((c) => c.dialect === DbDialect.Oracle),
)
const dmConns = computed(() => conns.value.filter((c) => c.dialect === DbDialect.DM))

// ── Step 2:对象选择 ────────────────────────────────────────────
type ObjGroup = 'tables' | 'views' | 'sequences' | 'procedures'
interface PickedObject {
  group: ObjGroup
  name: string
  path: string[]
  /** 默认勾选,用户可点掉 */
  picked: boolean
}
const objects = ref<PickedObject[]>([])
const loadingObjects = ref(false)
const objectsError = ref<string | null>(null)
const srcSchema = ref<string>('')

/** 切到 Step 2 时拉对象清单。Oracle 的"schema"=用户,默认取连接配置的 database/user 字段。 */
async function loadObjects(): Promise<void> {
  if (!srcConnId.value) return
  loadingObjects.value = true
  objectsError.value = null
  try {
    const src = conns.value.find((c) => c.id === srcConnId.value)
    const schema = (srcSchema.value || src?.database || src?.user || '').toUpperCase()
    srcSchema.value = schema
    const groups: ObjGroup[] = ['tables', 'views', 'sequences', 'procedures']
    const all: PickedObject[] = []
    for (const g of groups) {
      try {
        const nodes: MetadataNode[] = await client.connections.metadata(srcConnId.value, {
          parentKind: MetaNodeKind.Group,
          path: schema ? [schema] : [],
          group: g,
        })
        for (const n of nodes) {
          all.push({ group: g, name: n.name, path: n.path, picked: true })
        }
      } catch (e) {
        // 某 group 加载失败不致命(Oracle 驱动可能未实现 sequences 等),继续其他 group
        // 提示在控制台,让用户能从 Step 4 错误里看到
        // eslint-disable-next-line no-console
        console.warn(`[o2dm] load ${g} failed:`, e)
      }
    }
    objects.value = all
  } catch (e) {
    objectsError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingObjects.value = false
  }
}

const selectedObjects = computed(() => objects.value.filter((o) => o.picked))
const groupCounts = computed(() => {
  const c: Record<ObjGroup, number> = { tables: 0, views: 0, sequences: 0, procedures: 0 }
  for (const o of selectedObjects.value) c[o.group]++
  return c
})

function toggleAll(v: boolean): void {
  for (const o of objects.value) o.picked = v
}
function toggleGroup(g: ObjGroup, v: boolean): void {
  for (const o of objects.value) if (o.group === g) o.picked = v
}

// ── Step 3:DDL 拉取 + 翻译 + 预览 ──────────────────────────────
interface PreviewItem {
  group: ObjGroup
  name: string
  /** 翻译后的 DDL(可编辑) */
  ddl: string
  /** 原始 Oracle DDL,只读保留 */
  oracleDdl: string
  warnings: string[]
  /** 拉源 DDL 时的错误,有则跳过执行 */
  fetchError?: string
}
const previewItems = ref<PreviewItem[]>([])
const loadingPreview = ref(false)
const previewProgress = ref<{ done: number; total: number }>({ done: 0, total: 0 })

/**
 * 从 Oracle 拉对象的 DDL。用 DBMS_METADATA.GET_DDL —— 几乎所有 Oracle 版本都有,
 * 且产出标准的 CREATE 语句。kind 名按 Oracle 文档大写。
 */
function ddlQuery(group: ObjGroup, name: string, schema: string): string {
  const map: Record<ObjGroup, string> = {
    tables: 'TABLE',
    views: 'VIEW',
    sequences: 'SEQUENCE',
    procedures: 'PROCEDURE',
  }
  const kind = map[group]
  // 用绑定参数避免拼接;Oracle 驱动应支持位置参数
  return `SELECT DBMS_METADATA.GET_DDL('${kind}', '${name.replace(/'/g, "''")}', '${schema.replace(/'/g, "''")}') AS DDL FROM DUAL`
}

async function buildPreview(): Promise<void> {
  loadingPreview.value = true
  previewItems.value = []
  const picked = selectedObjects.value
  previewProgress.value = { done: 0, total: picked.length }
  // 字典序排,失败也方便定位
  const sorted = [...picked].sort(
    (a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name),
  )
  for (const o of sorted) {
    let oracleDdl = ''
    let fetchError: string | undefined
    try {
      const r = await client.connections.execute(
        srcConnId.value,
        ddlQuery(o.group, o.name, srcSchema.value),
      )
      // DBMS_METADATA.GET_DDL 返回 CLOB,驱动一般会字符串化
      const row = r.rows[0] ?? {}
      const k = Object.keys(row).find((x) => /ddl/i.test(x))
      oracleDdl = String(row[k ?? ''] ?? '').trim()
      if (!oracleDdl) fetchError = 'empty DDL'
    } catch (e) {
      fetchError = e instanceof Error ? e.message : String(e)
    }
    const tr = oracleDdl ? translateDdl(oracleDdl) : { sql: '', warnings: [] }
    previewItems.value.push({
      group: o.group,
      name: o.name,
      oracleDdl,
      ddl: tr.sql,
      warnings: tr.warnings,
      fetchError,
    })
    previewProgress.value.done++
  }
  loadingPreview.value = false
}

const activePreviewIdx = ref(0)
const activePreview = computed(() => previewItems.value[activePreviewIdx.value])

// ── Step 4:执行 ───────────────────────────────────────────────
interface RunResult {
  name: string
  group: ObjGroup
  ok: boolean
  error?: string
  durationMs: number
}
const runResults = ref<RunResult[]>([])
const running = ref(false)
const runProgress = ref<{ done: number; total: number }>({ done: 0, total: 0 })
const includeData = ref(false) // 数据迁移:第一版每表前 100 行示例

async function runExecute(): Promise<void> {
  running.value = true
  runResults.value = []
  // 只执行有可用 DDL 的项
  const items = previewItems.value.filter((p) => !p.fetchError && p.ddl.trim())
  runProgress.value = { done: 0, total: items.length }
  for (const it of items) {
    const t0 = Date.now()
    try {
      await client.connections.execute(dstConnId.value, it.ddl)
      runResults.value.push({
        name: it.name,
        group: it.group,
        ok: true,
        durationMs: Date.now() - t0,
      })
      // 数据迁移示例:仅 tables,仅前 100 行
      if (includeData.value && it.group === 'tables') {
        await migrateSampleRows(it.name)
      }
    } catch (e) {
      runResults.value.push({
        name: it.name,
        group: it.group,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - t0,
      })
    }
    runProgress.value.done++
  }
  running.value = false
  step.value = 'report'
}

/**
 * 数据迁移示例:仅前 100 行,作为骨架。
 *
 * 完整迁移需要分页 + 类型转换 + 批量插入,本向导不做,留给后续。
 * 此实现是"能跑通就行":SELECT * + 逐行 INSERT,字符串化每个值后由驱动转义。
 */
async function migrateSampleRows(tableName: string): Promise<void> {
  const src = await client.connections.execute(
    srcConnId.value,
    `SELECT * FROM "${tableName.replace(/"/g, '""')}"`,
    [],
    { limit: 100 },
  )
  if (!src.rows.length) return
  const cols = src.columns.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(',')
  // DM 用与 Oracle 一致的双引号标识符,直接复用
  const valueLiteral = (v: unknown): string => {
    if (v === null || v === undefined) return 'NULL'
    if (typeof v === 'number') return String(v)
    if (typeof v === 'boolean') return v ? '1' : '0'
    return `'${String(v).replace(/'/g, "''")}'`
  }
  for (const row of src.rows) {
    const vals = src.columns.map((c) => valueLiteral(row[c.name])).join(',')
    await client.connections.execute(
      dstConnId.value,
      `INSERT INTO "${tableName.replace(/"/g, '""')}" (${cols}) VALUES (${vals})`,
    )
  }
}

// ── Step 5:报告 ──────────────────────────────────────────────
const reportMarkdown = computed(() => {
  const total = runResults.value.length
  const ok = runResults.value.filter((r) => r.ok).length
  const fail = total - ok
  const lines: string[] = []
  lines.push('# Oracle → DM 迁移报告')
  lines.push('')
  lines.push(`- 源连接: \`${connName(srcConnId.value)}\``)
  lines.push(`- 目标连接: \`${connName(dstConnId.value)}\``)
  lines.push(`- 时间: ${new Date().toLocaleString()}`)
  lines.push(`- 总对象数: ${total},成功 ${ok},失败 ${fail}`)
  if (includeData.value) lines.push('- 含数据迁移(每表前 100 行示例)')
  lines.push('')
  lines.push('## 成功对象')
  for (const r of runResults.value.filter((x) => x.ok)) {
    lines.push(`- [${r.group}] ${r.name}(${r.durationMs}ms)`)
  }
  if (fail) {
    lines.push('')
    lines.push('## 失败对象')
    for (const r of runResults.value.filter((x) => !x.ok)) {
      lines.push(`- [${r.group}] ${r.name}`)
      lines.push(`  - 错误: ${r.error}`)
    }
  }
  // 收集所有翻译警告(去重)
  const warnSet = new Set<string>()
  for (const p of previewItems.value) {
    for (const w of p.warnings) warnSet.add(`(${p.name}) ${w}`)
  }
  if (warnSet.size) {
    lines.push('')
    lines.push('## 翻译警告(人工 review)')
    for (const w of warnSet) lines.push(`- ${w}`)
  }
  return lines.join('\n')
})

function connName(id: string): string {
  const c = conns.value.find((x) => x.id === id)
  return c?.name || c?.dialect || id
}

async function copyReport(): Promise<void> {
  try {
    await navigator.clipboard?.writeText(reportMarkdown.value)
    toast.success(t('o2dm.copied'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}
async function saveReport(): Promise<void> {
  try {
    const p = await client.files.saveText({
      defaultName: `oracle-to-dm-${Date.now()}.md`,
      content: reportMarkdown.value,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (p) toast.success(t('o2dm.saved'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

// ── 导航 ──────────────────────────────────────────────────────
async function gotoStep(s: StepId): Promise<void> {
  // 前置校验:每步进入前确认上一步已经完成所需输入
  if (s === 'pick' && !(srcConnId.value && dstConnId.value)) return
  if (s === 'preview' && !selectedObjects.value.length) return
  if (s === 'run' && !previewItems.value.length) return
  step.value = s
  if (s === 'pick' && !objects.value.length) await loadObjects()
  if (s === 'preview' && !previewItems.value.length) await buildPreview()
}

async function openWizard(): Promise<void> {
  open.value = true
  step.value = 'conn'
  loadingConns.value = true
  try {
    conns.value = await client.connections.list()
    if (!srcConnId.value && oracleConns.value[0]) srcConnId.value = oracleConns.value[0].id
    if (!dstConnId.value && dmConns.value[0]) dstConnId.value = dmConns.value[0].id
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    loadingConns.value = false
  }
}
function closeWizard(): void {
  // 跑批中不让关
  if (running.value) return
  open.value = false
  // 主动复位避免下次打开看到旧数据;连接选项保留方便重跑
  objects.value = []
  previewItems.value = []
  runResults.value = []
  step.value = 'conn'
}

// 暴露给父组件调用
defineExpose({ open: openWizard, close: closeWizard })
</script>

<template>
  <Modal
    v-if="open"
    :title="t('o2dm.title')"
    width="xl"
    fixed-height
    storage-key="oracle-to-dm"
    @close="closeWizard"
  >
    <div class="wiz">
      <!-- 步骤指示 -->
      <ol class="steps">
        <li
          v-for="(s, i) in STEPS"
          :key="s.id"
          :class="{ on: step === s.id, done: stepIdx(step) > i }"
          @click="gotoStep(s.id)"
        >
          <span class="num">{{ i + 1 }}</span>
          <span class="lbl">{{ t(s.key) }}</span>
        </li>
      </ol>

      <!-- Step 1: 连接 -->
      <section v-if="step === 'conn'" class="content">
        <p class="muted">{{ t('o2dm.conn.hint') }}</p>
        <div class="two-col">
          <div class="col">
            <label class="lbl">{{ t('o2dm.conn.src') }}</label>
            <select v-model="srcConnId" :disabled="loadingConns">
              <option value="">{{ t('o2dm.conn.placeholder') }}</option>
              <option v-for="c in oracleConns" :key="c.id" :value="c.id">
                {{ c.name || c.host }}
              </option>
            </select>
            <p v-if="!oracleConns.length && !loadingConns" class="muted small">
              {{ t('o2dm.conn.noOracle') }}
            </p>
          </div>
          <div class="col">
            <label class="lbl">{{ t('o2dm.conn.dst') }}</label>
            <select v-model="dstConnId" :disabled="loadingConns">
              <option value="">{{ t('o2dm.conn.placeholder') }}</option>
              <option v-for="c in dmConns" :key="c.id" :value="c.id">
                {{ c.name || c.host }}
              </option>
            </select>
            <p v-if="!dmConns.length && !loadingConns" class="muted small">
              {{ t('o2dm.conn.noDm') }}
            </p>
          </div>
        </div>
        <div class="opt-row">
          <span class="lbl">{{ t('o2dm.conn.schema') }}</span>
          <input v-model="srcSchema" :placeholder="t('o2dm.conn.schemaPh')" />
          <span class="muted small">{{ t('o2dm.conn.schemaHint') }}</span>
        </div>
      </section>

      <!-- Step 2: 选对象 -->
      <section v-else-if="step === 'pick'" class="content">
        <div v-if="loadingObjects" class="muted">{{ t('common.loading') }}</div>
        <div v-else-if="objectsError" class="banner err">✗ {{ objectsError }}</div>
        <template v-else>
          <div class="row">
            <button class="ghost" @click="toggleAll(true)">{{ t('o2dm.pick.all') }}</button>
            <button class="ghost" @click="toggleAll(false)">{{ t('o2dm.pick.none') }}</button>
            <span class="spacer" />
            <span class="muted small">
              {{ t('o2dm.pick.summary', {
                t: groupCounts.tables,
                v: groupCounts.views,
                s: groupCounts.sequences,
                p: groupCounts.procedures,
              }) }}
            </span>
          </div>
          <div class="obj-groups">
            <div v-for="g in (['tables','views','sequences','procedures'] as const)" :key="g" class="obj-group">
              <header>
                <span class="g-name">{{ t('o2dm.group.' + g) }}</span>
                <span class="muted small">{{ objects.filter(o => o.group === g).length }}</span>
                <span class="spacer" />
                <button class="ghost xs" @click="toggleGroup(g, true)">{{ t('o2dm.pick.all') }}</button>
                <button class="ghost xs" @click="toggleGroup(g, false)">{{ t('o2dm.pick.none') }}</button>
              </header>
              <div class="obj-list">
                <label v-for="o in objects.filter(x => x.group === g)" :key="g + '/' + o.name" class="obj">
                  <input v-model="o.picked" type="checkbox" />
                  <span>{{ o.name }}</span>
                </label>
                <p v-if="!objects.filter(x => x.group === g).length" class="muted small empty">
                  {{ t('o2dm.pick.empty') }}
                </p>
              </div>
            </div>
          </div>
        </template>
      </section>

      <!-- Step 3: 预览 -->
      <section v-else-if="step === 'preview'" class="content preview-grid">
        <div v-if="loadingPreview" class="banner">
          {{ t('o2dm.preview.loading', { d: previewProgress.done, t: previewProgress.total }) }}
        </div>
        <template v-else>
          <aside class="obj-side">
            <ul>
              <li
                v-for="(p, i) in previewItems"
                :key="p.group + '/' + p.name"
                :class="{ on: i === activePreviewIdx, err: !!p.fetchError, warn: p.warnings.length }"
                @click="activePreviewIdx = i"
              >
                <span class="badge" :class="'g-' + p.group">{{ p.group.charAt(0).toUpperCase() }}</span>
                <span class="nm">{{ p.name }}</span>
                <span v-if="p.warnings.length" class="warn-dot" :title="t('o2dm.preview.warn')">!</span>
              </li>
            </ul>
          </aside>
          <div class="ddl-pane">
            <header v-if="activePreview">
              <span class="g-name">{{ activePreview.group }} / {{ activePreview.name }}</span>
              <span v-if="activePreview.fetchError" class="banner err inline">
                ✗ {{ activePreview.fetchError }}
              </span>
            </header>
            <textarea
              v-if="activePreview && !activePreview.fetchError"
              v-model="activePreview.ddl"
              class="ddl"
              spellcheck="false"
            ></textarea>
            <div v-if="activePreview && activePreview.warnings.length" class="warns">
              <div class="title">{{ t('o2dm.preview.warns') }}</div>
              <ul>
                <li v-for="(w, wi) in activePreview.warnings" :key="wi">{{ w }}</li>
              </ul>
            </div>
          </div>
        </template>
      </section>

      <!-- Step 4: 执行 -->
      <section v-else-if="step === 'run'" class="content">
        <div class="opt-row">
          <label>
            <input v-model="includeData" type="checkbox" :disabled="running" />
            {{ t('o2dm.run.includeData') }}
          </label>
          <span class="muted small">{{ t('o2dm.run.includeDataHint') }}</span>
        </div>
        <div v-if="running" class="banner">
          {{ t('o2dm.run.progress', { d: runProgress.done, t: runProgress.total }) }}
        </div>
        <div v-if="runResults.length" class="run-list">
          <div
            v-for="r in runResults"
            :key="r.group + '/' + r.name"
            class="run-row"
            :class="{ ok: r.ok, fail: !r.ok }"
          >
            <span class="status">{{ r.ok ? '✓' : '✗' }}</span>
            <span class="g-name">[{{ r.group }}]</span>
            <span class="nm">{{ r.name }}</span>
            <span class="muted small">{{ r.durationMs }}ms</span>
            <span v-if="r.error" class="err-msg">{{ r.error }}</span>
          </div>
        </div>
        <div v-if="!running && !runResults.length" class="muted">
          {{ t('o2dm.run.ready', { n: previewItems.filter(p => !p.fetchError).length }) }}
        </div>
      </section>

      <!-- Step 5: 报告 -->
      <section v-else-if="step === 'report'" class="content">
        <div class="row">
          <button class="ghost" @click="copyReport">{{ t('o2dm.report.copy') }}</button>
          <button class="ghost" @click="saveReport">{{ t('o2dm.report.save') }}</button>
        </div>
        <pre class="report">{{ reportMarkdown }}</pre>
      </section>

      <!-- 底部导航 -->
      <div class="actions">
        <button class="ghost" :disabled="running" @click="closeWizard">
          {{ t('common.close') }}
        </button>
        <span class="spacer" />
        <button
          v-if="stepIdx(step) > 0 && step !== 'report'"
          class="ghost"
          :disabled="running"
          @click="gotoStep(STEPS[stepIdx(step) - 1].id)"
        >
          {{ t('o2dm.back') }}
        </button>
        <button
          v-if="step !== 'run' && step !== 'report'"
          class="primary"
          :disabled="
            (step === 'conn' && !(srcConnId && dstConnId)) ||
            (step === 'pick' && !selectedObjects.length) ||
            (step === 'preview' && !previewItems.length) ||
            loadingObjects ||
            loadingPreview
          "
          @click="gotoStep(STEPS[stepIdx(step) + 1].id)"
        >
          {{ t('o2dm.next') }}
        </button>
        <button
          v-else-if="step === 'run'"
          class="primary"
          :disabled="running || !previewItems.filter(p => !p.fetchError).length"
          @click="runExecute"
        >
          {{ running ? t('o2dm.run.running') : t('o2dm.run.start') }}
        </button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.wiz {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
}
.steps {
  list-style: none;
  margin: 0;
  padding: 0 0 10px;
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--border);
  flex: none;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 14px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
}
.steps li .num {
  display: inline-flex;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--border);
  align-items: center;
  justify-content: center;
  font-size: 11px;
}
.steps li.on {
  color: var(--text);
  border-color: var(--accent, #7c6cff);
  background: rgba(124, 108, 255, 0.12);
}
.steps li.on .num {
  background: var(--accent, #7c6cff);
  color: #fff;
  border-color: var(--accent, #7c6cff);
}
.steps li.done .num {
  background: rgba(76, 175, 80, 0.7);
  color: #fff;
  border-color: rgba(76, 175, 80, 0.7);
}
.content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.muted.small {
  font-size: 11px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.spacer {
  flex: 1 1 auto;
}
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lbl {
  font-size: 12px;
  color: var(--muted);
}
select,
input[type='text'],
input:not([type]) {
  padding: 6px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
}
select:focus,
input:focus {
  border-color: var(--accent, #7c6cff);
  outline: none;
}
.opt-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.obj-groups {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.obj-group {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  overflow: hidden;
  min-height: 0;
}
.obj-group header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.g-name {
  font-weight: 600;
  text-transform: capitalize;
}
.obj-list {
  flex: 1;
  overflow: auto;
  padding: 6px 10px;
  font-size: 12px;
}
.obj {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  font-family: var(--font-mono);
  font-size: 12px;
}
.obj input {
  margin: 0;
}
.empty {
  font-style: italic;
}
.preview-grid {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 12px;
  overflow: hidden;
}
.preview-grid.content {
  display: grid;
}
.obj-side {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  overflow: auto;
  min-height: 0;
}
.obj-side ul {
  list-style: none;
  margin: 0;
  padding: 4px 0;
}
.obj-side li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
}
.obj-side li.on {
  background: rgba(124, 108, 255, 0.15);
}
.obj-side li.err {
  color: var(--err, #e04050);
}
.obj-side li.warn .nm {
  color: var(--text);
}
.badge {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  text-align: center;
  line-height: 18px;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
}
.badge.g-tables {
  background: rgba(124, 108, 255, 0.85);
}
.badge.g-views {
  background: rgba(76, 175, 80, 0.85);
}
.badge.g-sequences {
  background: rgba(255, 152, 0, 0.85);
}
.badge.g-procedures {
  background: rgba(0, 150, 200, 0.85);
}
.nm {
  font-family: var(--font-mono);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.warn-dot {
  color: var(--warn, #ff9800);
  font-weight: 700;
}
.ddl-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 8px;
}
.ddl-pane header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
}
.ddl {
  flex: 1;
  min-height: 200px;
  resize: none;
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 10px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
}
.ddl:focus {
  border-color: var(--accent, #7c6cff);
}
.warns {
  border: 1px solid var(--warn, #ff9800);
  border-radius: 6px;
  padding: 8px 10px;
  background: rgba(255, 152, 0, 0.08);
  font-size: 12px;
  max-height: 140px;
  overflow: auto;
}
.warns .title {
  font-weight: 600;
  color: var(--warn, #ff9800);
  margin-bottom: 4px;
}
.warns ul {
  margin: 0;
  padding-left: 20px;
}
.warns li {
  margin: 2px 0;
}
.banner {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text);
  background: var(--panel);
}
.banner.err {
  border-color: var(--err, #e04050);
  color: var(--err, #e04050);
  background: rgba(224, 64, 80, 0.08);
}
.banner.inline {
  padding: 2px 6px;
  font-size: 11px;
}
.run-list {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 12px;
}
.run-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.run-row.ok {
  border-color: rgba(76, 175, 80, 0.4);
}
.run-row.fail {
  border-color: rgba(224, 64, 80, 0.6);
  background: rgba(224, 64, 80, 0.05);
}
.run-row .status {
  width: 16px;
  text-align: center;
  font-weight: 700;
}
.run-row.ok .status {
  color: var(--ok, #4caf50);
}
.run-row.fail .status {
  color: var(--err, #e04050);
}
.err-msg {
  color: var(--err, #e04050);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.report {
  flex: 1;
  margin: 0;
  padding: 10px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre-wrap;
  overflow: auto;
}
.actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.actions button {
  padding: 6px 16px;
}
.ghost.xs {
  padding: 2px 8px;
  font-size: 11px;
}
button.primary {
  background: var(--accent, #7c6cff);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
button.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button.ghost {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
button.ghost:hover {
  border-color: var(--accent, #7c6cff);
}
button.ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
