<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * OceanBase 集群拓扑面板（信创差异化能力）—— Navicat / DBeaver / DataGrip 都没有。
 *
 * 信创 / 国产化客户买点：一眼看清整个 OB 集群的 zone / observer / tenant / unit 分布，
 * 以及租户和资源池的位置关系。所有数据都从官方 OBSERVER 视图查：
 *   - oceanbase.DBA_OB_ZONES     → zone 列表 + 状态
 *   - oceanbase.DBA_OB_SERVERS   → observer 节点（绑 zone）
 *   - oceanbase.DBA_OB_TENANTS   → 租户（sys / META$xxx / 业务）
 *   - oceanbase.DBA_OB_UNITS     → 资源单元（绑 tenant + zone + svr）
 *
 * UI 结构：顶部 4 张计数卡 + 左侧 Zone→Server 树 + 右侧 Tenant 列表（点开看 Unit 分布）。
 * 仅在连接方言为 OceanBase 时入口可见（Workspace 命令面板里过滤）。
 */
import type { ConnectionConfig } from '@db-tool/shared-types'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import { reportError, reportInlineError } from '../errorReporter'
import { t } from '../i18n'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig }>()
const emit = defineEmits<{ close: [] }>()
const client = useDataClient()

interface ZoneRow {
  zone: string
  status: string
  idc?: string
  region?: string
}
interface ServerRow {
  svr_ip: string
  svr_port: number
  zone: string
  status: string
  with_rootserver?: string
  build_version?: string
  start_service_time?: string
}
interface TenantRow {
  tenant_id: number
  tenant_name: string
  tenant_type: string
  primary_zone?: string
  compatibility_mode?: string
  status: string
  locked?: string
  locality?: string
}
interface UnitRow {
  unit_id: number
  resource_pool_id: number
  unit_group_id?: number
  tenant_id: number
  zone: string
  svr_ip: string
  svr_port: number
  status: string
}

const zones = ref<ZoneRow[]>([])
const servers = ref<ServerRow[]>([])
const tenants = ref<TenantRow[]>([])
const units = ref<UnitRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const expandedTenant = ref<number | null>(null)
const refreshIntervalSec = ref<0 | 5 | 10 | 30>(0)
let refreshTimer: ReturnType<typeof setInterval> | null = null

/**
 * 拉一份完整集群拓扑：4 张视图并发查。失败时整面板红色 banner，但保留上一次成功的数据，
 * 避免「刷新一抖整页空白」的体验断层。
 */
async function refresh(): Promise<void> {
  loading.value = true
  try {
    const [z, s, te, u] = await Promise.all([
      client.connections.execute(
        props.conn.id,
        'SELECT zone, status, idc, region FROM oceanbase.DBA_OB_ZONES ORDER BY zone',
      ),
      client.connections.execute(
        props.conn.id,
        `SELECT svr_ip, svr_port, zone, status, with_rootserver, build_version, start_service_time
           FROM oceanbase.DBA_OB_SERVERS ORDER BY zone, svr_ip`,
      ),
      client.connections.execute(
        props.conn.id,
        `SELECT tenant_id, tenant_name, tenant_type, primary_zone, compatibility_mode, status, locked, locality
           FROM oceanbase.DBA_OB_TENANTS ORDER BY tenant_id`,
      ),
      // OB 4.x DBA_OB_UNITS 没有 replica_type；用 UNIT_GROUP_ID 标识副本组归属
      client.connections.execute(
        props.conn.id,
        `SELECT unit_id, resource_pool_id, unit_group_id, tenant_id, zone, svr_ip, svr_port, status
           FROM oceanbase.DBA_OB_UNITS ORDER BY tenant_id, zone, svr_ip`,
      ),
    ])
    zones.value = (z.rows ?? []) as unknown as ZoneRow[]
    servers.value = (s.rows ?? []) as unknown as ServerRow[]
    tenants.value = (te.rows ?? []) as unknown as TenantRow[]
    units.value = (u.rows ?? []) as unknown as UnitRow[]
    error.value = null
  } catch (e) {
    reportInlineError(error, e)
  } finally {
    loading.value = false
  }
}

/** 用户手动改自动刷新间隔；0 表示关闭。每次切换重置定时器。 */
function applyAutoRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  if (refreshIntervalSec.value > 0) {
    refreshTimer = setInterval(() => void refresh(), refreshIntervalSec.value * 1000)
  }
}

onMounted(() => void refresh())
onBeforeUnmount(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})

/** Zone → 该 zone 下的 server 列表（按 zone 名分组）。 */
function serversIn(zone: string): ServerRow[] {
  return servers.value.filter((s) => s.zone === zone)
}

/** Tenant → 该租户拥有的 unit 列表（按 zone 内自然顺序）。 */
function unitsOf(tenantId: number): UnitRow[] {
  return units.value.filter((u) => u.tenant_id === tenantId)
}

/** Tenant → 在哪些 zone 上铺了 unit（去重，用于一行小芯片展示）。 */
function tenantZones(tenantId: number): string[] {
  return [...new Set(unitsOf(tenantId).map((u) => u.zone))]
}

function statusClass(s: string): string {
  const v = (s || '').toUpperCase()
  if (v === 'ACTIVE' || v === 'NORMAL') return 'st-ok'
  if (v === 'INACTIVE' || v === 'OFFLINE' || v === 'DELETING') return 'st-bad'
  return 'st-warn'
}

function tenantTypeIcon(t: string): string {
  const v = (t || '').toUpperCase()
  if (v === 'SYS') return '👑'
  if (v === 'META') return '⚙'
  return '🏢' // USER
}

/** 一键复制 server 的「IP:PORT」给同事粘 obclient 用。 */
async function copyAddr(svr: ServerRow): Promise<void> {
  const addr = `${svr.svr_ip}:${svr.svr_port}`
  try {
    await navigator.clipboard.writeText(addr)
    toast.success(t('obtopo.copied', { addr }))
  } catch {
    reportError(new Error(t('obtopo.copyFail')))
  }
}
</script>

<template>
  <Modal
    :title="`${t('obtopo.title')} · ${conn.name || conn.dialect}`"
    width="xl"
    fixed-height
    storage-key="ob-topology"
    @close="emit('close')"
  >
    <div class="topo">
      <!-- 顶部工具栏 -->
      <div class="bar">
        <button class="btn" :disabled="loading" @click="refresh">
          {{ loading ? t('obtopo.loading') : t('obtopo.refresh') }}
        </button>
        <label class="auto-refresh">
          {{ t('obtopo.autoRefresh') }}
          <select v-model.number="refreshIntervalSec" @change="applyAutoRefresh">
            <option :value="0">{{ t('obtopo.off') }}</option>
            <option :value="5">5s</option>
            <option :value="10">10s</option>
            <option :value="30">30s</option>
          </select>
        </label>
        <span class="muted spacer" />
      </div>

      <!-- 错误 banner -->
      <div v-if="error" class="err">⚠ {{ error }}</div>

      <!-- 顶部计数卡 -->
      <div class="cards">
        <div class="card">
          <div class="lbl">{{ t('obtopo.zones') }}</div>
          <div class="num">{{ zones.length }}</div>
        </div>
        <div class="card">
          <div class="lbl">{{ t('obtopo.servers') }}</div>
          <div class="num">{{ servers.length }}</div>
        </div>
        <div class="card">
          <div class="lbl">{{ t('obtopo.tenants') }}</div>
          <div class="num">{{ tenants.length }}</div>
        </div>
        <div class="card">
          <div class="lbl">{{ t('obtopo.units') }}</div>
          <div class="num">{{ units.length }}</div>
        </div>
      </div>

      <!-- 主体：左 zone→server，右 tenant→unit -->
      <div class="body">
        <!-- 左：Zone → Server 树 -->
        <div class="col col-left">
          <div class="col-head">{{ t('obtopo.zoneTree') }}</div>
          <div class="col-body">
            <div v-for="z in zones" :key="z.zone" class="zone-block">
              <div class="zone-head">
                <span class="z-icon">🌐</span>
                <span class="z-name">{{ z.zone }}</span>
                <span class="z-meta" v-if="z.idc">IDC: {{ z.idc }}</span>
                <span class="z-meta" v-if="z.region">Region: {{ z.region }}</span>
                <span class="badge" :class="statusClass(z.status)">{{ z.status }}</span>
              </div>
              <div v-if="serversIn(z.zone).length === 0" class="empty">
                {{ t('obtopo.noServer') }}
              </div>
              <div v-for="s in serversIn(z.zone)" :key="`${s.svr_ip}:${s.svr_port}`" class="svr">
                <span class="s-icon">{{ s.with_rootserver === 'YES' ? '⭐' : '🖥' }}</span>
                <span class="s-addr" :title="t('obtopo.copyAddrTip')" @click="copyAddr(s)">
                  {{ s.svr_ip }}:{{ s.svr_port }}
                </span>
                <span class="s-meta" v-if="s.build_version">
                  v{{ s.build_version.split('_')[0] }}
                </span>
                <span class="badge" :class="statusClass(s.status)">{{ s.status }}</span>
              </div>
            </div>
            <div v-if="!zones.length && !loading" class="empty">{{ t('obtopo.noZone') }}</div>
          </div>
        </div>

        <!-- 右：Tenant 列表（点开看 Unit 分布） -->
        <div class="col col-right">
          <div class="col-head">{{ t('obtopo.tenantList') }}</div>
          <div class="col-body">
            <div v-for="te in tenants" :key="te.tenant_id" class="tenant">
              <div
                class="tenant-row"
                @click="expandedTenant = expandedTenant === te.tenant_id ? null : te.tenant_id"
              >
                <span class="arrow">{{ expandedTenant === te.tenant_id ? '▾' : '▸' }}</span>
                <span class="t-icon">{{ tenantTypeIcon(te.tenant_type) }}</span>
                <span class="t-name">{{ te.tenant_name }}</span>
                <span class="t-id">#{{ te.tenant_id }}</span>
                <span class="t-meta" v-if="te.compatibility_mode">
                  {{ te.compatibility_mode }}
                </span>
                <span class="t-meta locality" v-if="te.locality" :title="te.locality">
                  {{ te.locality.length > 30 ? `${te.locality.slice(0, 30)}…` : te.locality }}
                </span>
                <span class="t-zones">
                  <span v-for="z in tenantZones(te.tenant_id)" :key="z" class="z-chip">{{ z }}</span>
                </span>
                <span class="badge" :class="statusClass(te.status)">{{ te.status }}</span>
              </div>
              <!-- 展开后：该 tenant 拥有的 unit 列表 -->
              <div v-if="expandedTenant === te.tenant_id" class="units">
                <div v-for="u in unitsOf(te.tenant_id)" :key="u.unit_id" class="unit">
                  <span class="u-id">unit-{{ u.unit_id }}</span>
                  <span class="u-pool">pool {{ u.resource_pool_id }}</span>
                  <span class="u-loc">{{ u.zone }} / {{ u.svr_ip }}:{{ u.svr_port }}</span>
                  <span class="u-type" v-if="u.unit_group_id">group {{ u.unit_group_id }}</span>
                  <span class="badge" :class="statusClass(u.status)">{{ u.status }}</span>
                </div>
                <div v-if="unitsOf(te.tenant_id).length === 0" class="empty">
                  {{ t('obtopo.noUnit') }}
                </div>
              </div>
            </div>
            <div v-if="!tenants.length && !loading" class="empty">{{ t('obtopo.noTenant') }}</div>
          </div>
        </div>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.topo {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: none;
}
.btn {
  padding: 5px 14px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.auto-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
.auto-refresh select {
  padding: 3px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
}
.spacer {
  flex: 1;
}
.err {
  flex: none;
  padding: 8px 12px;
  background: rgba(224, 64, 80, 0.1);
  border: 1px solid rgba(224, 64, 80, 0.4);
  border-radius: 6px;
  color: #e04050;
  font-size: 12px;
  white-space: pre-wrap;
}

/* 顶部计数卡 */
.cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  flex: none;
}
.card {
  padding: 10px 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.card .lbl {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 4px;
}
.card .num {
  font-size: 22px;
  font-weight: 600;
  color: var(--text);
}

/* 主体两栏 */
.body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
}
.col {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.col-head {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  flex: none;
}
.col-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 8px;
}

/* Zone 块 */
.zone-block {
  margin-bottom: 12px;
}
.zone-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: rgba(124, 108, 255, 0.08);
  border-left: 3px solid #7c6cff;
  border-radius: 4px;
  margin-bottom: 4px;
  font-size: 12px;
}
.z-icon {
  font-size: 14px;
}
.z-name {
  font-weight: 600;
  color: var(--text);
}
.z-meta {
  color: var(--muted);
  font-size: 11px;
}
.svr {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 28px;
  font-size: 12px;
  color: var(--muted);
}
.s-addr {
  color: var(--text);
  cursor: pointer;
  font-family: var(--font-mono);
}
.s-addr:hover {
  color: var(--accent);
  text-decoration: underline;
}
.s-meta {
  font-size: 11px;
}

/* Tenant 列表 */
.tenant {
  border-bottom: 1px solid var(--border);
}
.tenant:last-child {
  border-bottom: none;
}
.tenant-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 12px;
}
.tenant-row:hover {
  background: rgba(124, 108, 255, 0.06);
}
.arrow {
  color: var(--muted);
  width: 12px;
  text-align: center;
}
.t-name {
  font-weight: 600;
  color: var(--text);
}
.t-id {
  color: var(--muted);
  font-size: 11px;
}
.t-meta {
  color: var(--muted);
  font-size: 11px;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 3px;
}
.t-meta.locality {
  font-family: var(--font-mono);
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t-zones {
  display: inline-flex;
  gap: 4px;
  margin-left: auto;
  margin-right: 6px;
}
.z-chip {
  font-size: 10px;
  padding: 1px 5px;
  background: rgba(124, 108, 255, 0.12);
  color: #b4a8ff;
  border-radius: 3px;
}
.units {
  padding: 4px 10px 10px 32px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.unit {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 4px;
  font-size: 11px;
  color: var(--muted);
}
.u-id {
  font-family: var(--font-mono);
  color: var(--text);
}
.u-pool {
  font-size: 10px;
  padding: 1px 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
}
.u-loc {
  font-family: var(--font-mono);
}
.u-type {
  font-size: 10px;
  padding: 1px 4px;
  background: rgba(60, 180, 130, 0.2);
  color: #6fe0a8;
  border-radius: 3px;
}

/* 状态徽章 */
.badge {
  display: inline-flex;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  margin-left: auto;
}
.badge.st-ok {
  background: rgba(60, 180, 130, 0.18);
  color: #6fe0a8;
}
.badge.st-warn {
  background: rgba(220, 180, 60, 0.18);
  color: #e0c060;
}
.badge.st-bad {
  background: rgba(224, 64, 80, 0.18);
  color: #ff7c8e;
}

.empty {
  font-size: 11px;
  color: var(--muted);
  padding: 12px;
  text-align: center;
  font-style: italic;
}
</style>
