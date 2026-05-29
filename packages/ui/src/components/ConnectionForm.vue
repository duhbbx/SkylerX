<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type ConnectionConfig,
  type ConnectionEnv,
  DbDialect,
  type TestResult,
} from '@db-tool/shared-types'
import { computed, reactive, ref, watch } from 'vue'
import { emitChatErrorAsk } from '../chat-bus'
import { ENV_OPTIONS, connEnv, connReadOnly } from '../connEnv'
import { categorizeConnectionError, extractDbErrorCode } from '../connError'
import { useDataClient } from '../data-client'
import { t } from '../i18n'
import DialectSelect from './DialectSelect.vue'

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
  { value: DbDialect.TiDB, label: 'TiDB' },
  { value: DbDialect.CockroachDB, label: 'CockroachDB' },
  { value: DbDialect.Greenplum, label: 'Greenplum' },
  { value: DbDialect.OpenGauss, label: 'openGauss' },
  { value: DbDialect.SQLite, label: 'SQLite' },
  { value: DbDialect.DuckDB, label: 'DuckDB' },
  { value: DbDialect.ClickHouse, label: 'ClickHouse' },
  { value: DbDialect.Snowflake, label: 'Snowflake' },
  { value: DbDialect.H2, label: 'H2 (PG 兼容模式)' },
  { value: DbDialect.Doris, label: 'Apache Doris' },
  { value: DbDialect.StarRocks, label: 'StarRocks' },
  { value: DbDialect.Redshift, label: 'Amazon Redshift' },
  { value: DbDialect.TDengine, label: 'TDengine 涛思' },
  { value: DbDialect.MongoDB, label: 'MongoDB' },
  { value: DbDialect.Redis, label: 'Redis' },
  { value: DbDialect.Elasticsearch, label: 'Elasticsearch' },
]

const defaultPorts: Record<string, number> = {
  [DbDialect.MySQL]: 3306,
  [DbDialect.MariaDB]: 3306,
  [DbDialect.OceanBase]: 2881,
  [DbDialect.TiDB]: 4000,
  [DbDialect.PostgreSQL]: 5432,
  [DbDialect.KingbaseES]: 54321,
  [DbDialect.CockroachDB]: 26257,
  [DbDialect.Greenplum]: 5432,
  [DbDialect.OpenGauss]: 5432,
  [DbDialect.Oracle]: 1521,
  [DbDialect.DM]: 5236,
  [DbDialect.SqlServer]: 1433,
  [DbDialect.SQLite]: 0,
  [DbDialect.DuckDB]: 0,
  [DbDialect.ClickHouse]: 8123,
  [DbDialect.Snowflake]: 443,
  [DbDialect.H2]: 5435,
  [DbDialect.Doris]: 9030,
  [DbDialect.StarRocks]: 9030,
  [DbDialect.Redshift]: 5439,
  [DbDialect.TDengine]: 6041,
  [DbDialect.MongoDB]: 27017,
  [DbDialect.Redis]: 6379,
  [DbDialect.Elasticsearch]: 9200,
}

const form = reactive<ConnectionConfig>(blankForm())
const env = ref<ConnectionEnv | ''>('') // 环境标记，存于 extra.env
const readOnly = ref(false) // 只读连接，存于 extra.readOnly
const testResult = ref<TestResult | null>(null)
const busy = ref(false)
const section = ref<'general' | 'ssl' | 'ssh'>('general')
const groups = ref<string[]>([])
const showRawError = ref(false) // 错误 banner 中「查看原始错误」折叠

/** 把 testResult.message 分类成带标题/排查步骤的结构（失败时使用）。 */
const categorizedError = computed(() => {
  if (!testResult.value || testResult.value.ok) return null
  return categorizeConnectionError(testResult.value.message || '')
})

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
  return JSON.stringify({
    form,
    env: env.value,
    readOnly: readOnly.value,
  })
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

const isMongo = computed(() => form.dialect === DbDialect.MongoDB)
const isSnowflake = computed(() => form.dialect === DbDialect.Snowflake)
const isClickhouse = computed(() => form.dialect === DbDialect.ClickHouse)
const isFileDb = computed(
  () => form.dialect === DbDialect.SQLite || form.dialect === DbDialect.DuckDB,
)
const isH2 = computed(() => form.dialect === DbDialect.H2)

/** MongoDB URI 直填（读写 form.extra.uri，按需创建 / 清空 extra）。 */
const mongoUri = computed<string>({
  get: () => {
    const v = (form.extra as Record<string, unknown> | undefined)?.uri
    return typeof v === 'string' ? v : ''
  },
  set: (v: string) => {
    const trimmed = v ?? ''
    const { uri: _drop, ...rest } = (form.extra as Record<string, unknown> | undefined) ?? {}
    void _drop
    const next = trimmed ? { ...rest, uri: trimmed } : rest
    form.extra = Object.keys(next).length ? next : undefined
  },
})
const mongoUriActive = computed(() => isMongo.value && mongoUri.value.trim().length > 0)

/** 工厂：生成读写 form.extra[key] 的字符串字段；空串自动从 extra 移除，保持配置干净。 */
function strExtra(key: string): { get: () => string; set: (v: string) => void } {
  return {
    get: () => {
      const v = (form.extra as Record<string, unknown> | undefined)?.[key]
      return typeof v === 'string' ? v : ''
    },
    set: (v: string) => {
      const trimmed = v ?? ''
      const extra = { ...((form.extra as Record<string, unknown> | undefined) ?? {}) }
      if (trimmed) extra[key] = trimmed
      else delete extra[key]
      form.extra = Object.keys(extra).length ? extra : undefined
    },
  }
}
/** 工厂：boolean 字段；false 时移除 key。 */
function boolExtra(key: string): { get: () => boolean; set: (v: boolean) => void } {
  return {
    get: () => (form.extra as Record<string, unknown> | undefined)?.[key] === true,
    set: (v: boolean) => {
      const extra = { ...((form.extra as Record<string, unknown> | undefined) ?? {}) }
      if (v) extra[key] = true
      else delete extra[key]
      form.extra = Object.keys(extra).length ? extra : undefined
    },
  }
}

// Snowflake 专属字段（写入 extra.account / warehouse / role / schema / authenticator / privateKeyPath / privateKeyPass）
const snowflakeAccount = computed<string>(strExtra('account'))
const snowflakeWarehouse = computed<string>(strExtra('warehouse'))
const snowflakeRole = computed<string>(strExtra('role'))
const snowflakeSchema = computed<string>(strExtra('schema'))
const snowflakeAuth = computed<string>(strExtra('authenticator'))
const snowflakePkPath = computed<string>(strExtra('privateKeyPath'))
const snowflakePkPass = computed<string>(strExtra('privateKeyPass'))

// ClickHouse 专属字段（写入 extra.url / showSystemDatabases）
const clickhouseUrl = computed<string>(strExtra('url'))
const clickhouseShowSystem = computed<boolean>(boolExtra('showSystemDatabases'))
const clickhouseUrlActive = computed(
  () => isClickhouse.value && clickhouseUrl.value.trim().length > 0,
)

/** Snowflake 私钥文件浏览：复用底层 client.files.selectFile IPC。 */
async function browsePrivateKey(): Promise<void> {
  const path = await client.files.selectFile?.({
    filters: [{ name: 'PEM', extensions: ['pem', 'p8', 'key'] }],
    defaultPath: snowflakePkPath.value || undefined,
  })
  if (path) snowflakePkPath.value = path
}

/** SQLite / DuckDB 数据库文件浏览（allowCreate 允许选不存在路径以新建库）。 */
async function browseDbFile(): Promise<void> {
  const path = await client.files.selectFile?.({
    filters:
      form.dialect === DbDialect.SQLite
        ? [{ name: 'SQLite DB', extensions: ['db', 'sqlite', 'sqlite3'] }]
        : [{ name: 'DuckDB', extensions: ['duckdb', 'db'] }],
    allowCreate: true,
    defaultPath: form.database || undefined,
  })
  if (path) form.database = path
}

// 过 IPC 前转成纯对象，避免 Vue 响应式 Proxy 触发结构化克隆错误；
// 未启用的 SSL/SSH 不持久化，空分组归一为 undefined。
function buildConfig(): ConnectionConfig {
  const cfg = JSON.parse(JSON.stringify({ ...form })) as ConnectionConfig
  cfg.ssl = form.ssl?.enabled ? cfg.ssl : undefined
  cfg.ssh = form.ssh?.enabled ? cfg.ssh : undefined
  cfg.group = form.group?.trim() || undefined
  // 环境标记 / 只读 并入 extra（无则移除：先剔除旧值，再按需加回）
  // 提交模式不再随连接持久化，已迁移到查询 tab 工具栏可即时切换。
  // 这里同时把历史遗留的 extra.commitMode 顺手剔除掉。
  const {
    env: _e,
    readOnly: _r,
    commitMode: _cm,
    ...restExtra
  } = (form.extra ?? {}) as Record<string, unknown>
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
  showRawError.value = false
  try {
    testResult.value = await client.connections.test(buildConfig())
  } catch (e) {
    // 主进程 IPC 抛错（如方言驱动未注册、SSH 失败、超时）必须 catch，
    // 否则 promise 逃逸成 Vue Unhandled rejection，用户什么都看不到。
    // 把它包成 TestResult 走现有 banner 渲染，跟 testResult.ok=false 一样的 UI。
    const message = e instanceof Error ? e.message : String(e)
    testResult.value = { ok: false, message: stripIpcWrapper(message) }
  } finally {
    busy.value = false
  }
}

/** Electron IPC 抛错前缀通常是「Error invoking remote method 'xxx': Error: 真实信息」，去掉两层包装让 banner 干净。 */
function stripIpcWrapper(msg: string): string {
  return msg.replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^Error:\s*/i, '')
}

/**
 * 错误 banner 里点「✨ 问 AI」: 把测试连接的原始错误 + 方言/连接名打给 AI。
 * 连接还没创建时 connId 可能是空字符串——AI 聊天面板能容忍，只是少了 connId 上下文。
 */
function askAiAboutTestError(): void {
  const raw = testResult.value?.message ?? ''
  if (!raw) return
  emitChatErrorAsk({
    error: raw,
    errorCode: extractDbErrorCode(raw),
    connId: props.connId ?? '',
    connName: form.name,
    dialect: form.dialect,
  })
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
      <!-- 自定义下拉：native <select> 无法内嵌 SVG，换成 DialectSelect 后每个方言都带品牌 logo -->
      <DialectSelect
        v-model="form.dialect"
        :options="dialectOptions"
        @change="onDialectChange"
      />

      <template v-if="isMongo">
        <label>URI</label>
        <textarea
          v-model="mongoUri"
          rows="2"
          placeholder="mongodb://user:pass@host:27017/dbname?options..."
        />
        <span />
        <small class="hint">填写 URI 时会忽略 Host/Port/User/Password/Database</small>
      </template>

      <!-- ClickHouse: 完整 URL 直填（覆盖 Host/Port） -->
      <template v-if="isClickhouse">
        <label>URL</label>
        <textarea
          v-model="clickhouseUrl"
          rows="2"
          placeholder="https://user:pass@host:8443/?param=value"
        />
        <span />
        <small class="hint">填写完整 URL 时会忽略 Host/Port</small>
      </template>

      <!-- H2: 仅支持 PG-server 模式,提示用户怎么启动 -->
      <template v-if="isH2">
        <span />
        <small class="hint">
          仅支持 PG-server 模式 — H2 启动需加 <code>-pg</code> 参数:
          <code>java -cp h2-*.jar org.h2.tools.Server -pg -pgPort 5435 -ifNotExists -baseDir ~/h2data</code>
          默认 User=<code>sa</code>,Password 空
        </small>
      </template>

      <!-- Snowflake: Account 取代 Host；不需要 Port -->
      <template v-if="isSnowflake">
        <label>Account</label>
        <input v-model="snowflakeAccount" placeholder="xy12345.us-east-1" />
      </template>
      <template v-else-if="!isFileDb">
        <label>{{ t('conn.host') }}</label>
        <input v-model="form.host" :disabled="mongoUriActive || clickhouseUrlActive" />

        <label>{{ t('conn.port') }}</label>
        <input
          v-model.number="form.port"
          type="number"
          :disabled="mongoUriActive || clickhouseUrlActive"
        />
      </template>

      <template v-if="!isFileDb">
        <label>{{ t('conn.user') }}</label>
        <input v-model="form.user" :disabled="mongoUriActive" />

        <label>{{ t('conn.password') }}</label>
        <input v-model="form.password" type="password" placeholder="" :disabled="mongoUriActive" />
      </template>

      <!-- Snowflake 专属:Warehouse / Role / Schema / Authenticator -->
      <template v-if="isSnowflake">
        <label>Warehouse</label>
        <input v-model="snowflakeWarehouse" :placeholder="t('conn.optional')" />

        <label>Role</label>
        <input v-model="snowflakeRole" :placeholder="t('conn.optional')" />

        <label>Schema</label>
        <input v-model="snowflakeSchema" :placeholder="t('conn.optional')" />

        <label>Authenticator</label>
        <select v-model="snowflakeAuth">
          <option value="">Password</option>
          <option value="snowflake_jwt">Key Pair (snowflake_jwt)</option>
        </select>

        <template v-if="snowflakeAuth === 'snowflake_jwt'">
          <label>Private Key Path</label>
          <span class="path-row">
            <input v-model="snowflakePkPath" placeholder="/path/to/rsa_key.p8" />
            <button type="button" class="ghost" @click="browsePrivateKey">浏览…</button>
          </span>

          <label>Private Key Passphrase</label>
          <input v-model="snowflakePkPass" type="password" :placeholder="t('conn.optional')" />
        </template>
      </template>

      <!-- ClickHouse 专属:是否显示系统库 -->
      <template v-if="isClickhouse">
        <label>Show System Databases</label>
        <input v-model="clickhouseShowSystem" type="checkbox" class="chk" />
      </template>

      <label v-if="isFileDb">Database File</label>
      <label v-else>{{ t('conn.database') }}</label>
      <span v-if="isFileDb" class="path-row">
        <input v-model="form.database" placeholder=":memory: 留空" />
        <button type="button" class="ghost" @click="browseDbFile">浏览…</button>
      </span>
      <input
        v-else
        v-model="form.database"
        :placeholder="t('conn.optional')"
        :disabled="mongoUriActive"
      />

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

      <!-- 提交模式不再绑定到连接：改成查询 tab 的工具栏按钮可切换，新 tab 跟随 settings.commitMode -->
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
      <!-- 左：测试 + 删除（编辑态）—— 操作当前连接的辅助按钮 -->
      <button class="ghost" :disabled="busy" @click="testConnection">{{ t('conn.test') }}</button>
      <button v-if="connId" class="danger" :disabled="busy" @click="remove">{{ t('common.delete') }}</button>
      <span class="grow" />
      <!-- 右：取消 + 创建/保存 —— 关闭对话框的主操作组 -->
      <button class="ghost" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="primary" :disabled="busy" @click="save">{{ connId ? t('conn.save') : t('conn.create') }}</button>
    </div>

    <div v-if="testResult" class="banner" :class="testResult.ok ? 'ok' : 'err'">
      <template v-if="testResult.ok">
        {{ t('conn.ok') }}
        <span v-if="testResult.serverVersion">（{{ testResult.serverVersion }}）</span>
        <span v-if="testResult.latencyMs != null">· {{ testResult.latencyMs }} ms</span>
      </template>
      <template v-else-if="categorizedError">
        <div class="err-title">✗ {{ t(categorizedError.title) }}</div>
        <ul class="err-steps">
          <li v-for="k in categorizedError.stepKeys" :key="k">{{ t(k) }}</li>
        </ul>
        <div class="err-actions">
          <button type="button" class="err-toggle" @click="showRawError = !showRawError">
            {{ showRawError ? t('errSteps.hideRaw') : t('errSteps.showRaw') }}
          </button>
          <button type="button" class="err-ask-ai" @click="askAiAboutTestError">
            ✨ {{ t('aichat.askAi') }}
          </button>
        </div>
        <pre v-if="showRawError" class="err-raw">{{ categorizedError.raw }}</pre>
      </template>
      <template v-else>
        <div>✗ {{ testResult.message }}</div>
        <div class="err-actions">
          <button type="button" class="err-ask-ai" @click="askAiAboutTestError">
            ✨ {{ t('aichat.askAi') }}
          </button>
        </div>
      </template>
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
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  margin-top: 12px;
}
.actions .grow { flex: 1; }
/* 让 primary 按钮（创建 / 保存）有明显视觉权重 */
.actions .primary {
  background: var(--accent, #7c6cff);
  color: #fff;
  border-color: var(--accent, #7c6cff);
}
.actions .primary:hover:not(:disabled) { filter: brightness(1.1); }
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
.form-grid .hint {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}
/* 文件路径输入 + 浏览按钮：让按钮紧贴输入框右侧，整体占满列宽 */
.form-grid .path-row {
  display: flex;
  gap: 6px;
  align-items: stretch;
  min-width: 0;
}
.form-grid .path-row > input {
  flex: 1 1 auto;
  min-width: 0;
}
.form-grid .path-row > button {
  flex: none;
  padding: 0 10px;
  font-size: 12px;
}
.form-grid input:disabled,
.form-grid select:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
/* 错误 banner 内部排版：标题 + 步骤列表 + 原始错误折叠按钮 */
.banner.err .err-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.banner.err .err-steps {
  margin: 4px 0 6px 18px;
  padding: 0;
  font-size: 13px;
  line-height: 1.55;
}
.banner.err .err-steps li {
  list-style: disc;
  margin: 2px 0;
}
.banner.err .err-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 2px;
}
.banner.err .err-ask-ai {
  background: transparent;
  border: 1px solid var(--accent, #7c6cff);
  padding: 2px 10px;
  border-radius: 4px;
  color: var(--accent, #7c6cff);
  font-size: 12px;
  cursor: pointer;
}
.banner.err .err-ask-ai:hover {
  background: rgba(124, 108, 255, 0.10);
}
.banner.err .err-toggle {
  background: transparent;
  border: none;
  padding: 0;
  margin-top: 2px;
  color: var(--accent, #7c6cff);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}
.banner.err .err-raw {
  margin: 6px 0 0;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.18);
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
