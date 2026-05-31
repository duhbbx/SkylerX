<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Postgres 系高级管理面板:
 *  - Extensions:    pg_extension + pg_available_extensions,CREATE/DROP EXTENSION
 *  - Publications:  pg_publication / pg_publication_tables,CREATE PUBLICATION
 *  - Subscriptions: pg_subscription
 *  - Slots:         pg_replication_slots + DROP SLOT
 *
 * 适配方言:PostgreSQL / Kingbase / openGauss / Greenplum / CockroachDB / Redshift
 * (这些都走 pg 协议;部分系统表名一致,部分需要降级提示)
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { confirm as appConfirm, prompt as appPrompt, toast } from '../dialog'
import { reportError, reportInlineError } from '../errorReporter'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
  /** 当前选中的数据库(可选);某些查询带库上下文更准 */
  database?: string
}>()

const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

type Tab = 'extensions' | 'replication' | 'slots'
const tab = ref<Tab>('extensions')
const loading = ref(false)
const errMsg = ref<string | null>(null)

// Extensions
interface ExtRow {
  name: string
  installed_version: string | null
  default_version: string
  comment: string
}
const exts = ref<ExtRow[]>([])

// Publications + Subscriptions
interface PubRow {
  pubname: string
  pubowner: string
  puballtables: boolean
  pubinsert: boolean
  pubupdate: boolean
  pubdelete: boolean
  pubtruncate: boolean
}
interface SubRow {
  subname: string
  subowner: string
  subenabled: boolean
  subconninfo: string
  subpublications: string
}
const pubs = ref<PubRow[]>([])
const subs = ref<SubRow[]>([])

// Replication slots
interface SlotRow {
  slot_name: string
  plugin: string | null
  slot_type: string
  active: boolean
  database: string | null
  restart_lsn: string | null
  confirmed_flush_lsn: string | null
  wal_status: string | null
  safe_wal_size: string | null
}
const slots = ref<SlotRow[]>([])

async function execSql(sql: string): Promise<Record<string, unknown>[]> {
  const ctx = props.database ? { database: props.database } : {}
  const r = await client.connections.execute(props.conn.id, sql, [], ctx)
  return (r.rows as Record<string, unknown>[]) ?? []
}

async function loadExtensions(): Promise<void> {
  loading.value = true
  errMsg.value = null
  try {
    const rows = await execSql(`SELECT
        name, installed_version, default_version, comment
      FROM pg_available_extensions
      ORDER BY (installed_version IS NULL), name`)
    exts.value = rows.map((r) => ({
      name: String(r.name ?? ''),
      installed_version: r.installed_version == null ? null : String(r.installed_version),
      default_version: String(r.default_version ?? ''),
      comment: String(r.comment ?? ''),
    }))
  } catch (e) {
    reportInlineError(errMsg, e)
  } finally {
    loading.value = false
  }
}

async function createExtension(ext: ExtRow): Promise<void> {
  const schema = await appPrompt({
    message: '安装到哪个 schema?(留空 = public)',
    defaultValue: 'public',
  })
  if (schema === null) return
  const sql = schema.trim()
    ? `CREATE EXTENSION IF NOT EXISTS "${ext.name}" WITH SCHEMA "${schema.trim()}"`
    : `CREATE EXTENSION IF NOT EXISTS "${ext.name}"`
  try {
    await client.connections.execute(
      props.conn.id,
      sql,
      [],
      props.database ? { database: props.database } : {},
    )
    toast.success(`扩展 ${ext.name} 安装成功`)
    await loadExtensions()
  } catch (e) {
    reportError(e, { tag: 'pg-create-extension' })
  }
}

async function dropExtension(ext: ExtRow): Promise<void> {
  if (
    !(await appConfirm({
      message: `卸载扩展 "${ext.name}" ? 该操作会级联删除依赖该扩展的对象`,
      variant: 'danger',
    }))
  )
    return
  try {
    await client.connections.execute(
      props.conn.id,
      `DROP EXTENSION IF EXISTS "${ext.name}" CASCADE`,
      [],
      props.database ? { database: props.database } : {},
    )
    toast.success(`扩展 ${ext.name} 已卸载`)
    await loadExtensions()
  } catch (e) {
    reportError(e, { tag: 'pg-drop-extension' })
  }
}

async function loadReplication(): Promise<void> {
  loading.value = true
  errMsg.value = null
  try {
    const pubsRows = await execSql(`SELECT pubname, pubowner::regrole::text AS pubowner,
        puballtables, pubinsert, pubupdate, pubdelete, pubtruncate
      FROM pg_publication
      ORDER BY pubname`)
    pubs.value = pubsRows.map((r) => ({
      pubname: String(r.pubname ?? ''),
      pubowner: String(r.pubowner ?? ''),
      puballtables: Boolean(r.puballtables),
      pubinsert: Boolean(r.pubinsert),
      pubupdate: Boolean(r.pubupdate),
      pubdelete: Boolean(r.pubdelete),
      pubtruncate: Boolean(r.pubtruncate),
    }))
    try {
      const subRows = await execSql(`SELECT subname, subowner::regrole::text AS subowner,
          subenabled, subconninfo, array_to_string(subpublications, ',') AS subpublications
        FROM pg_subscription`)
      subs.value = subRows.map((r) => ({
        subname: String(r.subname ?? ''),
        subowner: String(r.subowner ?? ''),
        subenabled: Boolean(r.subenabled),
        subconninfo: String(r.subconninfo ?? ''),
        subpublications: String(r.subpublications ?? ''),
      }))
    } catch {
      // pg_subscription 需要 superuser 权限,失败则空
      subs.value = []
    }
  } catch (e) {
    reportInlineError(errMsg, e)
  } finally {
    loading.value = false
  }
}

async function createPublication(): Promise<void> {
  const name = await appPrompt({ message: '发布名称:', defaultValue: 'my_pub' })
  if (!name) return
  const tables = await appPrompt({
    message: '表(逗号分隔,留空 = FOR ALL TABLES):',
    defaultValue: '',
  })
  if (tables === null) return
  const sql = tables.trim()
    ? `CREATE PUBLICATION "${name}" FOR TABLE ${tables
        .split(',')
        .map((t) => `"${t.trim()}"`)
        .join(', ')}`
    : `CREATE PUBLICATION "${name}" FOR ALL TABLES`
  try {
    await client.connections.execute(
      props.conn.id,
      sql,
      [],
      props.database ? { database: props.database } : {},
    )
    toast.success(`发布 ${name} 已创建`)
    await loadReplication()
  } catch (e) {
    reportError(e)
  }
}

async function dropPublication(name: string): Promise<void> {
  if (!(await appConfirm({ message: `删除发布 "${name}" ?`, variant: 'danger' }))) return
  try {
    await client.connections.execute(
      props.conn.id,
      `DROP PUBLICATION IF EXISTS "${name}"`,
      [],
      props.database ? { database: props.database } : {},
    )
    toast.success('已删除')
    await loadReplication()
  } catch (e) {
    reportError(e)
  }
}

async function loadSlots(): Promise<void> {
  loading.value = true
  errMsg.value = null
  try {
    const rows = await execSql(`SELECT
        slot_name, plugin, slot_type, active, database,
        restart_lsn::text, confirmed_flush_lsn::text,
        wal_status, safe_wal_size::text
      FROM pg_replication_slots
      ORDER BY slot_name`)
    slots.value = rows.map((r) => ({
      slot_name: String(r.slot_name ?? ''),
      plugin: r.plugin == null ? null : String(r.plugin),
      slot_type: String(r.slot_type ?? ''),
      active: Boolean(r.active),
      database: r.database == null ? null : String(r.database),
      restart_lsn: r.restart_lsn == null ? null : String(r.restart_lsn),
      confirmed_flush_lsn: r.confirmed_flush_lsn == null ? null : String(r.confirmed_flush_lsn),
      wal_status: r.wal_status == null ? null : String(r.wal_status),
      safe_wal_size: r.safe_wal_size == null ? null : String(r.safe_wal_size),
    }))
  } catch (e) {
    reportInlineError(errMsg, e)
  } finally {
    loading.value = false
  }
}

async function dropSlot(name: string): Promise<void> {
  if (
    !(await appConfirm({
      message: `删除复制槽 "${name}" ?\n非 active 槽才能删,active 槽请先解除订阅`,
      variant: 'danger',
    }))
  )
    return
  try {
    await client.connections.execute(
      props.conn.id,
      `SELECT pg_drop_replication_slot('${name}')`,
      [],
      props.database ? { database: props.database } : {},
    )
    toast.success(`已删除 ${name}`)
    await loadSlots()
  } catch (e) {
    reportError(e)
  }
}

async function refresh(): Promise<void> {
  if (tab.value === 'extensions') await loadExtensions()
  else if (tab.value === 'replication') await loadReplication()
  else await loadSlots()
}

watch(tab, refresh)
watch(
  () => props.open,
  async (op) => {
    if (op) {
      tab.value = 'extensions'
      await refresh()
    }
  },
)
</script>

<template>
  <Modal v-if="open" :title="`PG 高级  ·  ${conn.name || conn.dialect}${database ? ` / ${database}` : ''}`" width="xl" fixed-height storage-key="pg-advanced" @close="emit('close')">
    <div class="tabs">
      <button :class="{ on: tab === 'extensions' }" @click="tab = 'extensions'">扩展</button>
      <button :class="{ on: tab === 'replication' }" @click="tab = 'replication'">逻辑复制</button>
      <button :class="{ on: tab === 'slots' }" @click="tab = 'slots'">复制槽</button>
      <span class="spacer" />
      <button class="btn" :disabled="loading" @click="refresh">🔄 刷新</button>
    </div>

    <div class="body">
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="errMsg" class="err-banner">✗ {{ errMsg }}</div>

      <!-- Extensions -->
      <template v-else-if="tab === 'extensions'">
        <table class="grid">
          <thead><tr><th>名称</th><th style="width: 90px">已装版本</th><th style="width: 90px">最新版本</th><th>描述</th><th style="width: 120px"></th></tr></thead>
          <tbody>
            <tr v-for="ext in exts" :key="ext.name" :class="{ installed: ext.installed_version }">
              <td class="mono">{{ ext.name }}</td>
              <td>{{ ext.installed_version ?? '—' }}</td>
              <td>{{ ext.default_version }}</td>
              <td class="comment">{{ ext.comment }}</td>
              <td>
                <button v-if="!ext.installed_version" class="mini-btn primary" @click="createExtension(ext)">安装</button>
                <button v-else class="mini-btn danger" @click="dropExtension(ext)">卸载</button>
              </td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- Replication -->
      <template v-else-if="tab === 'replication'">
        <div class="sub-head">
          <span class="lbl">发布 (Publications) — {{ pubs.length }}</span>
          <button class="mini-btn primary" @click="createPublication">+ 新建</button>
        </div>
        <table class="grid">
          <thead><tr><th>名称</th><th>owner</th><th style="width: 70px">all tbls</th><th style="width: 110px">操作</th><th style="width: 50px"></th></tr></thead>
          <tbody>
            <tr v-for="p in pubs" :key="p.pubname">
              <td class="mono">{{ p.pubname }}</td>
              <td>{{ p.pubowner }}</td>
              <td>{{ p.puballtables ? '✓' : '' }}</td>
              <td>
                <span v-if="p.pubinsert" class="mini-tag">INSERT</span>
                <span v-if="p.pubupdate" class="mini-tag">UPDATE</span>
                <span v-if="p.pubdelete" class="mini-tag">DELETE</span>
                <span v-if="p.pubtruncate" class="mini-tag">TRUNCATE</span>
              </td>
              <td><button class="mini-btn danger" @click="dropPublication(p.pubname)">✕</button></td>
            </tr>
            <tr v-if="!pubs.length"><td colspan="5" class="empty-row">无</td></tr>
          </tbody>
        </table>

        <div class="sub-head">
          <span class="lbl">订阅 (Subscriptions) — {{ subs.length }}</span>
        </div>
        <table class="grid">
          <thead><tr><th>名称</th><th>owner</th><th style="width: 70px">enabled</th><th>conninfo</th><th>publications</th></tr></thead>
          <tbody>
            <tr v-for="s in subs" :key="s.subname">
              <td class="mono">{{ s.subname }}</td>
              <td>{{ s.subowner }}</td>
              <td>{{ s.subenabled ? '✓' : '✗' }}</td>
              <td class="mono">{{ s.subconninfo }}</td>
              <td class="mono">{{ s.subpublications }}</td>
            </tr>
            <tr v-if="!subs.length"><td colspan="5" class="empty-row">无(可能需要 superuser 权限)</td></tr>
          </tbody>
        </table>
      </template>

      <!-- Slots -->
      <template v-else-if="tab === 'slots'">
        <table class="grid">
          <thead><tr><th>slot_name</th><th>type</th><th>plugin</th><th>db</th><th style="width: 60px">active</th><th>wal_status</th><th>restart_lsn</th><th style="width: 50px"></th></tr></thead>
          <tbody>
            <tr v-for="s in slots" :key="s.slot_name" :class="{ active: s.active, inactive: !s.active }">
              <td class="mono">{{ s.slot_name }}</td>
              <td>{{ s.slot_type }}</td>
              <td>{{ s.plugin ?? '—' }}</td>
              <td>{{ s.database ?? '—' }}</td>
              <td>{{ s.active ? '✓' : '✗' }}</td>
              <td>{{ s.wal_status ?? '—' }}</td>
              <td class="mono">{{ s.restart_lsn ?? '—' }}</td>
              <td><button class="mini-btn danger" :disabled="s.active" @click="dropSlot(s.slot_name)">✕</button></td>
            </tr>
            <tr v-if="!slots.length"><td colspan="8" class="empty-row">无</td></tr>
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
.tabs { display: flex; gap: 4px; padding: 0 0 8px; border-bottom: 1px solid var(--border); margin-bottom: 8px; align-items: center; }
.tabs button { background: transparent; border: 1px solid transparent; color: var(--muted); padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.tabs button.on { background: rgba(124, 108, 255, 0.18); border-color: var(--accent); color: var(--text); }
.spacer { flex: 1; }
.btn, .btn-ghost { padding: 4px 12px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 12px; background: var(--bg); color: var(--text); }
.btn-ghost { background: transparent; color: var(--muted); padding: 6px 14px; font-size: 13px; }
.body { flex: 1; overflow: auto; max-height: 65vh; }
.empty { padding: 30px; text-align: center; color: var(--muted); }
.err-banner { padding: 10px; background: rgba(224, 64, 80, 0.08); border: 1px solid rgba(224, 64, 80, 0.4); border-radius: 6px; color: var(--err, #e04050); font-size: 12px; }
.grid { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 12px; }
.grid th, .grid td { border-bottom: 1px solid var(--border); padding: 4px 8px; text-align: left; vertical-align: top; }
.grid th { background: var(--panel); color: var(--muted); position: sticky; top: 0; }
.mono { font-family: var(--font-mono); word-break: break-all; }
.comment { color: var(--muted); font-size: 11px; }
tr.installed { background: rgba(76, 175, 80, 0.06); }
tr.inactive td { color: var(--muted); }
.empty-row { text-align: center; color: var(--muted); font-style: italic; }
.mini-btn { padding: 2px 8px; font-size: 11px; border: 1px solid var(--border); border-radius: 3px; cursor: pointer; background: var(--bg); color: var(--text); }
.mini-btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.mini-btn.danger { color: #e04050; border-color: rgba(224, 64, 80, 0.4); }
.mini-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.mini-tag { display: inline-block; padding: 0 4px; margin-right: 2px; font-size: 9px; border-radius: 2px; background: rgba(124, 108, 255, 0.18); color: var(--text); font-family: var(--font-mono); }
.sub-head { display: flex; align-items: center; justify-content: space-between; padding: 4px 0 6px; }
.lbl { font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; }
</style>
