<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Redis 导入/导出 JSON。两个 mode 共享一个对话框。
 *
 * 导出:
 *   SCAN 当前 db(支持 MATCH 过滤)→ 对每个 key 拉 TYPE + 对应结构数据 + TTL
 *   → 输出 JSON 文件 [{db, key, type, ttl, value}]
 *
 * 导入:
 *   解析 JSON 文件 → 按 type 还原命令(SET/HSET/RPUSH/SADD/ZADD/XADD)
 *   冲突策略:skip / overwrite(默认 skip)
 *
 * 注意:
 *  - stream 仅尝试还原 XADD,consumer group 不带
 *  - 大库导出可能很慢/内存大,建议加 MATCH 过滤
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
  mode: 'import' | 'export'
}>()

const emit = defineEmits<{
  close: []
  /** 导入/导出完成,通知外层刷新当前 db */
  done: []
}>()

const client = useDataClient()

interface ExportItem {
  db: number
  key: string
  type: string
  ttl: number
  value: unknown
}

const pattern = ref('*')
const conflictMode = ref<'skip' | 'overwrite'>('skip')
const running = ref(false)
const progress = ref<{ scanned: number; processed: number; total?: number } | null>(null)
const errors = ref<string[]>([])

async function call(op: string, args: unknown[]): Promise<unknown> {
  const r = await client.connections.executeCommand(props.conn.id, {
    op,
    args,
    context: { dbIndex: props.dbIndex },
  })
  return r.data
}

/** 把单个 key 的全部数据导出成 ExportItem(支持 string/hash/list/set/zset/stream)。 */
async function dumpKey(key: string): Promise<ExportItem | null> {
  const type = String(await call('TYPE', [key]))
  if (type === 'none') return null
  const ttl = Number(await call('TTL', [key]))
  let value: unknown = null
  if (type === 'string') {
    value = await call('GET', [key])
  } else if (type === 'hash') {
    const flat = (await call('HGETALL', [key])) as unknown
    const map: Record<string, string> = {}
    if (Array.isArray(flat)) {
      for (let i = 0; i + 1 < flat.length; i += 2) map[String(flat[i])] = String(flat[i + 1] ?? '')
    } else if (flat && typeof flat === 'object') {
      for (const [k, v] of Object.entries(flat as Record<string, unknown>)) map[k] = String(v ?? '')
    }
    value = map
  } else if (type === 'list') {
    const arr = (await call('LRANGE', [key, '0', '-1'])) as unknown[]
    value = arr.map((x) => String(x))
  } else if (type === 'set') {
    const arr = (await call('SMEMBERS', [key])) as unknown[]
    value = arr.map((x) => String(x))
  } else if (type === 'zset') {
    const arr = (await call('ZRANGE', [key, '0', '-1', 'WITHSCORES'])) as unknown[]
    const pairs: { member: string; score: string }[] = []
    for (let i = 0; i + 1 < arr.length; i += 2) {
      pairs.push({ member: String(arr[i]), score: String(arr[i + 1] ?? '0') })
    }
    value = pairs
  } else if (type === 'stream') {
    const raw = (await call('XRANGE', [key, '-', '+'])) as unknown[]
    const entries: { id: string; fields: [string, string][] }[] = []
    for (const item of raw) {
      if (!Array.isArray(item) || item.length < 2) continue
      const id = String(item[0])
      const flat = Array.isArray(item[1]) ? (item[1] as unknown[]) : []
      const fields: [string, string][] = []
      for (let i = 0; i + 1 < flat.length; i += 2) {
        fields.push([String(flat[i]), String(flat[i + 1] ?? '')])
      }
      entries.push({ id, fields })
    }
    value = entries
  }
  return { db: props.dbIndex, key, type, ttl, value }
}

async function doExport(): Promise<void> {
  running.value = true
  progress.value = { scanned: 0, processed: 0 }
  errors.value = []
  const items: ExportItem[] = []
  try {
    let cursor = '0'
    do {
      const r = (await call('SCAN', [cursor, 'MATCH', pattern.value.trim() || '*', 'COUNT', '500'])) as [string, string[]]
      cursor = String(r?.[0] ?? '0')
      const batch = (r?.[1] ?? []) as string[]
      progress.value.scanned += batch.length
      // 串行 dump,避免一次性几十个 IPC
      for (const key of batch) {
        try {
          const it = await dumpKey(key)
          if (it) items.push(it)
        } catch (e) {
          errors.value.push(`${key}: ${e instanceof Error ? e.message : String(e)}`)
        }
        progress.value.processed++
      }
    } while (cursor !== '0')

    // 走自定义 SaveFileDialog
    const filename = `redis_${props.conn.name || 'export'}_db${props.dbIndex}_${Date.now()}.json`
    const path = await client.files.saveText({
      defaultName: filename,
      content: JSON.stringify(items, null, 2),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (path) {
      toast.success(`已导出 ${items.length} 个 key → ${path}`)
      emit('done')
    }
  } catch (e) {
    toast.error(`导出失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    running.value = false
    progress.value = null
  }
}

async function doImport(): Promise<void> {
  const desktopApi = (window as unknown as { api?: { files?: { openText?: (filters: unknown) => Promise<{ name: string; content: string } | null> } } })?.api
  const openText = desktopApi?.files?.openText
  if (!openText) {
    toast.error('文件 API 不可用')
    return
  }
  const file = await openText([{ name: 'JSON', extensions: ['json'] }])
  if (!file) return

  let items: ExportItem[] = []
  try {
    items = JSON.parse(file.content) as ExportItem[]
    if (!Array.isArray(items)) throw new Error('文件根必须是数组')
  } catch (e) {
    toast.error(`JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`)
    return
  }

  running.value = true
  progress.value = { scanned: items.length, processed: 0, total: items.length }
  errors.value = []
  try {
    for (const it of items) {
      try {
        // 冲突处理
        const exists = Number(await call('EXISTS', [it.key]))
        if (exists > 0) {
          if (conflictMode.value === 'skip') {
            progress.value.processed++
            continue
          }
          await call('DEL', [it.key])
        }
        if (it.type === 'string') {
          await call('SET', [it.key, String(it.value ?? '')])
        } else if (it.type === 'hash') {
          const map = it.value as Record<string, string>
          const args: string[] = [it.key]
          for (const [f, v] of Object.entries(map)) args.push(f, v)
          if (args.length > 1) await call('HSET', args)
        } else if (it.type === 'list') {
          const arr = it.value as string[]
          if (arr.length) await call('RPUSH', [it.key, ...arr])
        } else if (it.type === 'set') {
          const arr = it.value as string[]
          if (arr.length) await call('SADD', [it.key, ...arr])
        } else if (it.type === 'zset') {
          const arr = it.value as { member: string; score: string }[]
          const args: string[] = [it.key]
          for (const p of arr) args.push(p.score, p.member)
          if (args.length > 1) await call('ZADD', args)
        } else if (it.type === 'stream') {
          const entries = it.value as { id: string; fields: [string, string][] }[]
          for (const e of entries) {
            const fa: string[] = [it.key, e.id]
            for (const [fk, fv] of e.fields) fa.push(fk, fv)
            await call('XADD', fa)
          }
        }
        if (it.ttl > 0) await call('EXPIRE', [it.key, String(it.ttl)])
      } catch (e) {
        errors.value.push(`${it.key}: ${e instanceof Error ? e.message : String(e)}`)
      }
      progress.value.processed++
    }
    toast.success(`已导入 ${items.length - errors.value.length} / ${items.length} 个 key`)
    emit('done')
  } finally {
    running.value = false
    progress.value = null
  }
}

const percent = computed(() => {
  if (!progress.value) return 0
  const total = progress.value.total ?? progress.value.scanned
  if (!total) return 0
  return Math.round((progress.value.processed / total) * 100)
})

watch(
  () => props.open,
  (op) => {
    if (op) {
      pattern.value = '*'
      conflictMode.value = 'skip'
      errors.value = []
      progress.value = null
    }
  },
)
</script>

<template>
  <Modal
    v-if="open"
    :title="`${mode === 'export' ? '导出' : '导入'} JSON  ·  db${dbIndex}`"
    width="medium"
    @close="emit('close')"
  >
    <div class="form">
      <template v-if="mode === 'export'">
        <div class="row">
          <label class="lbl">MATCH 模式 (可选)</label>
          <input v-model="pattern" class="ip" placeholder="* = 全部" />
          <div class="meta">用 SCAN MATCH 过滤;空 = 当前 db 全部 key</div>
        </div>
      </template>
      <template v-else>
        <div class="row">
          <label class="lbl">冲突处理</label>
          <div class="seg">
            <label class="seg-opt" :class="{ on: conflictMode === 'skip' }">
              <input v-model="conflictMode" type="radio" value="skip" />跳过(默认)
            </label>
            <label class="seg-opt" :class="{ on: conflictMode === 'overwrite' }">
              <input v-model="conflictMode" type="radio" value="overwrite" />覆盖(先 DEL)
            </label>
          </div>
          <div class="meta">点"开始导入"会先打开文件选择对话框</div>
        </div>
      </template>

      <div v-if="progress" class="progress">
        <div class="pb">
          <div class="pb-fill" :style="{ width: `${percent}%` }" />
        </div>
        <div class="meta">
          {{ mode === 'export' ? '扫描' : '导入' }}: {{ progress.processed }} / {{ progress.total ?? progress.scanned }}
        </div>
      </div>

      <div v-if="errors.length" class="err-list">
        <div class="err-title">⚠ {{ errors.length }} 条错误</div>
        <pre class="err-body">{{ errors.slice(0, 50).join('\n') }}{{ errors.length > 50 ? `\n…(共 ${errors.length} 条)` : '' }}</pre>
      </div>
    </div>

    <template #footer>
      <button class="btn-ghost" :disabled="running" @click="emit('close')">关闭</button>
      <button v-if="mode === 'export'" class="btn-primary" :disabled="running" @click="doExport">
        {{ running ? '导出中…' : '▶ 开始导出' }}
      </button>
      <button v-else class="btn-primary" :disabled="running" @click="doImport">
        {{ running ? '导入中…' : '▶ 选择文件并导入' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lbl {
  font-size: 12px;
  color: var(--muted);
  font-weight: 600;
}
.ip {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text);
}
.meta {
  font-size: 11px;
  color: var(--muted);
}
.seg {
  display: flex;
  gap: 6px;
}
.seg-opt {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.seg-opt.on {
  background: rgba(124, 108, 255, 0.18);
  border-color: var(--accent);
}
.seg-opt input {
  display: none;
}
.progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pb {
  height: 8px;
  background: var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.pb-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.1s ease-out;
}
.err-list {
  border: 1px solid rgba(224, 64, 80, 0.4);
  border-radius: 6px;
  padding: 8px;
  background: rgba(224, 64, 80, 0.06);
}
.err-title {
  color: #e04050;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
}
.err-body {
  margin: 0;
  font-size: 11px;
  font-family: var(--font-mono);
  max-height: 120px;
  overflow: auto;
  white-space: pre-wrap;
}
.btn-ghost,
.btn-primary {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
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
.btn-primary:disabled,
.btn-ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
