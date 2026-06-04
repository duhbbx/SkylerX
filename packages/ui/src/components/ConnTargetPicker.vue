<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 级联目标选择器:连接 → 库 → schema(若该方言有 schema 层)。
 * 用 metadata 树拉候选,免手输。结构对比 / 数据对比共用。
 *
 * 解析出的 `schema` 语义跟两个 diff 对话框现有的「schema」字段一致:
 *  - 单层方言(MySQL 等):库即 schema,resolved schema = 选中的库;
 *  - 两层方言(PG / SQL Server):resolved schema = 选中的 schema(在连接所在库内查询)。
 * 通过 @change 抛出 { connId, dialect, database, schema }。
 */
import { type ConnectionConfig, type DbDialect, MetaNodeKind } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { databaseHasSchemas } from '../ddl'

export interface PickedTarget {
  connId: string
  dialect?: DbDialect
  database: string
  schema: string
}

const props = defineProps<{ conns: ConnectionConfig[]; label: string }>()
const emit = defineEmits<{ change: [PickedTarget] }>()
const client = useDataClient()

const connId = ref('')
const dbName = ref('')
const schemaName = ref('')
const databases = ref<string[]>([])
const schemas = ref<string[]>([])
const loadingDb = ref(false)
const loadingSchema = ref(false)

const dialect = computed(() => props.conns.find((c) => c.id === connId.value)?.dialect)
const twoLevel = computed(() => (dialect.value ? databaseHasSchemas(dialect.value) : false))
/** 顶层节点是「库」还是直接「schema」(Oracle/DM 是后者)。 */
const topIsSchema = ref(false)

/** resolved schema:两层方言用 schemaName,否则用 dbName(单层=库即 schema)。 */
const resolvedSchema = computed(() =>
  twoLevel.value || topIsSchema.value ? schemaName.value : dbName.value,
)

function fire(): void {
  emit('change', {
    connId: connId.value,
    dialect: dialect.value,
    database: dbName.value,
    schema: resolvedSchema.value,
  })
}

async function meta(parentKind: MetaNodeKind, path: string[]) {
  return client.connections.metadata(connId.value, { parentKind, path })
}

async function onPickConn(): Promise<void> {
  dbName.value = ''
  schemaName.value = ''
  databases.value = []
  schemas.value = []
  topIsSchema.value = false
  fire()
  if (!connId.value) return
  loadingDb.value = true
  try {
    const top = await meta(MetaNodeKind.Connection, [])
    const dbs = top.filter((n) => n.kind === MetaNodeKind.Database)
    const scs = top.filter((n) => n.kind === MetaNodeKind.Schema)
    if (dbs.length) {
      databases.value = dbs.map((n) => n.name)
      // 默认选连接自带的库;否则第一个
      const conn = props.conns.find((c) => c.id === connId.value)
      dbName.value = databases.value.includes(conn?.database ?? '')
        ? (conn?.database as string)
        : (databases.value[0] ?? '')
      await onPickDb()
    } else if (scs.length) {
      // Oracle/DM:顶层直接是 schema
      topIsSchema.value = true
      schemas.value = scs.map((n) => n.name)
      schemaName.value = schemas.value[0] ?? ''
      fire()
    }
  } catch {
    /* 拉不到候选时静默,用户仍可点连接重试 */
  } finally {
    loadingDb.value = false
  }
}

async function onPickDb(): Promise<void> {
  schemaName.value = ''
  schemas.value = []
  if (!twoLevel.value) {
    // 单层:库即 schema
    fire()
    return
  }
  loadingSchema.value = true
  try {
    const list = await meta(MetaNodeKind.Database, [dbName.value])
    schemas.value = list.filter((n) => n.kind === MetaNodeKind.Schema).map((n) => n.name)
    // PG 默认 public
    schemaName.value = schemas.value.includes('public') ? 'public' : (schemas.value[0] ?? '')
  } catch {
    /* ignore */
  } finally {
    loadingSchema.value = false
    fire()
  }
}

watch([dbName, schemaName], fire)
</script>

<template>
  <div class="side">
    <label>{{ label }}</label>
    <select v-model="connId" @change="onPickConn">
      <option value="">{{ '选连接' }}</option>
      <option v-for="c in conns" :key="c.id" :value="c.id">{{ c.name }} · {{ c.dialect }}</option>
    </select>
    <select v-if="databases.length" v-model="dbName" :disabled="loadingDb" @change="onPickDb">
      <option v-for="d in databases" :key="d" :value="d">{{ d }}</option>
    </select>
    <select v-if="(twoLevel || topIsSchema) && schemas.length" v-model="schemaName" :disabled="loadingSchema">
      <option v-for="s in schemas" :key="s" :value="s">{{ s }}</option>
    </select>
    <span v-else-if="(twoLevel || topIsSchema) && connId && !loadingDb && !loadingSchema" class="muted">
      {{ '该库下无 schema' }}
    </span>
  </div>
</template>

<style scoped>
.side {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.side label {
  font-size: 12px;
  color: var(--muted);
}
.side select {
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.muted {
  font-size: 12px;
  color: var(--muted);
}
</style>
