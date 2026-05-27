<script setup lang="ts">
import { type ConnectionConfig, type ConnectionEnv, DbDialect, type TestResult } from '@db-tool/shared-types'
import { reactive, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { ENV_META, ENV_OPTIONS, connEnv } from '../connEnv'

const client = useDataClient()

const props = defineProps<{ connId: string | null; initialError?: string }>()
const emit = defineEmits<{ saved: [ConnectionConfig]; deleted: [string]; cancel: [] }>()

const dialectOptions = [
  { value: DbDialect.MySQL, label: 'MySQL' },
  { value: DbDialect.MariaDB, label: 'MariaDB' },
  { value: DbDialect.PostgreSQL, label: 'PostgreSQL' },
  { value: DbDialect.Oracle, label: 'Oracle' },
  { value: DbDialect.SqlServer, label: 'SQL Server' },
  { value: DbDialect.DM, label: '达梦 DM' },
  { value: DbDialect.KingbaseES, label: '人大金仓' },
  { value: DbDialect.OceanBase, label: 'OceanBase' },
]

const defaultPorts: Record<string, number> = {
  [DbDialect.MySQL]: 3306,
  [DbDialect.MariaDB]: 3306,
  [DbDialect.OceanBase]: 2881,
  [DbDialect.PostgreSQL]: 5432,
  [DbDialect.KingbaseES]: 54321,
  [DbDialect.Oracle]: 1521,
  [DbDialect.DM]: 5236,
  [DbDialect.SqlServer]: 1433,
}

const form = reactive<ConnectionConfig>(blankForm())
const env = ref<ConnectionEnv | ''>('') // 环境标记，存于 extra.env
const testResult = ref<TestResult | null>(null)
const busy = ref(false)
const section = ref<'general' | 'ssl' | 'ssh'>('general')
const groups = ref<string[]>([])

function blankForm(): ConnectionConfig {
  return {
    id: '',
    name: '',
    dialect: DbDialect.MySQL,
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '',
    database: '',
    group: '',
    ssl: { enabled: false, rejectUnauthorized: true },
    ssh: { enabled: false, host: '', port: 22, user: '' },
  }
}

/** SSL/SSH 子对象可能从存储里缺省，回填后补全以便 v-model 绑定。 */
function normalize(): void {
  if (!form.ssl) form.ssl = { enabled: false, rejectUnauthorized: true }
  if (!form.ssh) form.ssh = { enabled: false, host: '', port: 22, user: '' }
  if (form.group == null) form.group = ''
}

async function load(): Promise<void> {
  testResult.value = null
  section.value = 'general'
  if (props.connId) {
    const full = await client.connections.get(props.connId)
    Object.assign(form, { ...full, password: full.password ?? '' })
    env.value = connEnv(full) ?? ''
  } else {
    Object.assign(form, blankForm())
    env.value = ''
  }
  normalize()
  // 收集已有分组用于输入提示
  try {
    const all = await client.connections.list()
    groups.value = [...new Set(all.map((c) => c.group).filter((g): g is string => !!g))]
  } catch {
    groups.value = []
  }
}

watch(() => props.connId, load, { immediate: true })

function onDialectChange(): void {
  form.port = defaultPorts[form.dialect] ?? form.port
}

// 过 IPC 前转成纯对象，避免 Vue 响应式 Proxy 触发结构化克隆错误；
// 未启用的 SSL/SSH 不持久化，空分组归一为 undefined。
function buildConfig(): ConnectionConfig {
  const cfg = JSON.parse(JSON.stringify({ ...form })) as ConnectionConfig
  cfg.ssl = form.ssl?.enabled ? cfg.ssl : undefined
  cfg.ssh = form.ssh?.enabled ? cfg.ssh : undefined
  cfg.group = form.group?.trim() || undefined
  // 环境标记并入 extra.env（无则移除：先剔除旧 env，再按需加回）
  const { env: _drop, ...restExtra } = (form.extra ?? {}) as Record<string, unknown>
  const extra = env.value ? { ...restExtra, env: env.value } : restExtra
  cfg.extra = Object.keys(extra).length ? extra : undefined
  return cfg
}

async function save(): Promise<void> {
  busy.value = true
  try {
    const saved = props.connId
      ? await client.connections.update({ ...buildConfig(), id: props.connId })
      : await client.connections.create(buildConfig())
    emit('saved', saved)
  } finally {
    busy.value = false
  }
}

async function testConnection(): Promise<void> {
  busy.value = true
  testResult.value = null
  try {
    testResult.value = await client.connections.test(buildConfig())
  } finally {
    busy.value = false
  }
}

async function remove(): Promise<void> {
  if (!props.connId) return
  await client.connections.remove(props.connId)
  emit('deleted', props.connId)
}
</script>

<template>
  <div class="form-pane">
    <div v-if="initialError && !testResult" class="banner err">
      ✗ 连接失败：{{ initialError }}
    </div>
    <div class="sec-tabs">
      <button :class="{ active: section === 'general' }" @click="section = 'general'">常规</button>
      <button :class="{ active: section === 'ssl' }" @click="section = 'ssl'">
        SSL<span v-if="form.ssl?.enabled" class="dot">●</span>
      </button>
      <button :class="{ active: section === 'ssh' }" @click="section = 'ssh'">
        SSH 隧道<span v-if="form.ssh?.enabled" class="dot">●</span>
      </button>
    </div>

    <div v-show="section === 'general'" class="form-grid">
      <label>名称</label>
      <input v-model="form.name" placeholder="本地 MySQL" />

      <label>数据库类型</label>
      <select v-model="form.dialect" @change="onDialectChange">
        <option v-for="d in dialectOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
      </select>

      <label>主机</label>
      <input v-model="form.host" />

      <label>端口</label>
      <input v-model.number="form.port" type="number" />

      <label>用户名</label>
      <input v-model="form.user" />

      <label>密码</label>
      <input v-model="form.password" type="password" placeholder="" />

      <label>默认库</label>
      <input v-model="form.database" placeholder="可选" />

      <label>分组</label>
      <input v-model="form.group" list="conn-groups" placeholder="可选，如 生产 / 测试" />
      <datalist id="conn-groups">
        <option v-for="g in groups" :key="g" :value="g" />
      </datalist>

      <label>环境</label>
      <select v-model="env">
        <option value="">未标记</option>
        <option v-for="e in ENV_OPTIONS" :key="e" :value="e">{{ ENV_META[e].label }}（{{ e }}）</option>
      </select>
    </div>

    <div v-show="section === 'ssl'" class="form-grid">
      <template v-if="form.ssl">
        <label>启用 SSL</label>
        <input v-model="form.ssl.enabled" type="checkbox" class="chk" />
        <template v-if="form.ssl.enabled">
          <label>校验服务端证书</label>
          <input v-model="form.ssl.rejectUnauthorized" type="checkbox" class="chk" />
          <label>CA 证书</label>
          <textarea v-model="form.ssl.ca" rows="3" placeholder="CA 证书 PEM 内容（可选）" />
          <label>客户端证书</label>
          <textarea v-model="form.ssl.cert" rows="3" placeholder="客户端证书 PEM（可选）" />
          <label>客户端私钥</label>
          <textarea v-model="form.ssl.key" rows="3" placeholder="客户端私钥 PEM（可选）" />
        </template>
      </template>
    </div>

    <div v-show="section === 'ssh'" class="form-grid">
      <template v-if="form.ssh">
        <label>启用 SSH 隧道</label>
        <input v-model="form.ssh.enabled" type="checkbox" class="chk" />
        <template v-if="form.ssh.enabled">
          <label>跳板机主机</label>
          <input v-model="form.ssh.host" placeholder="jump.example.com" />
          <label>跳板机端口</label>
          <input v-model.number="form.ssh.port" type="number" />
          <label>SSH 用户名</label>
          <input v-model="form.ssh.user" />
          <label>SSH 密码</label>
          <input v-model="form.ssh.password" type="password" placeholder="密码或私钥二选一" />
          <label>私钥</label>
          <textarea v-model="form.ssh.privateKey" rows="3" placeholder="私钥 PEM 内容（可选）" />
          <label>私钥口令</label>
          <input v-model="form.ssh.passphrase" type="password" placeholder="可选" />
        </template>
      </template>
    </div>

    <div class="actions">
      <button :disabled="busy" @click="save">{{ connId ? '保存' : '创建' }}</button>
      <button class="ghost" :disabled="busy" @click="testConnection">测试连接</button>
      <button v-if="connId" class="danger" :disabled="busy" @click="remove">删除</button>
      <button class="ghost" @click="emit('cancel')">取消</button>
    </div>

    <div v-if="testResult" class="banner" :class="testResult.ok ? 'ok' : 'err'">
      <template v-if="testResult.ok">
        ✓ 连接成功
        <span v-if="testResult.serverVersion">（{{ testResult.serverVersion }}）</span>
        <span v-if="testResult.latencyMs != null">· {{ testResult.latencyMs }} ms</span>
      </template>
      <template v-else> ✗ {{ testResult.message }} </template>
    </div>
  </div>
</template>

<style scoped>
.form-pane {
  width: 100%;
}
.form-pane .banner.err {
  margin: 0 0 14px;
}
.sec-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 14px;
}
.sec-tabs button {
  padding: 5px 14px;
  font-size: 13px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--muted);
  cursor: pointer;
}
.sec-tabs button.active {
  color: var(--text);
  border-color: var(--accent);
}
.sec-tabs .dot {
  color: var(--accent);
  margin-left: 4px;
  font-size: 10px;
}
.form-grid textarea {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  padding: 6px 8px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  resize: vertical;
}
.form-grid .chk {
  justify-self: start;
  width: 16px;
  height: 16px;
}
</style>
