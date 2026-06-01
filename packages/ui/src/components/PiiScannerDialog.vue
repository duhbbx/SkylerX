<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * PII 扫描器:
 *  - 选库/schema → 拉所有 table.column
 *  - 启发式扫描:列名匹配 masking.ts 现有规则(phone/email/idcard/...)
 *  - 抽样验证(可选):对每列取 N 行,用 regex 二次确认
 *  - 报告: 库.表.列 → 命中规则 → 推荐脱敏方式
 *
 * 不动数据库本身,仅生成扫描报告;用户可以基于报告决定建脱敏视图 / 加 ACL / 加监控。
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { familyOf } from '../ddl'
import { toast } from '../dialog'
import { reportError } from '../errorReporter'
import { DEFAULT_MASK_RULES, type MaskKind } from '../masking'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
  database?: string
  schema?: string
}>()

const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

interface Hit {
  database: string
  schemaName: string
  table: string
  column: string
  dataType: string
  ruleName: string
  kind: MaskKind
  /** 抽样命中条数(若启用抽样) */
  sampleMatches?: number
  /** 抽样总条数 */
  sampleTotal?: number
}

const dbName = ref(props.database ?? '')
const schemaName = ref(props.schema ?? '')
const tblFilter = ref('')
const sampling = ref(true)
const sampleN = ref(50)
const running = ref(false)
const cancel = ref(false)
const progress = ref<{ scanned: number; matched: number; current?: string } | null>(null)
const hits = ref<Hit[]>([])

const PII_REGEX: Record<MaskKind, RegExp | null> = {
  phone: /^\+?[\d\s\-()]{7,20}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  idCard: /^\d{15}$|^\d{17}[\dxX]$/,
  bankCard: /^\d{12,19}$/,
  name: null,
  address: null,
  default: null,
}

async function execSql(sql: string, database?: string): Promise<Record<string, unknown>[]> {
  const ctx = database ? { database } : {}
  const r = await client.connections.execute(props.conn.id, sql, [], ctx)
  return (r.rows as Record<string, unknown>[]) ?? []
}

/** 按方言族返回拉 columns 的 SQL。 */
function listColumnsSql(): string {
  const fam = familyOf(props.conn.dialect)
  if (fam === 'pg') {
    return `SELECT table_schema, table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog','information_schema')
      ${schemaName.value ? `AND table_schema = '${schemaName.value.replace(/'/g, "''")}'` : ''}
      ${tblFilter.value ? `AND table_name LIKE '${tblFilter.value.replace(/'/g, "''")}'` : ''}
      ORDER BY table_schema, table_name, ordinal_position`
  }
  if (fam === 'oracle') {
    // Oracle/DM 没有 information_schema. 用 ALL_TAB_COLUMNS, 字段名归一到 PG/MySQL 同款.
    // 列名小写化 + AS, 让上游 cols 的 r.table_schema 等键稳定.
    const owner = (schemaName.value || dbName.value).replace(/'/g, "''")
    return `SELECT owner AS "table_schema", table_name AS "table_name",
                  column_name AS "column_name", data_type AS "data_type"
       FROM all_tab_columns
       WHERE owner NOT IN (
         'SYS','SYSTEM','XDB','MDSYS','CTXSYS','DBSNMP','OUTLN',
         'APEX_040000','APPQOSSYS','GSMADMIN_INTERNAL','OJVMSYS',
         'ORDDATA','ORDSYS','SI_INFORMTN_SCHEMA','WMSYS'
       )
       ${owner ? `AND owner = '${owner}'` : ''}
       ${tblFilter.value ? `AND table_name LIKE '${tblFilter.value.replace(/'/g, "''")}'` : ''}
       ORDER BY owner, table_name, column_id`
  }
  // mysql / sqlserver / 通用走 information_schema
  return `SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema NOT IN ('mysql','sys','information_schema','performance_schema')
    ${dbName.value ? `AND table_schema = '${dbName.value.replace(/'/g, "''")}'` : ''}
    ${tblFilter.value ? `AND table_name LIKE '${tblFilter.value.replace(/'/g, "''")}'` : ''}
    ORDER BY table_schema, table_name, ordinal_position`
}

/** 给列采样 N 个非空值。 */
async function sampleColumn(schema: string, table: string, column: string): Promise<unknown[]> {
  const fam = familyOf(props.conn.dialect)
  const q = (s: string): string => {
    if (fam === 'mysql') return `\`${s.replace(/`/g, '``')}\``
    return `"${s.replace(/"/g, '""')}"`
  }
  // LIMIT 跨方言: mysql/pg/sqlserver 走 LIMIT; oracle/dm 用 FETCH FIRST N ROWS ONLY
  // (12c+ / DM 标准 SQL:2008), 老 Oracle 用 ROWNUM 但我们的 supported set 都 ≥12c.
  const limitClause =
    fam === 'oracle' ? `FETCH FIRST ${sampleN.value} ROWS ONLY` : `LIMIT ${sampleN.value}`
  const sql = `SELECT ${q(column)} FROM ${q(schema)}.${q(table)} WHERE ${q(column)} IS NOT NULL ${limitClause}`
  try {
    const rows = await execSql(sql, dbName.value || undefined)
    return rows.map((r) => Object.values(r)[0])
  } catch {
    return []
  }
}

async function run(): Promise<void> {
  running.value = true
  cancel.value = false
  hits.value = []
  progress.value = { scanned: 0, matched: 0 }
  try {
    const cols = await execSql(listColumnsSql(), dbName.value || undefined)
    for (const r of cols) {
      if (cancel.value) break
      progress.value.scanned++
      const tableSchema = String(r.table_schema ?? r.TABLE_SCHEMA ?? '')
      const tableName = String(r.table_name ?? r.TABLE_NAME ?? '')
      const colName = String(r.column_name ?? r.COLUMN_NAME ?? '')
      const dataType = String(r.data_type ?? r.DATA_TYPE ?? '')
      progress.value.current = `${tableSchema}.${tableName}.${colName}`
      // 列名启发式匹配
      let matchedRule: (typeof DEFAULT_MASK_RULES)[number] | null = null
      for (const rule of DEFAULT_MASK_RULES) {
        try {
          if (new RegExp(rule.columnPattern, 'i').test(colName)) {
            matchedRule = rule
            break
          }
        } catch {
          /* ignore bad regex */
        }
      }
      if (!matchedRule) continue
      // 抽样验证(可选)
      let sampleMatches: number | undefined
      let sampleTotal: number | undefined
      if (sampling.value) {
        const verifier = PII_REGEX[matchedRule.kind]
        if (verifier) {
          const sample = await sampleColumn(tableSchema, tableName, colName)
          sampleTotal = sample.length
          sampleMatches = sample.filter((v) => verifier.test(String(v))).length
          if (sampleTotal > 0 && sampleMatches / sampleTotal < 0.3) continue
        }
      }
      hits.value.push({
        database: dbName.value || '',
        schemaName: tableSchema,
        table: tableName,
        column: colName,
        dataType,
        ruleName: matchedRule.name,
        kind: matchedRule.kind,
        sampleMatches,
        sampleTotal,
      })
      progress.value.matched++
    }
    toast.success(`扫描完成,${hits.value.length} 处命中`)
  } catch (e) {
    reportError(e, { tag: 'pii-scan' })
  } finally {
    running.value = false
    cancel.value = false
    progress.value = null
  }
}

function stop(): void {
  cancel.value = true
}

const exportText = computed(() => {
  if (!hits.value.length) return ''
  const headers = ['schema', 'table', 'column', 'data_type', 'rule', 'kind', 'sample']
  const lines = [headers.join(',')]
  for (const h of hits.value) {
    const sample =
      h.sampleTotal != null && h.sampleMatches != null ? `${h.sampleMatches}/${h.sampleTotal}` : ''
    lines.push(
      [h.schemaName, h.table, h.column, h.dataType, h.ruleName, h.kind, sample]
        .map((v) => (v.includes(',') ? `"${v}"` : v))
        .join(','),
    )
  }
  return lines.join('\n')
})

async function exportCsv(): Promise<void> {
  // 走自定义 SaveFileDialog(client.files.saveText 已被 useDataClient 包装)
  const path = await client.files.saveText({
    defaultName: `pii_scan_${props.conn.name}_${Date.now()}.csv`,
    content: exportText.value,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (path) toast.success(`已导出 → ${path}`)
}

watch(
  () => props.open,
  (op) => {
    if (op) {
      hits.value = []
      progress.value = null
    }
  },
)

const groupedByTable = computed(() => {
  const m = new Map<string, Hit[]>()
  for (const h of hits.value) {
    const key = `${h.schemaName}.${h.table}`
    const arr = m.get(key) ?? []
    arr.push(h)
    m.set(key, arr)
  }
  return Array.from(m.entries()).sort(([, a], [, b]) => b.length - a.length)
})
</script>

<template>
  <Modal v-if="open" :title="`PII 扫描器  ·  ${conn.name || conn.dialect}`" width="xl" fixed-height storage-key="pii-scanner" @close="emit('close')">
    <!-- 帮助说明:第一次打开就能看明白这个面板是干啥的 -->
    <div class="help-banner">
      <span class="help-ico" title="什么是 PII 扫描器">❓</span>
      <span class="help-text">
        <b>PII (Personally Identifiable Information) 扫描器</b>:在你选的范围内扫描所有列名,
        启发式识别可能含敏感信息的列(手机/邮箱/身份证/银行卡/姓名/地址/密码 token 等),
        可选打开"抽样验证" 拉每列前 N 行用正则二次确认。
        报告导出 CSV 后可拿去做合规审计 / 决定哪些列要建脱敏视图(右键库 → 生成脱敏视图)。
      </span>
    </div>
    <!-- 重排:第一行三个输入(等宽),第二行抽样验证+扫描按钮(右对齐),避免互相挤压 -->
    <div class="ctrl">
      <input v-model="dbName" class="ip" placeholder="database(留空 = 默认/全部)" />
      <input v-model="schemaName" class="ip" placeholder="schema(PG 系)" />
      <input v-model="tblFilter" class="ip" placeholder="table LIKE(如 user_%)" />
    </div>
    <div class="ctrl-row2">
      <label class="lbl-inline" title="对命中列再抽样 N 行,用 regex 二次确认">
        <input v-model="sampling" type="checkbox" />
        <span class="nowrap">抽样验证</span>
        <input v-model.number="sampleN" type="number" class="ip-mini" min="10" max="1000" />
        <span class="nowrap">行</span>
      </label>
      <span class="spacer" />
      <button v-if="!running" class="btn-primary nowrap" @click="run">▶ 开始扫描</button>
      <button v-else class="btn-danger nowrap" @click="stop">■ 停止</button>
    </div>

    <div v-if="progress" class="progress">
      <span class="meta">已扫 {{ progress.scanned }} 列 · 命中 {{ progress.matched }} 处 · 当前: {{ progress.current }}</span>
    </div>

    <div class="body">
      <div v-if="!hits.length && !running" class="empty">点 ▶ 扫描开始。基于列名模式 + 数据抽样 regex 验证。</div>
      <template v-else>
        <div class="summary">
          <span class="lbl">报告</span>
          <span class="meta">共 {{ hits.length }} 处命中,涉及 {{ groupedByTable.length }} 张表</span>
          <span class="spacer" />
          <button class="btn" @click="exportCsv">📋 导出 CSV</button>
        </div>
        <table class="grid">
          <thead>
            <tr>
              <th>schema</th>
              <th>table</th>
              <th>column</th>
              <th style="width: 90px">data_type</th>
              <th style="width: 120px">命中规则</th>
              <th style="width: 80px">类别</th>
              <th style="width: 90px">抽样命中</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in hits" :key="`${h.schemaName}.${h.table}.${h.column}`" :class="`rule-${h.kind}`">
              <td class="mono">{{ h.schemaName }}</td>
              <td class="mono">{{ h.table }}</td>
              <td class="mono"><b>{{ h.column }}</b></td>
              <td>{{ h.dataType }}</td>
              <td>{{ h.ruleName }}</td>
              <td><span class="tag" :data-kind="h.kind">{{ h.kind }}</span></td>
              <td>
                <span v-if="h.sampleTotal != null">
                  {{ h.sampleMatches }} / {{ h.sampleTotal }}
                  ({{ Math.round(((h.sampleMatches ?? 0) / (h.sampleTotal || 1)) * 100) }}%)
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.help-banner {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(124, 108, 255, 0.08);
  border: 1px solid rgba(124, 108, 255, 0.3);
  border-radius: 6px;
  margin-bottom: 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
}
.help-ico { font-size: 16px; flex-shrink: 0; }
.help-text { flex: 1; }
.nowrap { white-space: nowrap; flex-shrink: 0; }
.ctrl {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 0 6px;
  flex-wrap: nowrap;
}
.ctrl .ip { flex: 1 1 0; min-width: 0; }
.ctrl-row2 {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 0 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 8px;
}
.spacer { flex: 1; }
.ip { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 3px 8px; color: var(--text); font-size: 12px; font-family: var(--font-mono); width: 130px; }
.ip-mini { width: 60px; padding: 3px 6px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 11px; }
.lbl-inline { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--muted); }
.btn, .btn-primary, .btn-danger, .btn-ghost { padding: 4px 12px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 12px; background: var(--bg); color: var(--text); }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-danger { background: var(--err, #e04050); color: #fff; border-color: var(--err, #e04050); }
.btn-ghost { background: transparent; color: var(--muted); padding: 6px 14px; font-size: 13px; }
.progress { padding: 6px 10px; background: var(--panel); border-radius: 6px; margin-bottom: 6px; }
.meta { font-size: 11px; color: var(--muted); }
.body { flex: 1; overflow: auto; max-height: 60vh; }
.empty { padding: 40px; text-align: center; color: var(--muted); }
.summary { display: flex; align-items: center; gap: 10px; padding: 4px 0 8px; }
.lbl { font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; }
.grid { width: 100%; border-collapse: collapse; font-size: 12px; }
.grid th, .grid td { border-bottom: 1px solid var(--border); padding: 4px 8px; text-align: left; }
.grid th { background: var(--panel); color: var(--muted); position: sticky; top: 0; }
.mono { font-family: var(--font-mono); word-break: break-all; }
tr.rule-email td { background: rgba(76, 175, 80, 0.04); }
tr.rule-phone td { background: rgba(255, 152, 0, 0.04); }
tr.rule-idCard td { background: rgba(224, 64, 80, 0.05); }
tr.rule-bankCard td { background: rgba(224, 64, 80, 0.08); }
tr.rule-default td { background: rgba(124, 108, 255, 0.06); }
.tag { display: inline-block; padding: 1px 6px; border-radius: 3px; color: #fff; font-size: 10px; font-family: var(--font-mono); background: #888; }
.tag[data-kind='email'] { background: #4caf50; }
.tag[data-kind='phone'] { background: #ff9800; }
.tag[data-kind='idCard'], .tag[data-kind='bankCard'] { background: #e04050; }
.tag[data-kind='default'] { background: #7c6cff; }
</style>
