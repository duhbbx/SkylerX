<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * MongoDB aggregation pipeline 可视化:
 *   左侧 stage 列表(顺序敏感),右侧结果表。
 *   每 stage 是独立 JSON 编辑卡片,模板按钮一键插入 $match / $project / $group / $sort / $limit / $lookup / $unwind。
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
  database: string
  collection: string
}>()

const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

interface Stage {
  id: string
  op: string
  json: string
  collapsed?: boolean
}
const stages = ref<Stage[]>([{ id: 's0', op: '$match', json: '{\n  "status": "active"\n}' }])

const limit = ref(50)
const result = ref<unknown[] | null>(null)
const running = ref(false)
const errMsg = ref<string | null>(null)

const STAGE_TEMPLATES: { op: string; tmpl: string }[] = [
  { op: '$match', tmpl: '{\n  "field": "value"\n}' },
  { op: '$project', tmpl: '{\n  "field1": 1,\n  "field2": 1,\n  "_id": 0\n}' },
  {
    op: '$group',
    tmpl: '{\n  "_id": "$category",\n  "count": { "$sum": 1 },\n  "total": { "$sum": "$amount" }\n}',
  },
  { op: '$sort', tmpl: '{\n  "createdAt": -1\n}' },
  { op: '$limit', tmpl: '10' },
  { op: '$skip', tmpl: '0' },
  { op: '$unwind', tmpl: '"$arrayField"' },
  {
    op: '$lookup',
    tmpl: '{\n  "from": "other_coll",\n  "localField": "fk_id",\n  "foreignField": "_id",\n  "as": "joined"\n}',
  },
  { op: '$addFields', tmpl: '{\n  "newField": { "$concat": ["$a", "-", "$b"] }\n}' },
  { op: '$count', tmpl: '"total"' },
]

function addStage(tmpl: { op: string; tmpl: string }): void {
  stages.value.push({
    id: `s${Date.now()}`,
    op: tmpl.op,
    json: tmpl.tmpl,
  })
}
function removeStage(i: number): void {
  stages.value.splice(i, 1)
}
function moveStage(i: number, dir: -1 | 1): void {
  const j = i + dir
  if (j < 0 || j >= stages.value.length) return
  const arr = [...stages.value]
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  stages.value = arr
}

const pipeline = computed(() => {
  const arr: Record<string, unknown>[] = []
  for (const s of stages.value) {
    try {
      const parsed = JSON.parse(s.json)
      arr.push({ [s.op]: parsed })
    } catch {
      // 一个 stage 解析失败时,整个 pipeline 失效(显示错误)
      throw new Error(`stage ${s.op} 的 JSON 解析失败`)
    }
  }
  return arr
})

const pipelinePreview = computed(() => {
  try {
    return JSON.stringify(pipeline.value, null, 2)
  } catch (e) {
    return `// ${e instanceof Error ? e.message : String(e)}`
  }
})

async function run(): Promise<void> {
  running.value = true
  errMsg.value = null
  result.value = null
  try {
    const p = pipeline.value // 触发 catch JSON error
    const r = await client.connections.executeCommand(props.conn.id, {
      op: 'aggregate',
      args: { pipeline: p, options: { allowDiskUse: true, maxTimeMS: 30000 } },
      context: { database: props.database, collection: props.collection },
    })
    const arr = r.data as unknown[]
    result.value = Array.isArray(arr) ? arr.slice(0, limit.value) : []
    toast.success(`返回 ${Array.isArray(arr) ? arr.length : 0} 条`)
  } catch (e) {
    errMsg.value = e instanceof Error ? e.message : String(e)
  } finally {
    running.value = false
  }
}

watch(
  () => props.open,
  (op) => {
    if (op) {
      result.value = null
      errMsg.value = null
    }
  },
)
</script>

<template>
  <Modal v-if="open" :title="`Aggregation  ·  ${database}.${collection}`" width="xl" fixed-height storage-key="mongo-agg" @close="emit('close')">
    <div class="layout">
      <!-- 左:stage 列表 -->
      <div class="stages">
        <div class="side-title">Pipeline ({{ stages.length }} stage)</div>
        <div v-for="(s, i) in stages" :key="s.id" class="stage-card">
          <div class="sc-head">
            <span class="sc-num">{{ i + 1 }}</span>
            <span class="sc-op">{{ s.op }}</span>
            <span class="spacer" />
            <button class="x-btn" :disabled="i === 0" @click="moveStage(i, -1)">↑</button>
            <button class="x-btn" :disabled="i === stages.length - 1" @click="moveStage(i, 1)">↓</button>
            <button class="x-btn" @click="removeStage(i)">✕</button>
          </div>
          <textarea v-model="s.json" class="sc-code" spellcheck="false" />
        </div>

        <div class="add-grid">
          <div class="side-title">添加 stage</div>
          <div class="tmpls">
            <button v-for="t in STAGE_TEMPLATES" :key="t.op" class="tmpl-btn" @click="addStage(t)">
              {{ t.op }}
            </button>
          </div>
        </div>
      </div>

      <!-- 右:结果 -->
      <div class="result-pane">
        <div class="run-bar">
          <button class="btn-primary" :disabled="running" @click="run">▶ 执行</button>
          <label class="lbl-inline">limit
            <input v-model.number="limit" type="number" class="ip-mini" min="1" max="1000" />
          </label>
          <span v-if="result" class="meta">返回 {{ result.length }} 条</span>
          <span class="spacer" />
          <details class="preview">
            <summary>查看 pipeline JSON</summary>
            <pre class="pp-json">{{ pipelinePreview }}</pre>
          </details>
        </div>

        <div v-if="errMsg" class="err-banner">✗ {{ errMsg }}</div>
        <div v-else-if="running" class="empty">运行中…</div>
        <pre v-else-if="result" class="result-json">{{ JSON.stringify(result, null, 2) }}</pre>
        <div v-else class="empty">点 ▶ 执行查看结果</div>
      </div>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: 340px 1fr; gap: 12px; height: 100%; }
.stages, .result-pane { display: flex; flex-direction: column; gap: 8px; overflow: auto; }
.side-title { font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; }
.stage-card { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 6px; }
.sc-head { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; }
.sc-num { width: 18px; height: 18px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 10px; display: inline-flex; align-items: center; justify-content: center; }
.sc-op { font-family: var(--font-mono); color: var(--accent); font-size: 12px; font-weight: 600; }
.spacer { flex: 1; }
.x-btn { background: transparent; border: none; color: var(--muted); cursor: pointer; padding: 0 4px; font-size: 12px; }
.x-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.x-btn:hover:not(:disabled) { color: var(--accent); }
.sc-code { width: 100%; min-height: 70px; padding: 6px 8px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; font-family: var(--font-mono); font-size: 11px; color: var(--text); resize: vertical; }
.add-grid { padding: 6px; background: rgba(124, 108, 255, 0.06); border-radius: 6px; }
.tmpls { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
.tmpl-btn { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--accent); font-family: var(--font-mono); font-size: 11px; padding: 2px 8px; cursor: pointer; }
.tmpl-btn:hover { background: rgba(124, 108, 255, 0.18); }
.run-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--panel); border-radius: 6px; }
.btn-primary { background: var(--accent); color: #fff; border: 1px solid var(--accent); padding: 4px 14px; border-radius: 4px; font-size: 12px; cursor: pointer; }
.lbl-inline { font-size: 11px; color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
.ip-mini { width: 60px; padding: 3px 6px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-size: 12px; }
.meta { font-size: 11px; color: var(--muted); }
.preview summary { font-size: 11px; cursor: pointer; color: var(--muted); }
.pp-json { margin-top: 4px; padding: 6px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; font-family: var(--font-mono); font-size: 10px; max-height: 200px; overflow: auto; max-width: 400px; }
.empty { padding: 30px; text-align: center; color: var(--muted); }
.err-banner { padding: 10px; background: rgba(224, 64, 80, 0.08); border: 1px solid rgba(224, 64, 80, 0.4); border-radius: 6px; color: var(--err, #e04050); font-size: 12px; }
.result-json { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 10px; font-family: var(--font-mono); font-size: 11px; max-height: 500px; overflow: auto; margin: 0; }
.btn-ghost { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--muted); font-size: 13px; cursor: pointer; }
</style>
