<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Redis 新建 key 弹窗。
 *
 * 五种数据结构(string/hash/list/set/zset),每种对应一条 Redis 命令一次性写入;
 * TTL 可选(秒),> 0 时弹窗提交后追加一次 EXPIRE key ttl。
 *
 * 不支持 stream:XADD 需要 entry id + field/value,语义太重,且常规"新建"场景多为
 * KV/Hash/List/Set/Zset 而非 stream;stream 可在 RedisPane 命令输入框直接 XADD。
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
  dbIndex: number
}>()

const emit = defineEmits<{
  /** 关闭弹窗(取消) */
  close: []
  /** 成功创建,通知外层刷新对应类型组节点 */
  created: [type: RedisType, key: string]
}>()

type RedisType = 'string' | 'hash' | 'list' | 'set' | 'zset'

const client = useDataClient()

const keyName = ref('')
const type = ref<RedisType>('string')
const ttlSec = ref<number | null>(null)
const submitting = ref(false)

// string:单一字符串 value
const strVal = ref('')

// hash:字段-值列表,至少一对
const hashRows = ref<{ field: string; value: string }[]>([{ field: '', value: '' }])

// list / set:每行一个元素
const listLines = ref('')

// zset:每行 "score member"
const zsetLines = ref('')

const typeOptions: { value: RedisType; label: string; hint: string }[] = [
  { value: 'string', label: 'String', hint: 'SET key value' },
  { value: 'hash', label: 'Hash', hint: 'HSET key field value [...]' },
  { value: 'list', label: 'List', hint: 'RPUSH key v1 v2 ...' },
  { value: 'set', label: 'Set', hint: 'SADD key m1 m2 ...' },
  { value: 'zset', label: 'Sorted Set', hint: 'ZADD key score1 m1 score2 m2 ...' },
]

const canSubmit = computed(() => {
  if (!keyName.value.trim() || submitting.value) return false
  if (type.value === 'string') return true // 允许空字符串
  if (type.value === 'hash') return hashRows.value.some((r) => r.field.trim())
  if (type.value === 'list' || type.value === 'set') return listLines.value.trim().length > 0
  if (type.value === 'zset') {
    return zsetLines.value
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .every((l) => {
        const parts = l.split(/\s+/)
        return parts.length >= 2 && !Number.isNaN(Number(parts[0]))
      })
  }
  return false
})

function addHashRow(): void {
  hashRows.value.push({ field: '', value: '' })
}
function removeHashRow(i: number): void {
  if (hashRows.value.length > 1) hashRows.value.splice(i, 1)
}

function call(op: string, args: unknown[]): Promise<unknown> {
  return client.connections.executeCommand(props.conn.id, {
    op,
    args,
    context: { dbIndex: props.dbIndex },
  })
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  const key = keyName.value.trim()
  submitting.value = true
  try {
    // 1. 预检:不允许覆盖已存在 key
    const exists = (await call('EXISTS', [key])) as { data: number } | unknown
    const existsCount = typeof exists === 'object' && exists && 'data' in (exists as any) ? Number((exists as any).data) : 0
    if (existsCount > 0) {
      toast.error(`key "${key}" 已存在,请改名或先删除`)
      return
    }
    // 2. 按类型写入
    if (type.value === 'string') {
      await call('SET', [key, strVal.value])
    } else if (type.value === 'hash') {
      const args: string[] = [key]
      for (const row of hashRows.value) {
        if (!row.field.trim()) continue
        args.push(row.field, row.value)
      }
      await call('HSET', args)
    } else if (type.value === 'list') {
      const items = listLines.value
        .split(/\r?\n/)
        .map((l) => l.replace(/\r$/, ''))
        .filter((l) => l.length > 0)
      await call('RPUSH', [key, ...items])
    } else if (type.value === 'set') {
      const items = listLines.value
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
      await call('SADD', [key, ...items])
    } else if (type.value === 'zset') {
      const args: string[] = [key]
      for (const line of zsetLines.value.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const m = trimmed.match(/^(\S+)\s+(.+)$/)
        if (!m) continue
        args.push(m[1], m[2])
      }
      await call('ZADD', args)
    }
    // 3. TTL(可选)
    if (ttlSec.value != null && ttlSec.value > 0) {
      await call('EXPIRE', [key, String(ttlSec.value)])
    }
    toast.success(`已创建 ${type.value} key: ${key}`)
    emit('created', type.value, key)
    emit('close')
  } catch (e) {
    toast.error(`创建失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    submitting.value = false
  }
}

// 弹窗打开时复位
watch(
  () => props.open,
  (op) => {
    if (op) {
      keyName.value = ''
      type.value = 'string'
      ttlSec.value = null
      strVal.value = ''
      hashRows.value = [{ field: '', value: '' }]
      listLines.value = ''
      zsetLines.value = ''
    }
  },
)
</script>

<template>
  <Modal v-if="open" :title="`新建 Redis key  ·  db${dbIndex}`" width="medium" @close="emit('close')">
    <div class="form">
      <div class="row">
        <label class="lbl">key 名</label>
        <input v-model="keyName" class="ip" placeholder="例如 user:1001 / cache:home:v1" autofocus />
      </div>

      <div class="row">
        <label class="lbl">类型</label>
        <div class="type-grid">
          <label
            v-for="opt in typeOptions"
            :key="opt.value"
            class="type-card"
            :class="{ on: type === opt.value }"
          >
            <input v-model="type" type="radio" :value="opt.value" />
            <div class="tc-name">{{ opt.label }}</div>
            <div class="tc-hint">{{ opt.hint }}</div>
          </label>
        </div>
      </div>

      <div class="row">
        <label class="lbl">过期 (TTL)</label>
        <div class="ttl-row">
          <input
            v-model.number="ttlSec"
            class="ip ttl-ip"
            type="number"
            min="0"
            placeholder="秒,留空 = 不过期"
          />
          <span class="meta">留空或 0 = 永不过期</span>
        </div>
      </div>

      <!-- 类型分支:每种类型一种输入面板 -->
      <div v-if="type === 'string'" class="row">
        <label class="lbl">value</label>
        <textarea v-model="strVal" class="ta" placeholder="任意字符串(支持多行)" rows="4" />
      </div>

      <div v-else-if="type === 'hash'" class="row">
        <label class="lbl">字段</label>
        <div class="hash-list">
          <div v-for="(r, i) in hashRows" :key="i" class="hash-row">
            <input v-model="r.field" class="ip" placeholder="field" />
            <input v-model="r.value" class="ip" placeholder="value" />
            <button
              class="rm"
              :disabled="hashRows.length <= 1"
              title="删除此行"
              @click="removeHashRow(i)"
            >×</button>
          </div>
          <button class="add" @click="addHashRow">+ 添加字段</button>
        </div>
      </div>

      <div v-else-if="type === 'list' || type === 'set'" class="row">
        <label class="lbl">{{ type === 'list' ? '元素 (按 RPUSH 顺序)' : '成员 (自动去重)' }}</label>
        <textarea
          v-model="listLines"
          class="ta"
          rows="6"
          placeholder="每行一个元素&#10;a&#10;b&#10;c"
        />
      </div>

      <div v-else-if="type === 'zset'" class="row">
        <label class="lbl">成员 (score 在前)</label>
        <textarea
          v-model="zsetLines"
          class="ta"
          rows="6"
          placeholder="每行格式: <score> <member>&#10;1 alice&#10;2 bob"
        />
      </div>
    </div>

    <template #footer>
      <button class="btn-ghost" :disabled="submitting" @click="emit('close')">取消</button>
      <button class="btn-primary" :disabled="!canSubmit" @click="submit">
        {{ submitting ? '创建中…' : '创建' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lbl {
  font-size: 12px;
  color: var(--muted);
  font-weight: 600;
}
.ip,
.ta {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  padding: 6px 10px;
  font-size: 13px;
  font-family: ui-monospace, monospace;
}
.ta {
  resize: vertical;
  min-height: 80px;
}
.type-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}
.type-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 6px;
  cursor: pointer;
  text-align: center;
  background: var(--bg);
}
.type-card.on {
  border-color: var(--accent);
  background: rgba(124, 108, 255, 0.14);
}
.type-card input {
  display: none;
}
.tc-name {
  font-size: 12px;
  font-weight: 600;
}
.tc-hint {
  font-size: 10px;
  color: var(--muted);
  font-family: ui-monospace, monospace;
  margin-top: 2px;
}
.ttl-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ttl-ip {
  width: 140px;
}
.meta {
  font-size: 11px;
  color: var(--muted);
}
.hash-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hash-row {
  display: grid;
  grid-template-columns: 1fr 1fr 30px;
  gap: 6px;
}
.rm {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}
.rm:hover:not(:disabled) {
  color: #e04050;
  border-color: rgba(224, 64, 80, 0.4);
}
.rm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.add {
  align-self: flex-start;
  background: transparent;
  border: 1px dashed var(--border);
  color: var(--muted);
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
.add:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.btn-ghost,
.btn-primary {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--border);
}
.btn-ghost {
  background: transparent;
  color: var(--muted);
}
.btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
