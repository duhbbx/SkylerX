<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ConnectionConfig } from '@db-tool/shared-types'
import { onBeforeUnmount, ref } from 'vue'
import { parseConnectionText } from '../ai'
import { t } from '../i18n'
import { isActiveAiConfigured } from '../settings'
import Modal from './Modal.vue'

const emit = defineEmits<{ apply: [Partial<ConnectionConfig>]; close: [] }>()

const text = ref('')
const busy = ref(false)
const error = ref('')
const configured = isActiveAiConfigured()
let controller: AbortController | null = null

async function parse(): Promise<void> {
  error.value = ''
  if (!text.value.trim()) {
    error.value = t('conn.smartFill.empty')
    return
  }
  busy.value = true
  controller = new AbortController()
  try {
    const partial = await parseConnectionText(text.value, controller.signal)
    if (!partial || Object.keys(partial).length === 0) {
      error.value = t('conn.smartFill.failed')
      return
    }
    emit('apply', partial)
    emit('close')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/abort/i.test(msg)) error.value = t('conn.smartFill.failed')
  } finally {
    busy.value = false
    controller = null
  }
}

function close(): void {
  controller?.abort()
  emit('close')
}

onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <Modal :title="t('conn.smartFill.title')" width="medium" @close="close">
    <div class="smart-fill">
      <p class="desc">{{ t('conn.smartFill.desc') }}</p>
      <div v-if="!configured" class="banner err">{{ t('conn.smartFill.notConfigured') }}</div>
      <textarea
        v-model="text"
        rows="8"
        :placeholder="t('conn.smartFill.ph')"
        :disabled="busy || !configured"
      />
      <div v-if="error" class="banner err">{{ error }}</div>
    </div>
    <template #footer>
      <button class="ghost" @click="close">{{ t('common.cancel') }}</button>
      <button class="primary" :disabled="busy || !configured" @click="parse">
        {{ busy ? t('conn.smartFill.parsing') : t('conn.smartFill.parse') }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.smart-fill {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.smart-fill .desc {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}
.smart-fill textarea {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: 12px;
  resize: vertical;
}
.smart-fill .banner.err {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--err, #e04050);
  background: rgba(224, 64, 80, 0.1);
}
.primary {
  background: var(--accent, #7c6cff);
  color: #fff;
  border-color: var(--accent, #7c6cff);
}
.primary:hover:not(:disabled) {
  filter: brightness(1.1);
}
</style>
