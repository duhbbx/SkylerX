<script setup lang="ts">
import type { DbDialect } from '@db-tool/shared-types'
import { onMounted, ref } from 'vue'
import { useDataClient } from '../data-client'
import {
  type ObjectKind,
  type TableContext,
  objectDdlQuery,
  objectRef,
  objectTemplate,
} from '../ddl'
import { t } from '../i18n'
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
const emit = defineEmits<{ created: []; cancel: [] }>()

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
  const q = objectDdlQuery(props.dialect, props.objectKind, objectRef(props.dialect, props.node))
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
      code.value = String(row.ddl ?? '')
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  await loadDefinition()
  // 新建模式没有 load，要把初始模板当成基线，否则一打开就是 dirty
  resetDirtyBaseline()
})

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
    emit('created')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
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
