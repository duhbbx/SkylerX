<script setup lang="ts">
/**
 * 数据检查器（A3 列采样 + B5 约束扫描 + B6 整表剖析 + B9 类型优化建议 + B10 表维护）。
 *
 * 一张对话框 5 个 tab，覆盖"看数据健康度 + 一键维护"的 DBA 排障核心动作。
 * 设计上不并发跑 SQL：怕拉爆生产；用户点哪个 tab 才拉哪个 tab 的数据。
 */
import type { ConnectionConfig, QueryResult } from '@db-tool/shared-types'
import { computed, ref } from 'vue'
import { useDataClient } from '../data-client'
import { familyOf, quoteId } from '../ddl'
import { confirm as appConfirm, toast } from '../dialog'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig; table: string }>()
const emit = defineEmits<{ close: [] }>()
const client = useDataClient()

type Tab = 'sample' | 'profile' | 'constraints' | 'typeopt' | 'maintain'
const active = ref<Tab>('sample')

// 简化的方言判定
const fam = computed(() => familyOf(props.conn.dialect))
const qt = computed(() => quoteId(props.conn.dialect, props.table.replace(/^.*\./, '')))

// ── A3 列采样 ──
const sampleCol = ref<string>('')
const sampleResult = ref<QueryResult | null>(null)
const sampleLoading = ref(false)
const columns = ref<{ name: string; type: string }[]>([])

async function loadColumns(): Promise<void> {
  if (columns.value.length) return
  try {
    if (fam.value === 'mysql') {
      const r = await client.connections.execute(
        props.conn.id,
        `SELECT COLUMN_NAME AS name, DATA_TYPE AS type
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${props.table.replace(/^.*\./, '').replace(/['"\`]/g, '')}'
         ORDER BY ORDINAL_POSITION`,
      )
      columns.value = r.rows as { name: string; type: string }[]
    } else if (fam.value === 'pg') {
      const r = await client.connections.execute(
        props.conn.id,
        `SELECT column_name AS name, data_type AS type
         FROM information_schema.columns
         WHERE table_name = '${props.table.replace(/^.*\./, '').replace(/['"\`]/g, '')}'
         ORDER BY ordinal_position`,
      )
      columns.value = r.rows as { name: string; type: string }[]
    }
    if (!sampleCol.value && columns.value.length) sampleCol.value = columns.value[0].name
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

async function runSample(): Promise<void> {
  if (!sampleCol.value) return
  sampleLoading.value = true
  try {
    const c = quoteId(props.conn.dialect, sampleCol.value)
    // 一条 SQL 跑完所有统计：总数 / NULL 数 / DISTINCT 数 / min / max
    const sql = `SELECT
      COUNT(*) AS total,
      COUNT(${c}) AS non_null,
      COUNT(DISTINCT ${c}) AS distinct_cnt,
      MIN(${c}) AS min_val,
      MAX(${c}) AS max_val
    FROM ${qt.value}`
    sampleResult.value = await client.connections.execute(props.conn.id, sql)
    // top-N 列表
    topN.value = (
      await client.connections.execute(
        props.conn.id,
        `SELECT ${c} AS value, COUNT(*) AS cnt FROM ${qt.value} GROUP BY ${c} ORDER BY cnt DESC LIMIT 10`,
      )
    ).rows
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    sampleLoading.value = false
  }
}
const topN = ref<Record<string, unknown>[]>([])

// ── B6 整表剖析 ──
const profileResult = ref<
  { col: string; type: string; nullPct: number; distinct: number; total: number }[]
>([])
const profileLoading = ref(false)

async function runProfile(): Promise<void> {
  await loadColumns()
  if (!columns.value.length) return
  profileLoading.value = true
  profileResult.value = []
  try {
    // 拼一条大 SELECT，每列 COUNT(col) + COUNT(DISTINCT col)；只跑一次
    const colExprs: string[] = []
    for (const c of columns.value) {
      const qc = quoteId(props.conn.dialect, c.name)
      colExprs.push(`COUNT(${qc}) AS \`nn_${c.name}\``)
      colExprs.push(`COUNT(DISTINCT ${qc}) AS \`dc_${c.name}\``)
    }
    const sql = `SELECT COUNT(*) AS total, ${colExprs.join(', ')} FROM ${qt.value}`
    const r = await client.connections.execute(props.conn.id, sql)
    const row = r.rows[0] as Record<string, unknown> | undefined
    if (!row) return
    const total = Number(row.total ?? 0)
    profileResult.value = columns.value.map((c) => {
      const nonNull = Number(row[`nn_${c.name}`] ?? 0)
      const distinct = Number(row[`dc_${c.name}`] ?? 0)
      return {
        col: c.name,
        type: c.type,
        total,
        nullPct: total ? (1 - nonNull / total) * 100 : 0,
        distinct,
      }
    })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    profileLoading.value = false
  }
}

// ── B5 约束扫描 ──
interface Violation {
  kind: string
  col: string
  count: number
  sample: string
}
const violations = ref<Violation[]>([])
const constraintsLoading = ref(false)

async function runConstraints(): Promise<void> {
  await loadColumns()
  constraintsLoading.value = true
  violations.value = []
  try {
    // 1. NOT NULL 但实际有 NULL 的列
    if (fam.value === 'mysql') {
      const r = await client.connections.execute(
        props.conn.id,
        `SELECT COLUMN_NAME AS col
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${props.table.replace(/^.*\./, '').replace(/['"\`]/g, '')}' AND IS_NULLABLE = 'NO'`,
      )
      for (const row of r.rows) {
        const col = String(row.col)
        const qc = quoteId(props.conn.dialect, col)
        const cnt = await client.connections.execute(
          props.conn.id,
          `SELECT COUNT(*) AS c FROM ${qt.value} WHERE ${qc} IS NULL`,
        )
        const n = Number((cnt.rows[0] as Record<string, unknown> | undefined)?.c ?? 0)
        if (n > 0) violations.value.push({ kind: 'NULL in NOT NULL', col, count: n, sample: '' })
      }
    }
    // 2. UNIQUE 列里实际有重复（跳过：检查 PK / UNIQUE 索引需要元数据查询，方言差异大；这版只跑 NOT NULL）
    if (!violations.value.length) {
      violations.value.push({ kind: 'ok', col: '', count: 0, sample: t('inspect.noViolations') })
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    constraintsLoading.value = false
  }
}

// ── B9 类型优化建议 ──
interface TypeHint {
  col: string
  currentType: string
  suggestion: string
  reason: string
}
const typeHints = ref<TypeHint[]>([])
const typeOptLoading = ref(false)

async function runTypeOpt(): Promise<void> {
  await loadColumns()
  typeOptLoading.value = true
  typeHints.value = []
  try {
    // 对每列拉 max length（字符）/ max abs value（数字），给收缩建议
    for (const c of columns.value) {
      const qc = quoteId(props.conn.dialect, c.name)
      try {
        if (/varchar|char|text/i.test(c.type)) {
          const r = await client.connections.execute(
            props.conn.id,
            fam.value === 'mysql'
              ? `SELECT MAX(CHAR_LENGTH(${qc})) AS maxlen FROM ${qt.value}`
              : `SELECT MAX(length(${qc})) AS maxlen FROM ${qt.value}`,
          )
          const maxlen = Number((r.rows[0] as Record<string, unknown> | undefined)?.maxlen ?? 0)
          // 如果类型是 varchar(255) 而实际最大才 20，建议收缩
          const m = /varchar\((\d+)\)|character varying\((\d+)\)/i.exec(c.type)
          if (m && maxlen > 0) {
            const declared = Number(m[1] ?? m[2])
            if (declared > maxlen * 4 && declared - maxlen > 50) {
              typeHints.value.push({
                col: c.name,
                currentType: c.type,
                suggestion: `VARCHAR(${Math.max(32, Math.ceil(maxlen * 1.5))})`,
                reason: t('inspect.shrinkVarcharReason', { actual: maxlen, declared: declared }),
              })
            }
          }
        } else if (/int|bigint/i.test(c.type)) {
          const r = await client.connections.execute(
            props.conn.id,
            `SELECT MAX(ABS(${qc})) AS maxabs FROM ${qt.value}`,
          )
          const maxabs = Number((r.rows[0] as Record<string, unknown> | undefined)?.maxabs ?? 0)
          if (/bigint/i.test(c.type) && maxabs < 2_147_483_647) {
            typeHints.value.push({
              col: c.name,
              currentType: c.type,
              suggestion: 'INT',
              reason: t('inspect.shrinkBigintReason', { maxabs }),
            })
          } else if (/^int/i.test(c.type) && maxabs < 32767) {
            typeHints.value.push({
              col: c.name,
              currentType: c.type,
              suggestion: 'SMALLINT',
              reason: t('inspect.shrinkIntReason', { maxabs }),
            })
          }
        }
      } catch {
        /* 单列失败不致命 */
      }
    }
    if (!typeHints.value.length) {
      typeHints.value.push({
        col: '',
        currentType: '',
        suggestion: '',
        reason: t('inspect.noTypeHints'),
      })
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    typeOptLoading.value = false
  }
}

// ── B10 表维护 ──
async function runMaintain(op: string): Promise<void> {
  if (
    !(await appConfirm({
      title: t('inspect.maintainTitle'),
      message: t('inspect.maintainConfirm', { op, table: props.table }),
      variant: 'warn',
    }))
  )
    return
  try {
    let sql = ''
    if (fam.value === 'mysql') {
      sql = `${op} TABLE ${qt.value}`
    } else if (fam.value === 'pg') {
      sql = op === 'OPTIMIZE' ? `VACUUM FULL ${qt.value}` : `${op} ${qt.value}`
    } else {
      toast.warn(t('inspect.maintainUnsupported'))
      return
    }
    await client.connections.execute(props.conn.id, sql)
    toast.success(t('inspect.maintainOk', { op }))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  }
}

// tab 切换时按需加载
async function switchTab(t: Tab): Promise<void> {
  active.value = t
  if (t === 'sample' && !columns.value.length) await loadColumns()
}
void switchTab('sample')
</script>

<template>
  <Modal :title="t('inspect.title', { table })" @close="emit('close')">
    <div class="ins">
      <div class="tabs">
        <button :class="{ on: active === 'sample' }" @click="switchTab('sample')">📊 {{ t('inspect.tabSample') }}</button>
        <button :class="{ on: active === 'profile' }" @click="switchTab('profile'); runProfile()">📋 {{ t('inspect.tabProfile') }}</button>
        <button :class="{ on: active === 'constraints' }" @click="switchTab('constraints'); runConstraints()">🛡 {{ t('inspect.tabConstraints') }}</button>
        <button :class="{ on: active === 'typeopt' }" @click="switchTab('typeopt'); runTypeOpt()">📐 {{ t('inspect.tabTypeOpt') }}</button>
        <button :class="{ on: active === 'maintain' }" @click="switchTab('maintain')">🔧 {{ t('inspect.tabMaintain') }}</button>
      </div>

      <!-- 列采样 -->
      <div v-if="active === 'sample'" class="content">
        <div class="cfg">
          <select v-model="sampleCol">
            <option v-for="c in columns" :key="c.name" :value="c.name">{{ c.name }} ({{ c.type }})</option>
          </select>
          <button class="primary" :disabled="sampleLoading" @click="runSample">{{ sampleLoading ? '…' : t('inspect.run') }}</button>
        </div>
        <div v-if="sampleResult?.rows.length" class="stats">
          <div v-for="(v, k) in sampleResult.rows[0]" :key="String(k)" class="stat-card">
            <div class="stat-lbl">{{ k }}</div>
            <div class="stat-val">{{ v == null ? 'NULL' : String(v) }}</div>
          </div>
        </div>
        <div v-if="topN.length" class="topn">
          <h4>{{ t('inspect.topN') }}</h4>
          <table>
            <thead><tr><th>{{ t('inspect.value') }}</th><th>{{ t('inspect.count') }}</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in topN" :key="i"><td>{{ r.value ?? 'NULL' }}</td><td>{{ r.cnt }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 整表剖析 -->
      <div v-if="active === 'profile'" class="content">
        <div v-if="profileLoading" class="loading">{{ t('inspect.loading') }}</div>
        <table v-else-if="profileResult.length" class="prof-tbl">
          <thead><tr><th>{{ t('inspect.colName') }}</th><th>{{ t('inspect.type') }}</th><th>NULL %</th><th>DISTINCT</th></tr></thead>
          <tbody>
            <tr v-for="r in profileResult" :key="r.col">
              <td>{{ r.col }}</td>
              <td>{{ r.type }}</td>
              <td :class="{ warn: r.nullPct > 50 }">{{ r.nullPct.toFixed(1) }}%</td>
              <td>{{ r.distinct }} / {{ r.total }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 约束扫描 -->
      <div v-if="active === 'constraints'" class="content">
        <div v-if="constraintsLoading" class="loading">{{ t('inspect.loading') }}</div>
        <table v-else-if="violations.length" class="prof-tbl">
          <thead><tr><th>{{ t('inspect.kind') }}</th><th>{{ t('inspect.colName') }}</th><th>{{ t('inspect.count') }}</th></tr></thead>
          <tbody>
            <tr v-for="(v, i) in violations" :key="i">
              <td :class="{ ok: v.kind === 'ok' }">{{ v.kind === 'ok' ? '✓' : '⚠ ' + v.kind }}</td>
              <td>{{ v.col }}</td>
              <td>{{ v.count || v.sample }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 类型优化 -->
      <div v-if="active === 'typeopt'" class="content">
        <div v-if="typeOptLoading" class="loading">{{ t('inspect.loading') }}</div>
        <table v-else-if="typeHints.length" class="prof-tbl">
          <thead><tr><th>{{ t('inspect.colName') }}</th><th>{{ t('inspect.currentType') }}</th><th>{{ t('inspect.suggestion') }}</th><th>{{ t('inspect.reason') }}</th></tr></thead>
          <tbody>
            <tr v-for="(h, i) in typeHints" :key="i">
              <td>{{ h.col || '—' }}</td>
              <td><code>{{ h.currentType }}</code></td>
              <td><code>{{ h.suggestion }}</code></td>
              <td class="reason">{{ h.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 表维护 -->
      <div v-if="active === 'maintain'" class="content maintain">
        <p>{{ t('inspect.maintainHint', { table }) }}</p>
        <div class="maintain-grid">
          <button @click="runMaintain('ANALYZE')">🧮 ANALYZE</button>
          <button @click="runMaintain('OPTIMIZE')">✨ {{ fam === 'pg' ? 'VACUUM FULL' : 'OPTIMIZE' }}</button>
          <button @click="runMaintain(fam === 'pg' ? 'VACUUM' : 'CHECK')">🔍 {{ fam === 'pg' ? 'VACUUM' : 'CHECK' }}</button>
          <button v-if="fam === 'pg'" @click="runMaintain('REINDEX TABLE')">📚 REINDEX</button>
        </div>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.ins { min-width: 760px; min-height: 480px; max-height: 75vh; display: flex; flex-direction: column; gap: 8px; }
.tabs { display: flex; gap: 4px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.tabs button {
  padding: 5px 12px; font-size: 12px;
  background: transparent; border: 1px solid transparent; border-radius: 6px;
  color: var(--muted); cursor: pointer;
}
.tabs button:hover { color: var(--text); background: rgba(124, 108, 255, 0.10); }
.tabs button.on { color: var(--accent); border-color: var(--accent); }
.content { flex: 1; overflow-y: auto; }
.cfg { display: flex; gap: 8px; padding-bottom: 8px; }
.cfg select { padding: 4px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; flex: 1; }
.cfg .primary { padding: 4px 14px; font-size: 12px; background: var(--accent, #7c6cff); color: #fff; border: 1px solid var(--accent, #7c6cff); border-radius: 4px; cursor: pointer; }
.cfg .primary:disabled { opacity: 0.6; }
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; margin-bottom: 12px; }
.stat-card { padding: 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; }
.stat-lbl { font-size: 11px; color: var(--muted); }
.stat-val { font-size: 14px; font-weight: 600; font-family: ui-monospace, monospace; word-break: break-all; }
.topn h4 { margin: 12px 0 6px; font-size: 12px; color: var(--muted); }
.topn table, .prof-tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.topn th, .topn td, .prof-tbl th, .prof-tbl td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; font-family: ui-monospace, monospace; }
.topn th, .prof-tbl th { background: var(--panel); font-weight: 600; }
.prof-tbl td.warn { color: #e0a020; font-weight: 600; }
.prof-tbl td.ok { color: #4caf50; }
.prof-tbl td.reason { color: var(--muted); font-size: 11px; font-family: inherit; }
.loading { padding: 24px; text-align: center; color: var(--muted); }
.maintain p { font-size: 12px; color: var(--muted); }
.maintain-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.maintain-grid button {
  padding: 10px 14px; font-size: 13px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  color: var(--text); cursor: pointer; text-align: left;
}
.maintain-grid button:hover { background: rgba(124, 108, 255, 0.10); border-color: var(--accent, #7c6cff); }
</style>
