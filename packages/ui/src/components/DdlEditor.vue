<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DbDialect } from '@db-tool/shared-types'
import { type SqlLanguage, format as sqlFormat } from 'sql-formatter'
import { onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import {
  type ObjectKind,
  type TableContext,
  objectDdlQuery,
  objectRef,
  objectTemplate,
} from '../ddl'
import { toast } from '../dialog'
import { reportInlineError } from '../errorReporter'
import { t } from '../i18n'
import { settings } from '../settings'
import SqlEditor from './SqlEditor.vue'
import type { TreeNode } from './treeNode'

const client = useDataClient()

const props = withDefaults(
  defineProps<{
    connId: string
    dialect: DbDialect
    objectKind: ObjectKind
    ctx: TableContext
    /** 'create' 新建（默认）；'edit' 载入现有定义编辑 */
    mode?: 'create' | 'edit'
    node?: TreeNode
  }>(),
  { mode: 'create', node: undefined },
)
const emit = defineEmits<{ created: [opts?: { keepOpen?: boolean }]; cancel: [] }>()

const isEdit = props.mode === 'edit'
const code = ref(isEdit ? '' : objectTemplate(props.dialect, props.objectKind, props.ctx))
const busy = ref(false)
const loading = ref(false)
const error = ref<string | null>(null)

const target = [props.ctx.database, props.ctx.schema].filter(Boolean).join(' / ')

/** 脏检查：把当前 code 与上次载入/保存后的快照比对，关闭 tab 时由父组件调用决定是否提示。 */
const dirtyBaseline = ref('')
function resetDirtyBaseline(): void {
  dirtyBaseline.value = code.value
}
function isDirty(): boolean {
  return dirtyBaseline.value !== '' && code.value !== dirtyBaseline.value
}
defineExpose({ isDirty })

/** 编辑模式：拉取现有对象定义为可执行 DDL。 */
async function loadDefinition(): Promise<void> {
  if (!isEdit || !props.node) return
  const q = objectDdlQuery(
    props.dialect,
    props.objectKind,
    objectRef(props.dialect, props.node),
    props.node,
  )
  if (!q) {
    error.value = t('ddl.unsupported')
    return
  }
  loading.value = true
  try {
    const r = await client.connections.execute(props.connId, q.sql, [], {
      database: props.ctx.database,
      schema: props.ctx.schema,
    })
    const row = r.rows[0] as Record<string, unknown> | undefined
    if (!row) throw new Error(t('ddl.noDef'))
    if (q.mode === 'showCreate') {
      const key = Object.keys(row).find((k) => /^create/i.test(k))
      code.value = String(row[key ?? ''] ?? '')
    } else if (q.mode === 'viewdef') {
      code.value = (q.prefix ?? '') + String(row.ddl ?? '')
    } else {
      // 'funcdef' (PG) 或 'oracle-ddl' — 都直接读 row.ddl
      code.value = String(row.ddl ?? '').trim()
    }
  } catch (e) {
    reportInlineError(error, e)
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  await loadDefinition()
  // 新建模式没有 load，要把初始模板当成基线，否则一打开就是 dirty
  resetDirtyBaseline()
})

/**
 * 方言 → sql-formatter 语言（与 QueryPane.fmtLang 一致；不抽公共是为了让本组件
 * 不依赖 QueryPane 的内部 helper，独立可移植；将来要复用再抽到 packages/ui/src/sql-fmt.ts）。
 */
function fmtLang(d: string): SqlLanguage {
  if (['mysql', 'mariadb', 'oceanbase', 'tidb'].includes(d)) return 'mysql'
  if (['postgresql', 'kingbase', 'cockroachdb', 'greenplum', 'opengauss', 'h2'].includes(d))
    return 'postgresql'
  if (d === 'sqlserver') return 'transactsql'
  if (['oracle', 'dm'].includes(d)) return 'plsql'
  return 'sql'
}

/**
 * 格式化当前 DDL（按方言 + 用户偏好的关键字大小写）。
 * 解析失败（半截语句 / 含未支持的方言扩展语法）则保持原样、不阻断用户编辑。
 */
function formatDdl(): void {
  if (!code.value.trim()) return
  try {
    code.value = sqlFormat(code.value, {
      language: fmtLang(props.dialect),
      keywordCase: settings.keywordCase,
    })
  } catch {
    /* 格式化失败保持原样 */
  }
}

async function create(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    // 整段作为单条语句执行（函数/存储过程体含分号，不能按分号拆）
    await client.connections.execute(props.connId, code.value, [], {
      database: props.ctx.database,
      schema: props.ctx.schema,
    })
    resetDirtyBaseline() // 保存成功 → 基线对齐
    // 用户报告: 保存后不要关 tab, 留在编辑器里继续编辑. 走 toast 提示成功;
    // keepOpen 传给上层 onCreated, QueryTabs 见 keepOpen 不会 close(tab.id).
    toast.success(isEdit ? (t('common.saved') ?? '已保存') : (t('common.created') ?? '已创建'))
    emit('created', { keepOpen: true })
  } catch (e) {
    reportInlineError(error, e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="ddl">
    <div class="toolbar">
      <button class="primary" :disabled="busy || loading" @click="create">
        {{ busy ? t('ddl.executing') : isEdit ? t('ddl.saveExec') : t('ddl.create') }}
      </button>
      <button
        class="ghost"
        :disabled="loading || !code.trim()"
        :title="t('ddl.formatHint')"
        @click="formatDdl"
      >
        {{ t('ddl.format') }}
      </button>
      <button class="ghost" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <span v-if="loading" class="target">{{ t('ddl.loadingDef') }}</span>
      <span v-else-if="target" class="target">{{ t('ddl.location', { target }) }}</span>
    </div>
    <div class="editor">
      <SqlEditor v-model="code" @run="create" />
    </div>
    <div v-if="error" class="banner err">✗ {{ error }}</div>
  </div>
</template>

<style scoped>
.ddl {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}
.toolbar button {
  padding: 4px 12px;
  font-size: 13px;
}
.toolbar .target {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
}
.editor {
  flex: 1;
  min-height: 0;
}
.banner.err {
  margin: 0;
  border-radius: 0;
}
</style>
