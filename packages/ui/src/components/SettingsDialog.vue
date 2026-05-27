<script setup lang="ts">
import { LOCALE_LABEL, type Locale, locale, setLocale, t } from '../i18n'
import { resetSettings, settings } from '../settings'
import Modal from './Modal.vue'

const emit = defineEmits<{ close: [] }>()
const PAGE_SIZES = [50, 100, 200, 500, 1000]
const LOCALES: Locale[] = ['zh', 'en']
</script>

<template>
  <Modal :title="t('settings.title')" @close="emit('close')">
    <div class="settings">
      <label class="row">
        <span class="lbl">{{ t('settings.language') }}</span>
        <select :value="locale" @change="setLocale(($event.target as HTMLSelectElement).value as Locale)">
          <option v-for="l in LOCALES" :key="l" :value="l">{{ LOCALE_LABEL[l] }}</option>
        </select>
      </label>

      <label class="row">
        <span class="lbl">{{ t('settings.theme') }}</span>
        <select v-model="settings.theme">
          <option value="dark">{{ t('settings.theme.dark') }}</option>
          <option value="light">{{ t('settings.theme.light') }}</option>
        </select>
      </label>

      <label class="row">
        <span class="lbl">{{ t('settings.pageSize') }}</span>
        <select v-model.number="settings.pageSize">
          <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>

      <label class="row">
        <span class="lbl">{{ t('settings.fontSize') }}</span>
        <input v-model.number="settings.fontSize" type="number" min="10" max="24" />
        <span class="unit">px</span>
      </label>

      <label class="row">
        <span class="lbl">{{ t('settings.keywordCase') }}</span>
        <select v-model="settings.keywordCase">
          <option value="upper">{{ t('settings.keywordCase.upper') }}</option>
          <option value="lower">{{ t('settings.keywordCase.lower') }}</option>
          <option value="preserve">{{ t('settings.keywordCase.preserve') }}</option>
        </select>
      </label>

      <div class="actions">
        <button class="ghost" @click="resetSettings">{{ t('common.resetDefault') }}</button>
        <button class="primary" @click="emit('close')">{{ t('common.done') }}</button>
      </div>
      <p class="note">{{ t('settings.note') }}</p>
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
