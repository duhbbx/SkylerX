<script setup lang="ts">
import { type ConnectionConfig, DbDialect, type TestResult } from '@db-tool/shared-types'
import { reactive, ref, watch } from 'vue'

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
const testResult = ref<TestResult | null>(null)
const busy = ref(false)

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
  }
}

async function load(): Promise<void> {
  testResult.value = null
  if (props.connId) {
    const full = await window.api.connections.get(props.connId)
    Object.assign(form, { ...full, password: full.password ?? '' })
  } else {
    Object.assign(form, blankForm())
  }
}

watch(() => props.connId, load, { immediate: true })

function onDialectChange(): void {
  form.port = defaultPorts[form.dialect] ?? form.port
}

// 过 IPC 前转成纯对象，避免 Vue 响应式 Proxy 触发结构化克隆错误
function plain(config: ConnectionConfig): ConnectionConfig {
  return JSON.parse(JSON.stringify(config))
}

async function save(): Promise<void> {
  busy.value = true
  try {
    const saved = props.connId
      ? await window.api.connections.update(plain({ ...form, id: props.connId }))
      : await window.api.connections.create(plain({ ...form }))
    emit('saved', saved)
  } finally {
    busy.value = false
  }
}

async function testConnection(): Promise<void> {
  busy.value = true
  testResult.value = null
  try {
    testResult.value = await window.api.connections.test(plain({ ...form }))
  } finally {
    busy.value = false
  }
}

async function remove(): Promise<void> {
  if (!props.connId) return
  await window.api.connections.remove(props.connId)
  emit('deleted', props.connId)
}
</script>

<template>
  <div class="form-pane">
    <div v-if="initialError && !testResult" class="banner err">
      ✗ 连接失败：{{ initialError }}
    </div>
    <div class="form-grid">
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
</style>
