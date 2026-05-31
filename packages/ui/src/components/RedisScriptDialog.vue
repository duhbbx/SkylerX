<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Lua 脚本 + Redis Functions (7+) 编辑器。
 *
 * Lua tab:
 *  - 编辑器(textarea,简洁就好;monaco 重) + KEYS / ARGV 输入
 *  - 按钮:执行 EVAL,SCRIPT LOAD 拿 sha,EVALSHA <sha>,SCRIPT EXISTS,SCRIPT FLUSH
 *  - 本地保存:scripts[] 存到 localStorage(key='skylerx.redis.lua.<connId>')
 *
 * Functions tab (Redis 7+):
 *  - FUNCTION LIST 列表
 *  - 编辑器粘 library code → FUNCTION LOAD REPLACE
 *  - FUNCTION DELETE <library>
 *  - FUNCTION STATS
 */
import { type ConnectionConfig } from '@db-tool/shared-types'
import { computed, onMounted, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { confirm as appConfirm, prompt as appPrompt, toast } from '../dialog'
import { reportError } from '../errorReporter'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
  /** Lua 默认目标 db;不影响 Functions(它是 server 全局) */
  dbIndex?: number
}>()

const emit = defineEmits<{ close: [] }>()

const client = useDataClient()

type Tab = 'lua' | 'functions'
const tab = ref<Tab>('lua')

// Lua
const luaCode = ref<string>(`-- KEYS[1] = 计数器 key
-- ARGV[1] = 步长
local n = redis.call('INCRBY', KEYS[1], ARGV[1])
return n
`)
const luaKeys = ref('counter:demo')
const luaArgv = ref('5')
const luaResult = ref<{ ok: boolean; out: string; ms?: number } | null>(null)
const luaRunning = ref(false)
const luaSha = ref<string | null>(null)

// 本地保存
interface SavedScript {
  id: string
  name: string
  code: string
  keys: string
  argv: string
  ts: number
}
const saved = ref<SavedScript[]>([])
const savedKey = computed(() => `skylerx.redis.lua.${props.conn.id}`)

function loadSaved(): void {
  try {
    const s = localStorage.getItem(savedKey.value)
    saved.value = s ? (JSON.parse(s) as SavedScript[]) : []
  } catch {
    saved.value = []
  }
}
function persistSaved(): void {
  localStorage.setItem(savedKey.value, JSON.stringify(saved.value))
}

async function call(op: string, args: unknown[], useDb = true): Promise<unknown> {
  const r = await client.connections.executeCommand(props.conn.id, {
    op,
    args,
    context: useDb && props.dbIndex != null ? { dbIndex: props.dbIndex } : {},
  })
  return r.data
}

function parseList(s: string): string[] {
  return s
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

async function runLuaEval(): Promise<void> {
  luaRunning.value = true
  luaResult.value = null
  try {
    const keys = parseList(luaKeys.value)
    const argv = parseList(luaArgv.value)
    const t0 = Date.now()
    const out = await call('EVAL', [luaCode.value, String(keys.length), ...keys, ...argv])
    luaResult.value = { ok: true, out: stringify(out), ms: Date.now() - t0 }
  } catch (e) {
    luaResult.value = { ok: false, out: e instanceof Error ? e.message : String(e) }
  } finally {
    luaRunning.value = false
  }
}

async function loadLua(): Promise<void> {
  try {
    const sha = (await call('SCRIPT', ['LOAD', luaCode.value], false)) as string
    luaSha.value = String(sha)
    toast.success(`SCRIPT LOAD → ${luaSha.value}`)
  } catch (e) {
    reportError(e, { tag: 'redis-script-load' })
  }
}

async function runLuaSha(): Promise<void> {
  if (!luaSha.value) {
    toast.warn('请先 LOAD 拿到 sha')
    return
  }
  luaRunning.value = true
  luaResult.value = null
  try {
    const keys = parseList(luaKeys.value)
    const argv = parseList(luaArgv.value)
    const t0 = Date.now()
    const out = await call('EVALSHA', [luaSha.value, String(keys.length), ...keys, ...argv])
    luaResult.value = { ok: true, out: stringify(out), ms: Date.now() - t0 }
  } catch (e) {
    luaResult.value = { ok: false, out: e instanceof Error ? e.message : String(e) }
  } finally {
    luaRunning.value = false
  }
}

async function flushScripts(): Promise<void> {
  if (!(await appConfirm({ message: '清空 server 端所有缓存的脚本?', variant: 'danger' }))) return
  try {
    await call('SCRIPT', ['FLUSH'], false)
    luaSha.value = null
    toast.success('SCRIPT FLUSH 完成')
  } catch (e) {
    reportError(e)
  }
}

async function saveCurrentLua(): Promise<void> {
  const name = await appPrompt({ message: '脚本名:', defaultValue: `script_${Date.now()}` })
  if (!name) return
  const item: SavedScript = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    code: luaCode.value,
    keys: luaKeys.value,
    argv: luaArgv.value,
    ts: Date.now(),
  }
  saved.value.unshift(item)
  persistSaved()
  toast.success(`已保存 "${name}"`)
}

function applySaved(s: SavedScript): void {
  luaCode.value = s.code
  luaKeys.value = s.keys
  luaArgv.value = s.argv
  luaSha.value = null
  luaResult.value = null
}

function deleteSaved(s: SavedScript): void {
  saved.value = saved.value.filter((x) => x.id !== s.id)
  persistSaved()
}

// Functions
interface FunctionLibrary {
  library_name: string
  engine: string
  functions: string[]
  library_code?: string
}
const fnLibs = ref<FunctionLibrary[]>([])
const fnCode = ref<string>(`#!lua name=mylib
redis.register_function('myadd', function(keys, args)
  return tonumber(args[1]) + tonumber(args[2])
end)
`)
const fnReplace = ref(true)
const fnLoading = ref(false)

async function loadFnList(): Promise<void> {
  fnLoading.value = true
  try {
    // FUNCTION LIST WITHCODE → 数组 of 数组(field,value 交错)
    const raw = (await call('FUNCTION', ['LIST', 'WITHCODE'], false)) as unknown[]
    const out: FunctionLibrary[] = []
    for (const item of raw ?? []) {
      if (!Array.isArray(item)) continue
      const m: Record<string, unknown> = {}
      for (let i = 0; i + 1 < item.length; i += 2) m[String(item[i])] = item[i + 1]
      const funcs: string[] = []
      const flist = m.functions as unknown[]
      if (Array.isArray(flist)) {
        for (const f of flist) {
          if (Array.isArray(f)) {
            const fmap: Record<string, unknown> = {}
            for (let j = 0; j + 1 < f.length; j += 2) fmap[String(f[j])] = f[j + 1]
            if (fmap.name) funcs.push(String(fmap.name))
          }
        }
      }
      out.push({
        library_name: String(m.library_name ?? ''),
        engine: String(m.engine ?? ''),
        functions: funcs,
        library_code: m.library_code ? String(m.library_code) : undefined,
      })
    }
    fnLibs.value = out
  } catch (e) {
    reportError(e, { tag: 'redis-function-list' })
  } finally {
    fnLoading.value = false
  }
}

async function loadFn(): Promise<void> {
  try {
    const args = fnReplace.value ? ['LOAD', 'REPLACE', fnCode.value] : ['LOAD', fnCode.value]
    const r = await call('FUNCTION', args, false)
    toast.success(`FUNCTION LOAD → ${String(r)}`)
    await loadFnList()
  } catch (e) {
    reportError(e, { tag: 'redis-function-load' })
  }
}

async function deleteFnLib(name: string): Promise<void> {
  if (!(await appConfirm({ message: `删除库 "${name}" 及其所有函数?`, variant: 'danger' }))) return
  try {
    await call('FUNCTION', ['DELETE', name], false)
    await loadFnList()
    toast.success(`已删除 ${name}`)
  } catch (e) {
    reportError(e)
  }
}

function viewLibCode(lib: FunctionLibrary): void {
  if (lib.library_code) fnCode.value = lib.library_code
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

onMounted(() => loadSaved())
watch(
  () => props.open,
  (op) => {
    if (op) {
      loadSaved()
      if (tab.value === 'functions') void loadFnList()
    }
  },
)
watch(tab, (t) => {
  if (t === 'functions') void loadFnList()
})
</script>

<template>
  <Modal v-if="open" :title="`Lua / Functions  ·  ${conn.name || conn.dialect}`" width="xl" fixed-height storage-key="redis-script" @close="emit('close')">
    <div class="tabs">
      <button :class="{ on: tab === 'lua' }" @click="tab = 'lua'">Lua 脚本</button>
      <button :class="{ on: tab === 'functions' }" @click="tab = 'functions'">函数库 (Redis 7+)</button>
    </div>

    <!-- Lua -->
    <div v-if="tab === 'lua'" class="body">
      <div class="lua-layout">
        <div class="lua-left">
          <textarea v-model="luaCode" class="code" spellcheck="false" />
          <div class="kv-row">
            <label>KEYS 参数 (用空格分隔):
              <input v-model="luaKeys" class="ip" />
            </label>
            <label>ARGV 参数 (用空格分隔):
              <input v-model="luaArgv" class="ip" />
            </label>
          </div>
          <div class="btn-row">
            <button class="btn-primary" :disabled="luaRunning" @click="runLuaEval">▶ 执行 (EVAL)</button>
            <button class="btn" @click="loadLua" title="把脚本预编译到服务端,返回 SHA 用于 EVALSHA">注入到服务端 (SCRIPT LOAD)</button>
            <button class="btn" :disabled="!luaSha" @click="runLuaSha">按 SHA 执行 (EVALSHA {{ luaSha?.slice(0, 8) ?? '—' }})</button>
            <button class="btn" @click="flushScripts" title="清空服务端缓存的所有脚本">清空脚本缓存 (SCRIPT FLUSH)</button>
            <span class="spacer" />
            <button class="btn" @click="saveCurrentLua">💾 保存到本地</button>
          </div>
          <div v-if="luaResult" class="result" :class="{ err: !luaResult.ok }">
            <span v-if="luaResult.ms != null" class="ms">{{ luaResult.ms }} ms</span>
            <pre>{{ luaResult.out }}</pre>
          </div>
        </div>
        <div class="lua-right">
          <div class="side-title">已保存脚本 ({{ saved.length }})</div>
          <div v-if="!saved.length" class="empty">暂无保存的脚本</div>
          <div v-for="s in saved" :key="s.id" class="saved-row">
            <span class="sr-name" @click="applySaved(s)">{{ s.name }}</span>
            <button class="x-btn" @click="deleteSaved(s)">✕</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Functions -->
    <div v-else class="body">
      <div class="fn-layout">
        <div class="fn-left">
          <div class="side-title">已加载的函数库</div>
          <button class="btn" :disabled="fnLoading" @click="loadFnList">🔄 刷新</button>
          <div v-if="!fnLibs.length" class="empty">服务端尚未加载任何函数库</div>
          <div v-for="lib in fnLibs" :key="lib.library_name" class="lib-row">
            <div class="lib-head">
              <span class="lib-name" @click="viewLibCode(lib)">{{ lib.library_name }}</span>
              <span class="lib-engine">{{ lib.engine }}</span>
              <button class="x-btn" @click="deleteFnLib(lib.library_name)">✕</button>
            </div>
            <div class="lib-funcs">
              <span v-for="f in lib.functions" :key="f" class="fn-tag">{{ f }}</span>
            </div>
          </div>
        </div>
        <div class="fn-right">
          <textarea v-model="fnCode" class="code" spellcheck="false" />
          <div class="btn-row">
            <label class="lbl-inline">
              <input v-model="fnReplace" type="checkbox" />
              覆盖同名库 (REPLACE)
            </label>
            <button class="btn-primary" @click="loadFn">▶ 加载到服务端 (FUNCTION LOAD)</button>
          </div>
          <div class="meta">
            提示:库代码首行需声明 <code>#!lua name=&lt;libname&gt;</code>;在代码里用
            <code>redis.register_function('函数名', 函数体)</code> 注册函数;之后用
            <code>FCALL 函数名 0 参数1 参数2</code> 调用。
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.tabs { display: flex; gap: 4px; padding: 0 0 8px; border-bottom: 1px solid var(--border); margin-bottom: 8px; }
.tabs button { background: transparent; border: 1px solid transparent; color: var(--muted); padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
.tabs button.on { background: rgba(124, 108, 255, 0.18); border-color: var(--accent); color: var(--text); }
.body { flex: 1; overflow: auto; }
.lua-layout, .fn-layout { display: grid; grid-template-columns: 1fr 240px; gap: 12px; }
.lua-right, .fn-left { display: flex; flex-direction: column; gap: 4px; }
.fn-layout { grid-template-columns: 240px 1fr; }
.code { width: 100%; min-height: 220px; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; font-family: var(--font-mono); font-size: 12px; color: var(--text); resize: vertical; }
.kv-row { display: flex; gap: 8px; margin-top: 8px; }
.kv-row label { flex: 1; font-size: 11px; color: var(--muted); display: flex; flex-direction: column; gap: 2px; }
.ip { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; color: var(--text); font-family: var(--font-mono); font-size: 12px; }
.btn-row { display: flex; gap: 6px; align-items: center; margin-top: 8px; }
.lbl-inline { font-size: 11px; color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
.btn, .btn-primary, .btn-ghost { padding: 4px 12px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 12px; background: var(--bg); color: var(--text); }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-ghost { background: transparent; color: var(--muted); padding: 6px 14px; font-size: 13px; }
.spacer { flex: 1; }
.result { margin-top: 8px; padding: 8px 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; max-height: 200px; overflow: auto; }
.result.err { border-color: rgba(224, 64, 80, 0.4); background: rgba(224, 64, 80, 0.06); }
.result pre { margin: 0; font-size: 11px; font-family: var(--font-mono); white-space: pre-wrap; }
.ms { display: inline-block; padding: 1px 6px; margin-right: 6px; font-size: 10px; border-radius: 3px; background: rgba(124, 108, 255, 0.18); color: var(--accent); }
.side-title { font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; margin: 8px 0 4px; }
.empty { color: var(--muted); font-size: 11px; padding: 8px; }
.saved-row, .lib-row { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; background: var(--panel); border-radius: 4px; }
.saved-row { flex-direction: row; align-items: center; gap: 4px; }
.sr-name, .lib-name { flex: 1; cursor: pointer; font-size: 12px; font-family: var(--font-mono); color: var(--accent); }
.sr-name:hover, .lib-name:hover { text-decoration: underline; }
.lib-head { display: flex; align-items: center; gap: 6px; }
.lib-engine { font-size: 10px; color: var(--muted); }
.lib-funcs { display: flex; flex-wrap: wrap; gap: 3px; }
.fn-tag { font-size: 10px; padding: 1px 5px; background: rgba(124, 108, 255, 0.18); border-radius: 2px; color: var(--text); font-family: var(--font-mono); }
.x-btn { background: transparent; border: none; color: var(--muted); cursor: pointer; padding: 0 4px; font-size: 12px; }
.x-btn:hover { color: #e04050; }
.meta { font-size: 10px; color: var(--muted); margin-top: 6px; line-height: 1.5; }
.meta code { background: var(--panel); padding: 1px 4px; border-radius: 2px; }
</style>
