<script setup lang="ts">
import type { DbDialect } from '@db-tool/shared-types'
import { ref } from 'vue'
import { type ObjectKind, type TableContext, objectTemplate } from '../ddl'
import SqlEditor from './SqlEditor.vue'

const props = defineProps<{
  connId: string
  dialect: DbDialect
  objectKind: ObjectKind
  ctx: TableContext
}>()
const emit = defineEmits<{ created: []; cancel: [] }>()

const code = ref(objectTemplate(props.dialect, props.objectKind, props.ctx))
const busy = ref(false)
const error = ref<string | null>(null)

const target = [props.ctx.database, props.ctx.schema].filter(Boolean).join(' / ')

async function create(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    // 整段作为单条语句执行（函数/存储过程体含分号，不能按分号拆）
    await window.api.connections.execute(props.connId, code.value, [], {
      database: props.ctx.database,
      schema: props.ctx.schema,
    })
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
      <button class="primary" :disabled="busy" @click="create">{{ busy ? '创建中…' : '创建' }}</button>
      <button class="ghost" @click="emit('cancel')">取消</button>
      <span v-if="target" class="target">位置：{{ target }}</span>
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
