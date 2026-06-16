<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ConnectionConfig } from '@db-tool/shared-types'
import { ref } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import { t } from '../i18n'
import { canEmbed } from '../ai'
import { getRepoPath, refreshCodeIndex, setRepoPath } from '../rag/codeRepo'
import Modal from './Modal.vue'

const props = defineProps<{ conn: ConnectionConfig; container: string }>()
const emit = defineEmits<{ close: []; saved: [ConnectionConfig] }>()

const client = useDataClient()
const path = ref(getRepoPath(props.conn, props.container) ?? '')
const busy = ref(false)
const status = ref('')

async function pick(): Promise<void> {
  const picked = await client.files.selectFile?.({ directory: true })
  if (picked) path.value = picked
}

/** 保存绑定路径到 connection.extra(过 IPC 前已是纯对象:JSON 深拷贝剥掉响应式 Proxy)。 */
async function persist(p: string): Promise<ConnectionConfig> {
  const next = setRepoPath(props.conn, props.container, p)
  const saved = await client.connections.update(
    JSON.parse(JSON.stringify(next)) as ConnectionConfig,
  )
  emit('saved', saved)
  return saved
}

async function build(): Promise<void> {
  if (!path.value.trim()) {
    toast.warn(t('coderepo.noPath'))
    return
  }
  busy.value = true
  status.value = ''
  try {
    await persist(path.value)
    const r = await refreshCodeIndex(client, props.conn.id, props.container, path.value, {
      nowMs: Date.now(),
    })
    status.value =
      t('coderepo.status', {
        files: String(r.fileCount),
        chunks: String(r.index.chunks.length),
        mode: r.mode,
      }) + (r.capped ? ` ${t('coderepo.capped')}` : '')
    toast.success(t('coderepo.saved'))
  } catch (e) {
    toast.warn(e instanceof Error ? e.message : String(e))
  } finally {
    busy.value = false
  }
}

async function unbind(): Promise<void> {
  busy.value = true
  try {
    await persist('')
    path.value = ''
    status.value = ''
    toast.success(t('coderepo.saved'))
    emit('close')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Modal :title="t('coderepo.title')" width="medium" @close="emit('close')">
    <div class="coderepo">
      <p class="desc">{{ t('coderepo.desc') }}</p>
      <label class="lbl">{{ t('coderepo.folder') }}</label>
      <div class="row">
        <input v-model="path" class="path" :placeholder="t('coderepo.noPath')" />
        <button class="ghost" :disabled="busy" @click="pick">{{ t('coderepo.pick') }}</button>
      </div>
      <div v-if="status" class="status">{{ status }}</div>
      <div v-if="!canEmbed()" class="privacy">{{ t('coderepo.privacy') }}</div>
    </div>
    <template #footer>
      <button v-if="getRepoPath(props.conn, props.container)" class="ghost" :disabled="busy" @click="unbind">
        {{ t('coderepo.unbind') }}
      </button>
      <span class="grow" />
      <button class="ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="primary" :disabled="busy || !path.trim()" @click="build">
        {{ busy ? t('coderepo.building') : t('coderepo.build') }}
      </button>
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
.coderepo .privacy { font-size: 12px; color: var(--muted); }
.grow { flex: 1; }
.primary { background: var(--accent, #7c6cff); color: #fff; border-color: var(--accent, #7c6cff); }
.primary:hover:not(:disabled) { filter: brightness(1.1); }
</style>
