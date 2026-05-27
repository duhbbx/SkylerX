<script setup lang="ts">
import { resetSettings, settings } from '../settings'
import Modal from './Modal.vue'

const emit = defineEmits<{ close: [] }>()
const PAGE_SIZES = [50, 100, 200, 500, 1000]
</script>

<template>
  <Modal title="设置" @close="emit('close')">
    <div class="settings">
      <label class="row">
        <span class="lbl">主题</span>
        <select v-model="settings.theme">
          <option value="dark">深色</option>
          <option value="light">浅色</option>
        </select>
      </label>

      <label class="row">
        <span class="lbl">默认每页条数</span>
        <select v-model.number="settings.pageSize">
          <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>

      <label class="row">
        <span class="lbl">编辑器字号</span>
        <input v-model.number="settings.fontSize" type="number" min="10" max="24" />
        <span class="unit">px</span>
      </label>

      <label class="row">
        <span class="lbl">SQL 格式化关键字</span>
        <select v-model="settings.keywordCase">
          <option value="upper">大写 UPPER</option>
          <option value="lower">小写 lower</option>
          <option value="preserve">保持原样</option>
        </select>
      </label>

      <div class="actions">
        <button class="ghost" @click="resetSettings">恢复默认</button>
        <button class="primary" @click="emit('close')">完成</button>
      </div>
      <p class="note">设置即时生效并本地保存；字号对新打开的编辑器生效。</p>
    </div>
  </Modal>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.row .lbl {
  width: 140px;
  font-size: 13px;
  color: var(--muted);
}
.row select,
.row input {
  padding: 5px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.row input[type='number'] {
  width: 80px;
}
.unit {
  font-size: 12px;
  color: var(--muted);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}
.actions button {
  padding: 6px 16px;
}
.note {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
</style>
