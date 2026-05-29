<script setup lang="ts">/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ConnectionConfig, DbDialect, type QueryResult } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { t } from '../i18n'
import { type TableSnapshot, diffSchemas, generateMigration } from '../schema-diff'
import Modal from './Modal.vue'

const client = useDataClient()
const emit = defineEmits<{ close: []; openSql: [string, string] }>()

const conns = ref<ConnectionConfig[]>([])
const srcId = ref('')
const tgtId = ref('')
const srcSchema = ref('')
const tgtSchema = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
const migration = ref<string | null>(null)
const diffs = ref<ReturnType<typeof diffSchemas>>([])

const connOf = (id: string) => conns.value.find((c) => c.id === id)

function fam(d: DbDialect | undefined): 'mysql' | 'pg' | 'other' {
  if (d && [DbDialect.MySQL, DbDialect.MariaDB, DbDialect.OceanBase].includes(d)) return 'mysql'
  if (d && [DbDialect.PostgreSQL, DbDialect.KingbaseES].includes(d)) return 'pg'
  return 'other'
}
function defaultSchema(c: ConnectionConfig | undefined): string {
  if (!c) return ''
  return fam(c.dialect) === 'pg' ? 'public' : (c.database ?? '')
}

const supported = computed(() => {
  const s = connOf(srcId.value)
  const t = connOf(tgtId.value)
  return s && t && fam(s.dialect) !== 'other' && fam(t.dialect) !== 'other'
})

const summary = computed(() => ({
  added: diffs.value.filter((d) => d.status === 'added').length,
  changed: diffs.value.filter((d) => d.status === 'changed').length,
  removed: diffs.value.filter((d) => d.status === 'removed').length,
}))

onMounted(async () => {
  conns.value = await client.connections.list()
})

function onPickSrc(): void {
  srcSchema.value = defaultSchema(connOf(srcId.value))
}
function onPickTgt(): void {
  tgtSchema.value = defaultSchema(connOf(tgtId.value))
}

/** 用 information_schema 一次性取某连接某 schema 下的表+列。 */
async function fetchSnapshot(
  connId: string,
  dialect: DbDialect,
  schema: string,
): Promise<TableSnapshot[]> {
  const esc = schema.replace(/'/g, "''")
  const sql =
    fam(dialect) === 'mysql'
      ? `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS ty, IS_NULLABLE AS nul, COLUMN_KEY AS k, COLUMN_DEFAULT AS dflt
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${esc}'
         ORDER BY TABLE_NAME, ORDINAL_POSITION`
      : `SELECT table_name AS t, column_name AS c, data_type AS ty, is_nullable AS nul, column_default AS dflt
         FROM information_schema.columns WHERE table_schema = '${esc}'
         ORDER BY table_name, ordinal_position`
  const res = (await client.connections.execute(connId, sql, [])) as QueryResult
  const byTable = new Map<string, TableSnapshot>()
  for (const row of res.rows as Record<string, unknown>[]) {
    const tname = String(row.t)
    let snap = byTable.get(tname)
    if (!snap) {
      snap = { name: tname, columns: [] }
      byTable.set(tname, snap)
    }
    snap.columns.push({
      name: String(row.c),
      dataType: String(row.ty),
      nullable: String(row.nul).toUpperCase() === 'YES',
      primaryKey: row.k === 'PRI',
      defaultValue: row.dflt == null ? null : String(row.dflt),
    })
  }
  return [...byTable.values()]
}

async function runDiff(): Promise<void> {
  const s = connOf(srcId.value)
  const t = connOf(tgtId.value)
  if (!s || !t) return
  busy.value = true
  error.value = null
  migration.value = null
  diffs.value = []
  try {
    const [srcSnap, tgtSnap] = await Promise.all([
      fetchSnapshot(s.id, s.dialect, srcSchema.value.trim()),
      fetchSnapshot(t.id, t.dialect, tgtSchema.value.trim()),
    ])
    diffs.value = diffSchemas(srcSnap, tgtSnap)
    migration.value = generateMigration(diffs.value, t.dialect, srcSnap)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function copySql(): void {
  if (migration.value) void navigator.clipboard?.writeText(migration.value)
}
function openInQuery(): void {
  if (migration.value && tgtId.value) {
    emit('openSql', tgtId.value, migration.value)
    emit('close')
  }
}
</script>

<template>
  <Modal :title="t('sdiff.title')" @close="emit('close')">
    <div class="diff">
      <div class="pickers">
        <div class="side">
          <label>{{ t('sdiff.srcConn') }}</label>
          <select v-model="srcId" @change="onPickSrc">
            <option value="" disabled>{{ t('diff.selectConn') }}</option>
            <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }} · {{ c.dialect }}</option>
          </select>
          <input v-model="srcSchema" :placeholder="t('diff.schemaPh')" />
        </div>
        <span class="arrow">→</span>
        <div class="side">
          <label>{{ t('sdiff.tgtConn') }}</label>
          <select v-model="tgtId" @change="onPickTgt">
            <option value="" disabled>{{ t('diff.selectConn') }}</option>
            <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }} · {{ c.dialect }}</option>
          </select>
          <input v-model="tgtSchema" :placeholder="t('diff.schemaPh')" />
        </div>
      </div>

      <div class="actions">
        <button class="primary" :disabled="busy || !supported || !srcId || !tgtId" @click="runDiff">
          {{ busy ? t('diff.comparing') : t('diff.compare') }}
        </button>
        <span v-if="srcId && tgtId && !supported" class="warn">{{ t('diff.onlyMyPg') }}</span>
      </div>

      <div v-if="error" class="banner err">✗ {{ error }}</div>

      <template v-if="migration !== null">
        <div class="sumline">
          {{ t('sdiff.diffLabel') }}<b>{{ summary.added }}</b> {{ t('sdiff.added') }} · <b>{{ summary.changed }}</b> {{ t('sdiff.changed') }} ·
          <b>{{ summary.removed }}</b> {{ t('sdiff.removed') }}
          <span v-if="!diffs.length" class="ok">　{{ t('sdiff.identical') }}</span>
        </div>

        <div v-if="diffs.length" class="difflist">
          <div v-for="d in diffs" :key="d.table" class="drow">
            <span class="badge" :class="d.status">{{ t('sdiff.status.' + d.status) }}</span>
            <b>{{ d.table }}</b>
            <span v-if="d.columnChanges" class="cols">
              <span v-for="ch in d.columnChanges" :key="ch.column" class="cch" :class="ch.kind">
                {{ ch.kind === 'add' ? '+' : ch.kind === 'drop' ? '−' : '~' }}{{ ch.column }}
              </span>
            </span>
          </div>
        </div>

        <template v-if="migration">
          <div class="sql-head">
            <span>{{ t('sdiff.migSql') }}</span>
            <span class="grow" />
            <button @click="copySql">{{ t('common.copy') }}</button>
            <button class="primary" @click="openInQuery">{{ t('diff.openTarget') }}</button>
          </div>
          <pre class="sql">{{ migration }}</pre>
        </template>
      </template>
    </div>
  </Modal>
</template>

<style scoped>
.diff {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 640px;
  max-width: 86vw;
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
.side select,
.side input {
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
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.warn {
  font-size: 12px;
  color: #e0a020;
}
.sumline {
  font-size: 13px;
  color: var(--muted);
}
.sumline .ok {
  color: var(--ok, #4caf50);
}
.difflist {
  max-height: 180px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.drow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  flex-wrap: wrap;
}
.badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  color: #fff;
}
.badge.added {
  background: #4caf50;
}
.badge.changed {
  background: var(--accent, #7c6cff);
}
.badge.removed {
  background: #e0a020;
}
.cols {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.cch {
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.cch.add {
  color: #4caf50;
}
.cch.drop {
  color: var(--err, #e04050);
}
.cch.modify {
  color: var(--accent, #7c6cff);
}
.sql-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--muted);
}
.sql-head .grow {
  flex: 1;
}
.sql {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre-wrap;
}
.banner.err {
  color: var(--err, #e04050);
  font-size: 13px;
}
</style>
