<script setup lang="ts">
import { type ConnectionConfig, DbDialect, type QueryResult } from '@db-tool/shared-types'
import { computed, onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import {
  COMMON_PRIVS,
  buildGrant,
  formatGrantee,
  listUsersQuery,
  userGrantsQuery,
} from '../privileges'
import Modal from './Modal.vue'

const client = useDataClient()
const emit = defineEmits<{ close: []; openSql: [string, string] }>()

interface User {
  usr: string
  host: string
}

const conns = ref<ConnectionConfig[]>([])
const connId = ref('')
const users = ref<User[]>([])
const selUser = ref<User | null>(null)
const grants = ref<string[]>([])
const error = ref<string | null>(null)
const busy = ref(false)

// GRANT 构造器
const privs = ref<string[]>(['SELECT'])
const target = ref('')
const withGrant = ref(false)

const connOf = (id: string) => conns.value.find((c) => c.id === id)
function fam(d: DbDialect | undefined): 'mysql' | 'pg' | 'other' {
  if (d && [DbDialect.MySQL, DbDialect.MariaDB, DbDialect.OceanBase].includes(d)) return 'mysql'
  if (d && [DbDialect.PostgreSQL, DbDialect.KingbaseES].includes(d)) return 'pg'
  return 'other'
}
const supported = computed(() => fam(connOf(connId.value)?.dialect) !== 'other')

const grantSql = computed(() => {
  const c = connOf(connId.value)
  if (!c || !selUser.value || !target.value.trim()) return ''
  return buildGrant(
    privs.value,
    target.value.trim(),
    formatGrantee(c.dialect, selUser.value.usr, selUser.value.host),
    withGrant.value,
  )
})

onMounted(async () => {
  conns.value = await client.connections.list()
  connId.value = conns.value[0]?.id ?? ''
  await loadUsers()
})

async function loadUsers(): Promise<void> {
  users.value = []
  selUser.value = null
  grants.value = []
  error.value = null
  const c = connOf(connId.value)
  if (!c) return
  const sql = listUsersQuery(c.dialect)
  if (!sql) {
    error.value = '该方言暂不支持用户管理（仅 MySQL / PostgreSQL 系）'
    return
  }
  busy.value = true
  try {
    const r = (await client.connections.execute(c.id, sql, [])) as QueryResult
    users.value = (r.rows as Record<string, unknown>[]).map((row) => ({
      usr: String(row.usr ?? ''),
      host: String(row.host ?? ''),
    }))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function pickUser(u: User): Promise<void> {
  selUser.value = u
  grants.value = []
  const c = connOf(connId.value)
  if (!c) return
  const sql = userGrantsQuery(c.dialect, u.usr, u.host)
  if (!sql) return
  try {
    const r = (await client.connections.execute(c.id, sql, [])) as QueryResult
    grants.value = (r.rows as Record<string, unknown>[]).map((row) =>
      Object.values(row)
        .filter((v) => v != null && v !== '')
        .join('　·　'),
    )
  } catch (e) {
    grants.value = [`（读取授权失败：${e instanceof Error ? e.message : String(e)}）`]
  }
}

function togglePriv(p: string): void {
  const i = privs.value.indexOf(p)
  if (i >= 0) privs.value.splice(i, 1)
  else privs.value.push(p)
}
function copySql(): void {
  if (grantSql.value) void navigator.clipboard?.writeText(grantSql.value)
}
function openInQuery(): void {
  if (grantSql.value && connId.value) {
    emit('openSql', connId.value, grantSql.value)
    emit('close')
  }
}
</script>

<template>
  <Modal title="用户与权限" @close="emit('close')">
    <div class="priv">
      <div class="bar">
        <select v-model="connId" @change="loadUsers">
          <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }} · {{ c.dialect }}</option>
        </select>
        <span v-if="busy" class="muted">加载中…</span>
      </div>
      <div v-if="error" class="banner err">✗ {{ error }}</div>

      <div v-else-if="supported" class="cols">
        <div class="users">
          <div class="lbl">用户 / 角色（{{ users.length }}）</div>
          <div class="ulist">
            <div
              v-for="u in users"
              :key="u.usr + '@' + u.host"
              class="urow"
              :class="{ on: selUser?.usr === u.usr && selUser?.host === u.host }"
              @click="pickUser(u)"
            >
              {{ u.usr }}<span v-if="u.host" class="host">@{{ u.host }}</span>
            </div>
          </div>
        </div>

        <div class="detail">
          <template v-if="selUser">
            <div class="lbl">已有授权</div>
            <div class="grants">
              <div v-if="!grants.length" class="muted">（无 / 读取中）</div>
              <code v-for="(g, i) in grants" :key="i" class="grow">{{ g }}</code>
            </div>

            <div class="lbl">授予权限（GRANT）</div>
            <div class="priv-row">
              <label v-for="p in COMMON_PRIVS" :key="p" class="chk">
                <input type="checkbox" :checked="privs.includes(p)" @change="togglePriv(p)" /> {{ p }}
              </label>
            </div>
            <input v-model="target" class="target" placeholder="目标，如 `db`.* / schema.table / *.*" />
            <label class="chk"><input v-model="withGrant" type="checkbox" /> WITH GRANT OPTION</label>
            <pre v-if="grantSql" class="sql">{{ grantSql }}</pre>
            <div class="actions">
              <button :disabled="!grantSql" @click="copySql">复制</button>
              <button class="primary" :disabled="!grantSql" @click="openInQuery">在查询页打开</button>
            </div>
          </template>
          <div v-else class="muted pad">选择左侧用户查看授权并生成 GRANT</div>
        </div>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.priv {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 680px;
  max-width: 90vw;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bar select {
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.muted {
  color: var(--muted);
  font-size: 13px;
}
.muted.pad {
  padding: 16px;
}
.cols {
  display: flex;
  gap: 12px;
}
.users {
  width: 220px;
  flex: none;
}
.detail {
  flex: 1;
  min-width: 0;
}
.lbl {
  font-size: 12px;
  color: var(--muted);
  margin: 6px 0 4px;
  font-weight: 600;
}
.ulist {
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.urow {
  padding: 5px 10px;
  font-size: 13px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  font-family: ui-monospace, monospace;
}
.urow:hover {
  background: rgba(124, 108, 255, 0.12);
}
.urow.on {
  background: rgba(124, 108, 255, 0.28);
}
.urow .host {
  color: var(--muted);
}
.grants {
  max-height: 120px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 6px;
}
.grow {
  display: block;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  padding: 1px 0;
}
.priv-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 6px;
}
.chk {
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.target {
  width: 100%;
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  margin-bottom: 6px;
}
.sql {
  margin: 6px 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre-wrap;
}
.actions {
  display: flex;
  gap: 8px;
}
.banner.err {
  color: var(--err, #e04050);
  font-size: 13px;
}
</style>
