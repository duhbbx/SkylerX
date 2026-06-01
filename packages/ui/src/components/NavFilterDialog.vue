<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * #24 NavTree 可见库/Schema 过滤配置.
 *
 * 数据形态: 连接 extra.visibleDatabases?: string[]
 *   - 不设 / 空数组 → 显示全部 (向后兼容)
 *   - 有内容 → 仅显示名字在白名单内的顶层节点
 *   (这里的 "Database" 在 Oracle/DM 实际是 Schema, 因为它们的连接节点直挂 Schema;
 *    字段名用 visibleDatabases 是因为 80% 的方言确实是数据库, Oracle/DM 共用语义.)
 *
 * UI: 弹出后异步 fetch 该连接的顶层元数据(databases/schemas), 渲染 checkbox 列表.
 * 用户勾选 → 保存到 extra → 关闭并触发外层 reload. 取消则不写.
 */
import type { ConnectionConfig, MetadataNode } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import { reportError } from '../errorReporter'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig | null }>()
const emit = defineEmits<{
  close: []
  saved: []
}>()

const client = useDataClient()

const loading = ref(false)
const error = ref<string | null>(null)
/** 顶层节点列表 (databases or schemas, 取决于方言) */
const items = ref<MetadataNode[]>([])
/** 已勾选的名字集. 进入对话框时按 conn.extra.visibleDatabases 初始化;
 *  没设时 = 全部勾选 (因为 "全显示" 等价于 "全勾选"). */
const checked = ref<Set<string>>(new Set())
const saving = ref(false)

const totalCount = computed(() => items.value.length)
const checkedCount = computed(() => checked.value.size)
const allChecked = computed(() => totalCount.value > 0 && checkedCount.value === totalCount.value)
const noneChecked = computed(() => checkedCount.value === 0)

watch(
  () => props.conn,
  async (c) => {
    if (!c) return
    loading.value = true
    error.value = null
    items.value = []
    try {
      const raw = await client.connections.metadata(c.id, {
        parentKind: 'connection' as MetadataNode['kind'],
        path: [],
      })
      // 过滤掉非 Database / Schema 的顶层 (有的方言会塞 'system' 假节点)
      items.value = raw.filter((n) => n.kind === 'database' || n.kind === 'schema')
      const allowed = (c.extra as { visibleDatabases?: unknown })?.visibleDatabases
      if (Array.isArray(allowed) && allowed.length > 0) {
        checked.value = new Set(allowed.filter((x): x is string => typeof x === 'string'))
      } else {
        // 未配置过滤 → 默认全勾, 让用户从全可见状态去取消不要的
        checked.value = new Set(items.value.map((n) => n.name))
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  },
  { immediate: true },
)

function toggle(name: string): void {
  if (checked.value.has(name)) checked.value.delete(name)
  else checked.value.add(name)
  // Trigger reactivity (Set mutation alone doesn't re-evaluate computed)
  checked.value = new Set(checked.value)
}
function selectAll(): void {
  checked.value = new Set(items.value.map((n) => n.name))
}
function selectNone(): void {
  checked.value = new Set()
}

async function save(): Promise<void> {
  if (!props.conn) return
  saving.value = true
  try {
    const isAllChecked = checkedCount.value === totalCount.value
    const restExtra = { ...(props.conn.extra ?? {}) } as Record<string, unknown>
    if (isAllChecked) {
      // 全勾 = 无过滤, 把字段去掉. biome 偏好赋 undefined 而非 delete
      // (在 JSON 序列化层等价 — JSON.stringify 会跳过 undefined 字段).
      restExtra.visibleDatabases = undefined
      restExtra.visibleDatabasesTotal = undefined
    } else {
      // 按 items 顺序保存, 不按 Set 迭代序 (Set 迭代序是 insert 序, 不直观).
      restExtra.visibleDatabases = items.value
        .filter((n) => checked.value.has(n.name))
        .map((n) => n.name)
      // #24: 把"配置时的总数" snapshot 也持久化 — 用于 NavTree 上的 N/M chip,
      // 这样连接未展开时也能立即显示 "3/13" 而不是只 "3". 总数偏好 server-side
      // 视图(database + schema 顶层条目数), 跟 dialog 列出的一致.
      restExtra.visibleDatabasesTotal = items.value.length
    }
    await client.connections.update({
      ...props.conn,
      extra: Object.keys(restExtra).length > 0 ? restExtra : undefined,
    })
    toast.success('已保存可见库/Schema 配置')
    emit('saved')
    emit('close')
  } catch (e) {
    reportError(e, { tag: 'nav-filter-save' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal
    v-if="conn"
    :title="`配置可见库 / Schema · ${conn.name}`"
    width="normal"
    @close="emit('close')"
  >
    <div class="hint">
      勾选要在导航树中显示的项. 未勾选的将被隐藏 (数据本身不删, 任何时候来这里改回即可).
      <br />
      全部勾选 = 不过滤 (默认行为).
    </div>

    <div v-if="loading" class="msg">加载中...</div>
    <div v-else-if="error" class="msg err">读取元数据失败: {{ error }}</div>
    <div v-else-if="items.length === 0" class="msg">该连接没有可过滤的顶层节点.</div>
    <template v-else>
      <div class="bar">
        <span class="count">已选 {{ checkedCount }} / {{ totalCount }}</span>
        <div class="bar-r">
          <button class="link" :disabled="allChecked" @click="selectAll">全选</button>
          <button class="link" :disabled="noneChecked" @click="selectNone">全不选</button>
        </div>
      </div>
      <ul class="list">
        <li v-for="n in items" :key="n.name" class="row">
          <label>
            <input
              type="checkbox"
              :checked="checked.has(n.name)"
              @change="toggle(n.name)"
            />
            <span class="ico">{{ n.kind === 'schema' ? '📂' : '🗄' }}</span>
            <span class="name">{{ n.name }}</span>
          </label>
        </li>
      </ul>
    </template>

    <template #footer>
      <button class="ghost" @click="emit('close')">取消</button>
      <button
        class="primary"
        :disabled="saving || loading || items.length === 0"
        @click="save"
      >
        {{ saving ? '保存中...' : '保存' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.hint {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
  margin-bottom: 12px;
}
.msg {
  padding: 24px 0;
  text-align: center;
  color: var(--muted);
}
.msg.err {
  color: var(--err, #ff6c6c);
  white-space: pre-wrap;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
}
.bar .count {
  color: var(--muted);
}
.bar .bar-r {
  display: flex;
  gap: 8px;
}
.bar .link {
  background: transparent;
  border: none;
  color: var(--accent, #7c6cff);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.bar .link:disabled {
  color: var(--muted);
  cursor: default;
}
.list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 380px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.row {
  border-bottom: 1px solid var(--border);
}
.row:last-child {
  border-bottom: none;
}
.row label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
}
.row label:hover {
  background: rgba(124, 108, 255, 0.08);
}
.row .ico {
  width: 16px;
  text-align: center;
}
.row .name {
  font-size: 13px;
}
button.primary {
  background: var(--accent, #7c6cff);
  color: white;
  border: none;
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
button.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button.ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
button.ghost:hover {
  background: rgba(124, 108, 255, 0.08);
}
</style>
