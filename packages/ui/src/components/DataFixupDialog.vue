<script setup lang="ts">
/**
 * 数据修整（B3 重复检测 + B4 NULL 补全 + B8 软删恢复）合在一张对话框 3 个 tab。
 *
 * 都是「输入条件 → 生成 SQL → 用户审阅 → 执行」的同样四步，共用一套 UI 骨架。
 * 不直接 commit，把生成的 SQL 抛给上层（QueryPane 当 pending）让用户检查。
 */
import type { ConnectionConfig } from '@db-tool/shared-types'
import { onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { quoteId } from '../ddl'
import { toast } from '../dialog'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig; table: string }>()
const emit = defineEmits<{ close: []; runSql: [sql: string] }>()
const client = useDataClient()

type Tab = 'dup' | 'nullfill' | 'softdel'
const active = ref<Tab>('dup')
const qt = quoteId(props.conn.dialect, props.table.replace(/^.*\./, ''))

const columns = ref<string[]>([])
onMounted(async () => {
  try {
    const r = await client.connections.execute(
      props.conn.id,
      `SELECT column_name FROM information_schema.columns WHERE table_name = '${props.table.replace(/^.*\./, '').replace(/['"\`]/g, '')}' ORDER BY ordinal_position`,
    )
    columns.value = r.rows.map((row) => String(row.column_name))
  } catch {
    /* ignore */
  }
})

// ── B3 重复检测 ──
const dupKeyCols = ref<string[]>([])
const dupResult = ref<Record<string, unknown>[]>([])
const dupBusy = ref(false)

function toggleDupCol(c: string): void {
  const i = dupKeyCols.value.indexOf(c)
  if (i >= 0) dupKeyCols.value.splice(i, 1)
  else dupKeyCols.value.push(c)
}

async function findDuplicates(): Promise<void> {
  if (!dupKeyCols.value.length) {
    toast.warn(t('fixup.pickDupCols'))
    return
  }
  dupBusy.value = true
  try {
    const cols = dupKeyCols.value.map((c) => quoteId(props.conn.dialect, c)).join(', ')
    const sql = `SELECT ${cols}, COUNT(*) AS cnt FROM ${qt} GROUP BY ${cols} HAVING COUNT(*) > 1 ORDER BY cnt DESC LIMIT 100`
    const r = await client.connections.execute(props.conn.id, sql)
    dupResult.value = r.rows
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    dupBusy.value = false
  }
}

function dupCleanupSql(): void {
  // 留每组里 ROWID/最小 PK 那条，删其余；用 ROW_NUMBER() 窗口函数
  const cols = dupKeyCols.value.map((c) => quoteId(props.conn.dialect, c)).join(', ')
  const sql = `-- 谨慎执行：会删除每个重复组里 ROW_NUMBER() > 1 的行。
-- 强烈建议先 BEGIN; 然后看影响数确认后再 COMMIT。
DELETE FROM ${qt}
WHERE (${cols}, ctid) IN (
  SELECT ${cols}, ctid FROM (
    SELECT ${cols}, ctid, ROW_NUMBER() OVER (PARTITION BY ${cols} ORDER BY ctid) AS rn
    FROM ${qt}
  ) sub WHERE sub.rn > 1
);
-- 注：PG 用 ctid；MySQL 没有 ctid，改用主键列：
--   DELETE t1 FROM ${qt} t1 JOIN ${qt} t2 WHERE t1.<pk> > t2.<pk> AND t1.col1 = t2.col1 ...`
  emit('runSql', sql)
}

// ── B4 NULL 补全 ──
const nullCol = ref<string>('')
const nullFillValue = ref<string>('')
const nullStrategy = ref<'literal' | 'avg' | 'min' | 'max' | 'most_common'>('literal')

function nullFillSql(): void {
  if (!nullCol.value) {
    toast.warn(t('fixup.pickCol'))
    return
  }
  const c = quoteId(props.conn.dialect, nullCol.value)
  let valExpr: string
  if (nullStrategy.value === 'literal') {
    valExpr = `'${nullFillValue.value.replace(/'/g, "''")}'`
  } else if (nullStrategy.value === 'avg') {
    valExpr = `(SELECT AVG(${c}) FROM ${qt})`
  } else if (nullStrategy.value === 'min') {
    valExpr = `(SELECT MIN(${c}) FROM ${qt})`
  } else if (nullStrategy.value === 'max') {
    valExpr = `(SELECT MAX(${c}) FROM ${qt})`
  } else {
    valExpr = `(SELECT ${c} FROM ${qt} WHERE ${c} IS NOT NULL GROUP BY ${c} ORDER BY COUNT(*) DESC LIMIT 1)`
  }
  emit(
    'runSql',
    `-- 把 ${nullCol.value} 列里的 NULL 用 ${nullStrategy.value} 策略补齐。建议先 SELECT COUNT(*) WHERE ${c} IS NULL 看影响数。
UPDATE ${qt} SET ${c} = ${valExpr} WHERE ${c} IS NULL;`,
  )
}

// ── B8 软删恢复 ──
const softDelCol = ref<string>('')
const softDelFilter = ref<string>('') // 额外 WHERE
onMounted(() => {
  // 智能默认：扫列名找软删字段
  setTimeout(() => {
    softDelCol.value = columns.value.find((c) => /deleted_at|is_deleted|deleted/i.test(c)) ?? ''
    nullCol.value = columns.value[0] ?? ''
  }, 100)
})

function softDelRestoreSql(): void {
  if (!softDelCol.value) {
    toast.warn(t('fixup.pickSoftDelCol'))
    return
  }
  const c = quoteId(props.conn.dialect, softDelCol.value)
  const isBool = /is_deleted|deleted_flag/i.test(softDelCol.value)
  const filter = softDelFilter.value.trim() ? `AND (${softDelFilter.value.trim()})` : ''
  const sql = isBool
    ? `UPDATE ${qt} SET ${c} = FALSE WHERE ${c} = TRUE ${filter};`
    : `-- 把 ${softDelCol.value} 时间戳列置 NULL 表示"复活"。建议先 SELECT * WHERE ${c} IS NOT NULL ${filter} 看影响范围。
UPDATE ${qt} SET ${c} = NULL WHERE ${c} IS NOT NULL ${filter};`
  emit('runSql', sql)
}
</script>

<template>
  <Modal :title="t('fixup.title', { table })" @close="emit('close')">
    <div class="fix">
      <div class="tabs">
        <button :class="{ on: active === 'dup' }" @click="active = 'dup'">🔍 {{ t('fixup.tabDup') }}</button>
        <button :class="{ on: active === 'nullfill' }" @click="active = 'nullfill'">∅ {{ t('fixup.tabNullFill') }}</button>
        <button :class="{ on: active === 'softdel' }" @click="active = 'softdel'">↺ {{ t('fixup.tabSoftDel') }}</button>
      </div>

      <!-- B3 重复检测 -->
      <div v-if="active === 'dup'" class="content">
        <p class="hint">{{ t('fixup.dupHint') }}</p>
        <div class="chips">
          <button v-for="c in columns" :key="c" :class="{ on: dupKeyCols.includes(c) }" @click="toggleDupCol(c)">{{ c }}</button>
        </div>
        <div class="actions">
          <button class="primary" :disabled="dupBusy" @click="findDuplicates">{{ t('fixup.findDup') }}</button>
          <button :disabled="!dupResult.length" @click="dupCleanupSql">{{ t('fixup.genCleanupSql') }}</button>
        </div>
        <div v-if="dupResult.length" class="dup-result">
          <p>{{ t('fixup.foundDup', { n: dupResult.length }) }}</p>
          <table class="mini-tbl">
            <thead><tr><th v-for="k in Object.keys(dupResult[0])" :key="k">{{ k }}</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in dupResult.slice(0, 20)" :key="i">
                <td v-for="k in Object.keys(r)" :key="k">{{ r[k] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- B4 NULL 补全 -->
      <div v-if="active === 'nullfill'" class="content">
        <p class="hint">{{ t('fixup.nullFillHint') }}</p>
        <label class="row"><span>{{ t('fixup.col') }}</span>
          <select v-model="nullCol"><option v-for="c in columns" :key="c" :value="c">{{ c }}</option></select>
        </label>
        <label class="row"><span>{{ t('fixup.strategy') }}</span>
          <select v-model="nullStrategy">
            <option value="literal">固定值</option>
            <option value="avg">平均值</option>
            <option value="min">最小值</option>
            <option value="max">最大值</option>
            <option value="most_common">众数</option>
          </select>
        </label>
        <label v-if="nullStrategy === 'literal'" class="row">
          <span>{{ t('fixup.value') }}</span>
          <input v-model="nullFillValue" />
        </label>
        <div class="actions">
          <button class="primary" @click="nullFillSql">{{ t('fixup.genFillSql') }}</button>
        </div>
      </div>

      <!-- B8 软删恢复 -->
      <div v-if="active === 'softdel'" class="content">
        <p class="hint">{{ t('fixup.softDelHint') }}</p>
        <label class="row"><span>{{ t('fixup.softDelCol') }}</span>
          <select v-model="softDelCol">
            <option value="">—</option>
            <option v-for="c in columns" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
        <label class="row"><span>{{ t('fixup.extraFilter') }}</span>
          <input v-model="softDelFilter" placeholder="e.g. id IN (1,2,3) OR user_id = 42" />
        </label>
        <div class="actions">
          <button class="primary" @click="softDelRestoreSql">{{ t('fixup.genRestoreSql') }}</button>
        </div>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.fix { min-width: 640px; min-height: 360px; display: flex; flex-direction: column; gap: 8px; }
.tabs { display: flex; gap: 4px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.tabs button { padding: 5px 12px; font-size: 12px; background: transparent; border: 1px solid transparent; border-radius: 6px; color: var(--muted); cursor: pointer; }
.tabs button.on { color: var(--accent); border-color: var(--accent); }
.content { display: flex; flex-direction: column; gap: 10px; }
.hint { font-size: 12px; color: var(--muted); line-height: 1.6; }
.chips { display: flex; gap: 4px; flex-wrap: wrap; }
.chips button { padding: 3px 10px; font-size: 11px; background: transparent; border: 1px solid var(--border); border-radius: 12px; color: var(--text); cursor: pointer; font-family: ui-monospace, monospace; }
.chips button.on { background: var(--accent, #7c6cff); color: #fff; border-color: var(--accent, #7c6cff); }
.actions { display: flex; gap: 8px; }
.actions button { padding: 5px 14px; font-size: 12px; background: transparent; border: 1px solid var(--border); border-radius: 4px; color: var(--text); cursor: pointer; }
.actions .primary { background: var(--accent, #7c6cff); color: #fff; border-color: var(--accent, #7c6cff); }
.actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.row { display: flex; align-items: center; gap: 8px; }
.row > span { width: 120px; font-size: 12px; color: var(--muted); }
.row select, .row input { flex: 1; padding: 4px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; }
.dup-result { font-size: 12px; }
.mini-tbl { width: 100%; border-collapse: collapse; }
.mini-tbl th, .mini-tbl td { border: 1px solid var(--border); padding: 3px 6px; font-family: ui-monospace, monospace; font-size: 11px; }
</style>
