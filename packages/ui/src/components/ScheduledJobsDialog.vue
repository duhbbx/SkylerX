<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 定时任务 / 调度作业管理 —— DBA 浏览 + 启停 + 删除 DB 侧调度任务。
 *
 *   - MySQL 系   : information_schema.EVENTS（CREATE EVENT；需 event_scheduler=ON）
 *   - PostgreSQL : cron.job（pg_cron 扩展）
 *   - Oracle / DM: all_scheduler_jobs（DBMS_SCHEDULER）
 *   - SQL Server : msdb..sysjobs（SQL Server Agent，Express 版不含）
 *
 * 自带连接选择；每行可启用/禁用/删除；顶部「复制 CREATE 模板」给个对应方言的骨架。
 */
import { type ConnectionConfig, type QueryResult } from '@db-tool/shared-types'
import { computed, onMounted, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { familyOf } from '../ddl'
import { confirm as appConfirm, toast } from '../dialog'
import { reportError, reportInlineError } from '../errorReporter'
import { locale, t } from '../i18n'
import Modal from './Modal.vue'

const emit = defineEmits<{ close: [] }>()
const client = useDataClient()
const L = (zh: string, en: string): string => (locale.value === 'en' ? en : zh)

const conns = ref<ConnectionConfig[]>([])
const connId = ref('')
const conn = computed(() => conns.value.find((c) => c.id === connId.value))
const result = ref<QueryResult | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

type Fam = 'mysql' | 'pg' | 'oracle' | 'sqlserver'
type Row = Record<string, unknown>
function famOf(): Fam | null {
  const d = conn.value?.dialect
  if (!d) return null
  return familyOf(d)
}

interface Adapter {
  listSql: string
  /** 该方言需要的前置条件提示（扩展 / Agent / 调度器开关） */
  hint: string
  /** 行显示名 */
  label(row: Row): string
  /** 是否启用（null = 无启停概念） */
  enabled(row: Row): boolean | null
  enableSql(row: Row): string | null
  disableSql(row: Row): string | null
  dropSql(row: Row): string
  /** CREATE 骨架（复制到剪贴板，用户去 SQL 编辑器改） */
  template: string
}

const q = (s: unknown): string => `'${String(s ?? '').replace(/'/g, "''")}'`

const ADAPTERS: Record<Fam, Adapter> = {
  mysql: {
    listSql: `SELECT EVENT_SCHEMA AS db, EVENT_NAME AS name, STATUS AS status,
        TRIM(CONCAT_WS(' ', 'EVERY', INTERVAL_VALUE, INTERVAL_FIELD)) AS schedule,
        EXECUTE_AT AS exec_at, STARTS AS starts, ENDS AS ends, LAST_EXECUTED AS last_run
      FROM information_schema.EVENTS ORDER BY EVENT_SCHEMA, EVENT_NAME`,
    hint: '需开启事件调度器：SET GLOBAL event_scheduler = ON;',
    label: (r) => `${r.db}.${r.name}`,
    enabled: (r) => String(r.status).toUpperCase() === 'ENABLED',
    enableSql: (r) => `ALTER EVENT \`${r.db}\`.\`${r.name}\` ENABLE`,
    disableSql: (r) => `ALTER EVENT \`${r.db}\`.\`${r.name}\` DISABLE`,
    dropSql: (r) => `DROP EVENT \`${r.db}\`.\`${r.name}\``,
    template: `CREATE EVENT my_event
  ON SCHEDULE EVERY 1 DAY STARTS CURRENT_TIMESTAMP
  DO
    DELETE FROM my_log WHERE created_at < NOW() - INTERVAL 30 DAY;`,
  },
  pg: {
    listSql: `SELECT jobid, jobname, schedule, command, database, username, active
      FROM cron.job ORDER BY jobid`,
    hint: '需安装 pg_cron 扩展：CREATE EXTENSION pg_cron;',
    label: (r) => String(r.jobname || `job ${r.jobid}`),
    enabled: (r) => r.active === true || String(r.active) === 't' || String(r.active) === 'true',
    enableSql: (r) => `SELECT cron.alter_job(${Number(r.jobid)}, active := true)`,
    disableSql: (r) => `SELECT cron.alter_job(${Number(r.jobid)}, active := false)`,
    dropSql: (r) => `SELECT cron.unschedule(${Number(r.jobid)})`,
    template: `SELECT cron.schedule('nightly-cleanup', '0 3 * * *',
  $$DELETE FROM my_log WHERE created_at < now() - interval '30 days'$$);`,
  },
  oracle: {
    listSql: `SELECT owner, job_name, enabled, state, repeat_interval, next_run_date, last_start_date
      FROM all_scheduler_jobs ORDER BY owner, job_name`,
    hint: 'DBMS_SCHEDULER（Oracle / DM 通用）。',
    label: (r) => `${r.owner}.${r.job_name}`,
    enabled: (r) => String(r.enabled).toUpperCase() === 'TRUE',
    enableSql: (r) => `BEGIN DBMS_SCHEDULER.ENABLE(${q(`${r.owner}.${r.job_name}`)}); END;`,
    disableSql: (r) => `BEGIN DBMS_SCHEDULER.DISABLE(${q(`${r.owner}.${r.job_name}`)}); END;`,
    dropSql: (r) =>
      `BEGIN DBMS_SCHEDULER.DROP_JOB(job_name => ${q(`${r.owner}.${r.job_name}`)}, force => TRUE); END;`,
    template: `BEGIN
  DBMS_SCHEDULER.CREATE_JOB(
    job_name        => 'MY_JOB',
    job_type        => 'PLSQL_BLOCK',
    job_action      => 'BEGIN DELETE FROM my_log WHERE created_at < SYSDATE - 30; END;',
    repeat_interval => 'FREQ=DAILY; BYHOUR=3',
    enabled         => TRUE);
END;`,
  },
  sqlserver: {
    listSql: `SELECT j.name, j.enabled,
        CONVERT(varchar, msdb.dbo.agent_datetime(s.next_run_date, s.next_run_time), 120) AS next_run,
        s.freq_type
      FROM msdb.dbo.sysjobs j
      LEFT JOIN msdb.dbo.sysjobschedules js ON js.job_id = j.job_id
      LEFT JOIN msdb.dbo.sysschedules s ON s.schedule_id = js.schedule_id
      ORDER BY j.name`,
    hint: '需 SQL Server Agent（Express 版不含）。',
    label: (r) => String(r.name),
    enabled: (r) => Number(r.enabled) === 1,
    enableSql: (r) => `EXEC msdb.dbo.sp_update_job @job_name = N${q(r.name)}, @enabled = 1`,
    disableSql: (r) => `EXEC msdb.dbo.sp_update_job @job_name = N${q(r.name)}, @enabled = 0`,
    dropSql: (r) => `EXEC msdb.dbo.sp_delete_job @job_name = N${q(r.name)}`,
    template: `EXEC msdb.dbo.sp_add_job @job_name = N'my_job';
-- then sp_add_jobstep / sp_add_schedule / sp_attach_schedule / sp_add_jobserver`,
  },
}

const adapter = computed<Adapter | null>(() => {
  const f = famOf()
  return f ? ADAPTERS[f] : null
})
const rows = computed<Row[]>(() => (result.value?.rows as Row[]) ?? [])

async function load(): Promise<void> {
  const a = adapter.value
  if (!conn.value || !a) {
    result.value = null
    return
  }
  loading.value = true
  error.value = null
  try {
    result.value = await client.connections.execute(conn.value.id, a.listSql)
  } catch (e) {
    reportInlineError(error, e)
    result.value = null
  } finally {
    loading.value = false
  }
}

async function runAction(sql: string | null, okMsg: string): Promise<void> {
  if (!sql || !conn.value) return
  try {
    await client.connections.execute(conn.value.id, sql)
    toast.success(okMsg)
    await load()
  } catch (e) {
    reportError(e, { tag: 'jobs.action' })
  }
}

async function toggle(row: Row): Promise<void> {
  const a = adapter.value
  if (!a) return
  const on = a.enabled(row)
  await runAction(
    on ? a.disableSql(row) : a.enableSql(row),
    on ? L('已禁用', 'Disabled') : L('已启用', 'Enabled'),
  )
}

async function drop(row: Row): Promise<void> {
  const a = adapter.value
  if (!a) return
  if (
    !(await appConfirm({
      title: L('删除定时任务', 'Drop scheduled job'),
      message: L(`确认删除 ${a.label(row)} ？`, `Drop ${a.label(row)}?`),
      variant: 'danger',
    }))
  )
    return
  await runAction(a.dropSql(row), L('已删除', 'Dropped'))
}

function copyTemplate(): void {
  const a = adapter.value
  if (!a) return
  void navigator.clipboard?.writeText(a.template)
  toast.success(L('CREATE 模板已复制，去 SQL 编辑器改吧', 'CREATE template copied to clipboard'))
}

watch(connId, () => {
  result.value = null
  error.value = null
  void load()
})
onMounted(async () => {
  conns.value = await client.connections.list()
})
</script>

<template>
  <Modal :title="t('jobs.title')" width="wide" @close="emit('close')">
    <div class="jobs">
      <div class="bar">
        <select v-model="connId" class="conn-sel">
          <option value="" disabled>{{ t('diff.selectConn') }}</option>
          <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name || c.id }} · {{ c.dialect }}</option>
        </select>
        <span class="sp" />
        <button v-if="adapter" class="ghost sm" @click="copyTemplate">{{ t('jobs.copyTemplate') }}</button>
        <button v-if="conn" class="ghost sm" :disabled="loading" @click="load">{{ loading ? '…' : t('activity.refresh') }}</button>
      </div>

      <div v-if="!conn" class="empty">{{ t('jobs.pickConn') }}</div>
      <template v-else>
        <p v-if="adapter" class="hint">ℹ {{ adapter.hint }}</p>
        <div v-if="error" class="err">✗ {{ error }}</div>
        <div v-else-if="!rows.length" class="empty">{{ loading ? t('activity.loading') : t('jobs.none') }}</div>
        <div v-else class="tbl-wrap">
          <table class="jtbl">
            <thead>
              <tr>
                <th v-for="col in result!.columns" :key="col.name">{{ col.name }}</th>
                <th class="op">{{ t('activity.op') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in rows" :key="i">
                <td v-for="col in result!.columns" :key="col.name" :title="String(row[col.name] ?? '')">
                  {{ row[col.name] == null ? 'NULL' : String(row[col.name]).slice(0, 200) }}
                </td>
                <td class="op">
                  <button
                    v-if="adapter && adapter.enabled(row) !== null"
                    class="act"
                    @click="toggle(row)"
                  >{{ adapter.enabled(row) ? t('jobs.disable') : t('jobs.enable') }}</button>
                  <button class="act drop" @click="drop(row)">{{ t('jobs.drop') }}</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </Modal>
</template>

<style scoped>
.jobs { display: flex; flex-direction: column; min-width: 820px; min-height: 440px; max-height: 70vh; }
.bar { display: flex; align-items: center; gap: 8px; padding-bottom: 8px; }
.bar .sp { flex: 1; }
.conn-sel { flex: 0 1 360px; padding: 6px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); }
.ghost.sm { padding: 4px 12px; font-size: 12px; }
.hint { font-size: 12px; color: var(--muted); margin: 0 0 8px; }
.err { padding: 16px; color: var(--err, #e04050); font-family: var(--font-mono); font-size: 12px; white-space: pre-wrap; }
.empty { padding: 24px; color: var(--muted); text-align: center; }
.tbl-wrap { flex: 1; overflow: auto; }
.jtbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.jtbl th, .jtbl td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); }
.jtbl th { background: var(--panel); font-weight: 600; position: sticky; top: 0; }
.jtbl td.op { white-space: nowrap; }
.act { padding: 2px 8px; font-size: 11px; background: transparent; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; color: var(--text); margin-right: 4px; }
.act:hover { background: rgba(124, 108, 255, 0.12); }
.act.drop { color: var(--err, #e04050); border-color: var(--err, #e04050); }
.act.drop:hover { background: rgba(224, 64, 80, 0.14); }
</style>
