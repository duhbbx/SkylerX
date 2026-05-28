<script setup lang="ts">
import { type ConnectionConfig, type ConnectionEnv, DbDialect, type TestResult } from '@db-tool/shared-types'
import { reactive, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { ENV_OPTIONS, connEnv, connReadOnly } from '../connEnv'
import { t } from '../i18n'

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
const readOnly = ref(false) // 只读连接，存于 extra.readOnly
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
    readOnly.value = connReadOnly(full)
  } else {
    Object.assign(form, blankForm())
    env.value = ''
    readOnly.value = false
  }
  normalize()
  // 收集已有分组用于输入提示
  try {
    const all = await client.connections.list()
    groups.value = [...new Set(all.map((c) => c.group).filter((g): g is string => !!g))]
  } catch {
    groups.value = []
  }
  // 载入完成后给整体表单拍个快照，用来判断「是否有未保存的修改」
  resetDirtyBaseline()
}

/** 表单脏检查：与载入/上一次保存时的快照做 JSON 对比。 */
const dirtyBaseline = ref('')
function snapshot(): string {
  return JSON.stringify({ form, env: env.value, readOnly: readOnly.value })
}
function resetDirtyBaseline(): void {
  dirtyBaseline.value = snapshot()
}
/** 是否有未保存修改（供父组件经 template ref 调用）。 */
function isDirty(): boolean {
  return dirtyBaseline.value !== '' && snapshot() !== dirtyBaseline.value
}
defineExpose({ isDirty })

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
  // 环境标记 / 只读并入 extra（无则移除：先剔除旧值，再按需加回）
  const { env: _e, readOnly: _r, ...restExtra } = (form.extra ?? {}) as Record<string, unknown>
  const extra: Record<string, unknown> = { ...restExtra }
  if (env.value) extra.env = env.value
  if (readOnly.value) extra.readOnly = true
  cfg.extra = Object.keys(extra).length ? extra : undefined
  return cfg
}

async function save(): Promise<void> {
  busy.value = true
  try {
    const saved = props.connId
      ? await client.connections.update({ ...buildConfig(), id: props.connId })
      : await client.connections.create(buildConfig())
    resetDirtyBaseline() // 保存成功后表单与基线对齐，不再被视为脏
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
      {{ t('conn.failed', { msg: initialError }) }}
    </div>
    <div class="sec-tabs">
      <button :class="{ active: section === 'general' }" @click="section = 'general'">{{ t('conn.tab.general') }}</button>
      <button :class="{ active: section === 'ssl' }" @click="section = 'ssl'">
        SSL<span v-if="form.ssl?.enabled" class="dot">●</span>
      </button>
      <button :class="{ active: section === 'ssh' }" @click="section = 'ssh'">
        {{ t('conn.tab.ssh') }}<span v-if="form.ssh?.enabled" class="dot">●</span>
      </button>
    </div>

    <div class="form-scroll">
    <div v-show="section === 'general'" class="form-grid">
      <label>{{ t('conn.name') }}</label>
      <input v-model="form.name" :placeholder="t('conn.name.ph')" />

      <label>{{ t('conn.dialect') }}</label>
      <select v-model="form.dialect" @change="onDialectChange">
        <option v-for="d in dialectOptions" :key="d.value" :value="d.value">{{ d.label }}</option>
      </select>

      <label>{{ t('conn.host') }}</label>
      <input v-model="form.host" />

      <label>{{ t('conn.port') }}</label>
      <input v-model.number="form.port" type="number" />

      <label>{{ t('conn.user') }}</label>
      <input v-model="form.user" />

      <label>{{ t('conn.password') }}</label>
      <input v-model="form.password" type="password" placeholder="" />

      <label>{{ t('conn.database') }}</label>
      <input v-model="form.database" :placeholder="t('conn.optional')" />

      <label>{{ t('conn.group') }}</label>
      <input v-model="form.group" list="conn-groups" :placeholder="t('conn.group.ph')" />
      <datalist id="conn-groups">
        <option v-for="g in groups" :key="g" :value="g" />
      </datalist>

      <label>{{ t('conn.env') }}</label>
      <select v-model="env">
        <option value="">{{ t('conn.env.none') }}</option>
        <option v-for="e in ENV_OPTIONS" :key="e" :value="e">{{ t('env.' + e) }}（{{ e }}）</option>
      </select>

      <label>{{ t('conn.readOnly') }}</label>
      <input v-model="readOnly" type="checkbox" class="chk" :title="t('conn.readOnlyTitle')" />
    </div>

    <div v-show="section === 'ssl'" class="form-grid">
      <template v-if="form.ssl">
        <label>{{ t('conn.ssl.enable') }}</label>
        <input v-model="form.ssl.enabled" type="checkbox" class="chk" />
        <template v-if="form.ssl.enabled">
          <label>{{ t('conn.ssl.verify') }}</label>
          <input v-model="form.ssl.rejectUnauthorized" type="checkbox" class="chk" />
          <label>{{ t('conn.ssl.ca') }}</label>
          <textarea v-model="form.ssl.ca" rows="3" :placeholder="t('conn.ssl.caPh')" />
          <label>{{ t('conn.ssl.cert') }}</label>
          <textarea v-model="form.ssl.cert" rows="3" :placeholder="t('conn.ssl.certPh')" />
          <label>{{ t('conn.ssl.key') }}</label>
          <textarea v-model="form.ssl.key" rows="3" :placeholder="t('conn.ssl.keyPh')" />
        </template>
      </template>
    </div>

    <div v-show="section === 'ssh'" class="form-grid">
      <template v-if="form.ssh">
        <label>{{ t('conn.ssh.enable') }}</label>
        <input v-model="form.ssh.enabled" type="checkbox" class="chk" />
        <template v-if="form.ssh.enabled">
          <label>{{ t('conn.ssh.host') }}</label>
          <input v-model="form.ssh.host" placeholder="jump.example.com" />
          <label>{{ t('conn.ssh.port') }}</label>
          <input v-model.number="form.ssh.port" type="number" />
          <label>{{ t('conn.ssh.user') }}</label>
          <input v-model="form.ssh.user" />
          <label>{{ t('conn.ssh.password') }}</label>
          <input v-model="form.ssh.password" type="password" :placeholder="t('conn.ssh.passwordPh')" />
          <label>{{ t('conn.ssh.key') }}</label>
          <textarea v-model="form.ssh.privateKey" rows="3" :placeholder="t('conn.ssh.keyPh')" />
          <label>{{ t('conn.ssh.passphrase') }}</label>
          <input v-model="form.ssh.passphrase" type="password" :placeholder="t('conn.optional')" />
        </template>
      </template>
    </div>

    </div>
    <div class="actions">
      <button :disabled="busy" @click="save">{{ connId ? t('conn.save') : t('conn.create') }}</button>
      <button class="ghost" :disabled="busy" @click="testConnection">{{ t('conn.test') }}</button>
      <button v-if="connId" class="danger" :disabled="busy" @click="remove">{{ t('common.delete') }}</button>
      <button class="ghost" @click="emit('cancel')">{{ t('common.cancel') }}</button>
    </div>

    <div v-if="testResult" class="banner" :class="testResult.ok ? 'ok' : 'err'">
      <template v-if="testResult.ok">
        {{ t('conn.ok') }}
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
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.form-pane .banner.err {
  margin: 0 0 14px;
  flex: none;
}
.sec-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 14px;
  flex: none;
}
/*
 * 中间表单区：唯一可滚动的区块，宽度由 modal 决定（不出横向滚动条），
 * 高度随 modal 调整。切 general/ssl/ssh 切 v-show 时，
 * 由于这一层固定 flex:1，整体弹窗尺寸不会跳。
 */
.form-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
}
.actions {
  flex: none;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  margin-top: 12px;
}
.form-pane .banner:not(.err) {
  flex: none;
  margin-top: 10px;
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
