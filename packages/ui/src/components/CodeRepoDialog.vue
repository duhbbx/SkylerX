<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ConnectionConfig } from '@db-tool/shared-types'
import { ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import { t } from '../i18n'
import { canEmbed } from '../ai'
import { getRepoPath, refreshCodeIndex, setRepoPath } from '../rag/codeRepo'
import { runCodeRepoBuild } from '../rag/codeRepoBuild'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig; container: string }>()
const emit = defineEmits<{ close: []; saved: [ConnectionConfig] }>()

const client = useDataClient()
const path = ref(getRepoPath(props.conn, props.container) ?? '')
const busy = ref(false)
const status = ref('')
const error = ref('')
const savedConn = ref<ConnectionConfig | null>(null)

watch(path, (nextPath) => {
  const savedRoot = savedConn.value && getRepoPath(savedConn.value, props.container)
  if (savedRoot && nextPath.trim() !== savedRoot) {
    savedConn.value = null
    status.value = ''
  }
})

async function pick(): Promise<void> {
  const picked = await client.files.selectFile?.({ directory: true })
  if (picked) path.value = picked
}

/** 保存绑定路径到 connection.extra(过 IPC 前已是纯对象:JSON 深拷贝剥掉响应式 Proxy)。 */
async function persist(p: string): Promise<ConnectionConfig> {
  const next = setRepoPath(savedConn.value ?? props.conn, props.container, p)
  return await client.connections.update(
    JSON.parse(JSON.stringify(next)) as ConnectionConfig,
  )
}

async function build(): Promise<void> {
  const buildPath = path.value
  const previousStatus = status.value
  busy.value = true
  status.value = t('coderepo.building')
  error.value = ''
  try {
    const result = await runCodeRepoBuild(buildPath, {
      persist,
      refresh: (root) => refreshCodeIndex(client, props.conn.id, props.container, root, {
        nowMs: Date.now(),
        onProgress: (done, total) => {
          status.value = t('coderepo.progress', { done: String(done), total: String(total) })
        },
      }),
    })
    if (path.value.trim() !== result.root) {
      status.value = ''
      return
    }

    const r = result.refresh
    status.value =
      t('coderepo.status', {
        files: String(r.fileCount),
        chunks: String(r.index.chunks.length),
        mode: r.mode,
      }) + (r.capped ? ` ${t('coderepo.capped')}` : '')
    savedConn.value = result.saved
    toast.success(t('coderepo.saved'))
  } catch (e) {
    status.value = path.value === buildPath ? previousStatus : ''
    if (e instanceof Error && e.message === 'CODE_REPO_PATH_REQUIRED') {
      toast.warn(t('coderepo.noPath'))
      return
    }
    error.value = e instanceof Error && e.message === 'CODE_INDEX_STORAGE_FULL'
      ? t('coderepo.storageFull')
      : e instanceof Error
        ? e.message
        : String(e)
    toast.warn(error.value)
  } finally {
    busy.value = false
  }
}

async function unbind(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    const saved = await persist('')
    path.value = ''
    status.value = ''
    toast.success(t('coderepo.saved'))
    emit('saved', saved)
    emit('close')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    toast.warn(error.value)
  } finally {
    busy.value = false
  }
}

function done(): void {
  if (savedConn.value) emit('saved', savedConn.value)
}
</script>

<template>
  <Modal :title="t('coderepo.title')" width="medium" @close="emit('close')">
    <div class="coderepo">
      <p class="desc">{{ t('coderepo.desc') }}</p>
      <label class="lbl">{{ t('coderepo.folder') }}</label>
      <div class="row">
        <input v-model="path" class="path" :disabled="busy" :placeholder="t('coderepo.noPath')" />
        <button class="ghost" :disabled="busy" @click="pick">{{ t('coderepo.pick') }}</button>
      </div>
      <div v-if="status" class="status">{{ status }}</div>
      <div v-if="error" class="error">{{ error }}</div>
      <div v-if="!canEmbed()" class="privacy">{{ t('coderepo.privacy') }}</div>
    </div>
    <template #footer>
      <button v-if="getRepoPath(savedConn ?? props.conn, props.container)" class="ghost" :disabled="busy" @click="unbind">
        {{ t('coderepo.unbind') }}
      </button>
      <span class="grow" />
      <button class="ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button :class="savedConn ? 'ghost' : 'primary'" :disabled="busy || !path.trim()" @click="build">
        {{ busy ? t('coderepo.building') : t('coderepo.build') }}
      </button>
      <button v-if="savedConn" class="primary" :disabled="busy" @click="done">{{ t('common.done') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.coderepo { display: flex; flex-direction: column; gap: 10px; }
.coderepo .desc { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
.coderepo .lbl { font-size: 12px; color: var(--muted); }
.coderepo .row { display: flex; gap: 6px; }
.coderepo .path {
  flex: 1; min-width: 0; background: var(--bg); border: 1px solid var(--border);
  border-radius: 6px; color: var(--text); padding: 6px 8px; font-family: var(--font-mono); font-size: 12px;
}
.coderepo .status { font-size: 12px; color: var(--text); }
.coderepo .error { font-size: 12px; color: var(--err, #e04050); line-height: 1.5; }
.coderepo .privacy { font-size: 12px; color: var(--muted); }
.grow { flex: 1; }
.primary { background: var(--accent, #7c6cff); color: #fff; border-color: var(--accent, #7c6cff); }
.primary:hover:not(:disabled) { filter: brightness(1.1); }
</style>
