<script setup lang="ts">
import { ref } from 'vue'
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
        <span>仅结构（CREATE TABLE）</span>
      </label>
      <label class="row">
        <input v-model="withData" type="radio" :value="true" />
        <span>结构 + 数据（CREATE + INSERT）</span>
      </label>
      <div class="actions">
        <button class="ghost" @click="emit('close')">取消</button>
        <button class="primary" @click="emit('pick', withData)">导出</button>
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
