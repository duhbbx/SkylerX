<script setup lang="ts">/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { ref } from 'vue'
import { t } from '../i18n'
import Modal from './Modal.vue'

defineProps<{ title: string }>()
const emit = defineEmits<{ pick: [boolean]; close: [] }>()

const withData = ref(true)
</script>

<template>
  <Modal :title="title" @close="emit('close')">
    <div class="exp">
      <label class="row">
        <input v-model="withData" type="radio" :value="false" />
        <span>{{ t('export.structOnly') }}</span>
      </label>
      <label class="row">
        <input v-model="withData" type="radio" :value="true" />
        <span>{{ t('export.structData') }}</span>
      </label>
      <div class="actions">
        <button class="ghost" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="primary" @click="emit('pick', withData)">{{ t('export.go') }}</button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.exp {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}
.actions button {
  padding: 7px 16px;
}
</style>
