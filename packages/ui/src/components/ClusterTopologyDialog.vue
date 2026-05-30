<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 分布式数据库集群拓扑 + Region 分布(TiDB / OceanBase 通用)。
 *
 * TiDB:
 *   - cluster_info → 节点列表(tidb / tikv / pd / tiflash)
 *   - tikv_store_status → store 状态 + region count
 *   - tikv_region_status → region 列表(可按 table 过滤)
 *   - tikv_region_peers → leader/follower
 *
 * OceanBase:
 *   - DBA_OB_SERVERS → observer 节点
 *   - DBA_OB_ZONES → zone 状态
 *   - DBA_OB_TENANTS → 租户
 *   - GV$OB_TABLET_TO_LS / __all_virtual_meta_table → 分区分布(权限敏感,失败给提示)
 */
import { type ConnectionConfig, DbDialect } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
}>()

const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

type Tab = 'nodes' | 'regions'
const tab = ref<Tab>('nodes')
const loading = ref(false)
const errMsg = ref<string | null>(null)

const nodeRows = ref<Record<string, unknown>[]>([])
const regionRows = ref<Record<string, unknown>[]>([])

const family = computed<'tidb' | 'oceanbase' | 'other'>(() => {
  if (props.conn.dialect === DbDialect.TiDB) return 'tidb'
  if (props.conn.dialect === DbDialect.OceanBase) return 'oceanbase'
  return 'other'
})

async function execSql(sql: string): Promise<Record<string, unknown>[]> {
  const r = await client.connections.execute(props.conn.id, sql, [], {})
  return (r.rows as Record<string, unknown>[]) ?? []
}

async function loadNodes(): Promise<void> {
  loading.value = true
  errMsg.value = null
  try {
    if (family.value === 'tidb') {
      nodeRows.value = await execSql(`SELECT
          type, instance, status_address, version, git_hash, start_time, uptime
        FROM information_schema.cluster_info
        ORDER BY type, instance`)
    } else if (family.value === 'oceanbase') {
      nodeRows.value = await execSql(`SELECT
          svr_ip, svr_port, zone, status, with_rootserver, build_version, start_service_time
        FROM oceanbase.DBA_OB_SERVERS
        ORDER BY zone, svr_ip`)
    } else {
      errMsg.value = '该方言不支持集群拓扑视图'
    }
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function loadRegions(): Promise<void> {
  loading.value = true
  errMsg.value = null
  try {
    if (family.value === 'tidb') {
      regionRows.value = await execSql(`SELECT
          store_id, address, store_state_name, capacity, available,
          leader_count, region_count, version
        FROM information_schema.tikv_store_status
        ORDER BY store_id`)
    } else if (family.value === 'oceanbase') {
      // GV$OB_TABLET_TO_LS 多数版本可用;失败 fallback
      try {
        regionRows.value = await execSql(`SELECT
            tenant_id, tablet_id, ls_id, table_id, role, svr_ip
          FROM oceanbase.GV$OB_TABLET_TO_LS
          LIMIT 200`)
      } catch {
        regionRows.value = await execSql(`SELECT
            unit_id, resource_pool_id, unit_group_id, tenant_id, zone, svr_ip, svr_port, status
          FROM oceanbase.DBA_OB_UNITS
          ORDER BY zone, svr_ip`)
      }
    } else {
      errMsg.value = '该方言不支持 Region 视图'
    }
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function refresh(): Promise<void> {
  if (tab.value === 'nodes') await loadNodes()
  else await loadRegions()
}

function columnsOf(rows: Record<string, unknown>[]): string[] {
  const s = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) s.add(k)
  return [...s]
}

watch(tab, refresh)
watch(
  () => props.open,
  async (op) => {
    if (op) {
      tab.value = 'nodes'
      await refresh()
    }
  },
)

function fmtBytes(v: unknown): string {
  if (v == null) return ''
  // TiKV store status 的 capacity/available 已经是字节字符串(可能带单位)
  const n = typeof v === 'string' ? Number(v) : (v as number)
  if (!Number.isFinite(n)) return String(v)
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  if (n < 1024 * 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
  return `${(n / 1024 / 1024 / 1024 / 1024).toFixed(2)} TB`
}

function renderCell(col: string, v: unknown): string {
  if (v == null) return ''
  if (/capacity|available|size$/i.test(col)) return fmtBytes(v)
  return String(v)
}
</script>

<template>
  <Modal v-if="open" :title="`集群拓扑  ·  ${conn.name || conn.dialect} (${family})`" width="xl" fixed-height storage-key="cluster-topo" @close="emit('close')">
    <div class="tabs">
      <button :class="{ on: tab === 'nodes' }" @click="tab = 'nodes'">节点</button>
      <button :class="{ on: tab === 'regions' }" @click="tab = 'regions'">{{ family === 'tidb' ? 'TiKV Stores' : 'Region/Tablet' }}</button>
      <span class="spacer" />
      <button class="btn" :disabled="loading" @click="refresh">🔄 刷新</button>
    </div>

    <div class="body">
      <div v-if="loading" class="empty">加载中…</div>
      <div v-else-if="errMsg" class="err-banner">✗ {{ errMsg }}</div>
      <template v-else>
        <table class="grid">
          <thead>
            <tr>
              <th v-for="c in columnsOf(tab === 'nodes' ? nodeRows : regionRows)" :key="c">{{ c }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in (tab === 'nodes' ? nodeRows : regionRows)" :key="i">
              <td v-for="c in columnsOf(tab === 'nodes' ? nodeRows : regionRows)" :key="c" class="mono">
                {{ renderCell(c, r[c]) }}
              </td>
            </tr>
            <tr v-if="!(tab === 'nodes' ? nodeRows : regionRows).length"><td class="empty-row">无数据</td></tr>
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
.grid { width: 100%; border-collapse: collapse; font-size: 12px; }
.grid th, .grid td { border-bottom: 1px solid var(--border); padding: 4px 8px; text-align: left; }
.grid th { background: var(--panel); color: var(--muted); position: sticky; top: 0; }
.mono { font-family: var(--font-mono); word-break: break-all; }
.empty-row { text-align: center; color: var(--muted); font-style: italic; }
</style>
