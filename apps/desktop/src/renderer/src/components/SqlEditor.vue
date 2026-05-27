<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { type Suggestion, clearCompletionSource, monaco, setCompletionSource } from '../monaco-setup'

const props = defineProps<{
  modelValue: string
  readonly?: boolean
  completion?: (ctx: { text: string; word: string }) => Promise<Suggestion[]> | Suggestion[]
}>()
const emit = defineEmits<{ 'update:modelValue': [string]; run: [] }>()

const host = ref<HTMLDivElement>()
let editor: monaco.editor.IStandaloneCodeEditor | undefined
let model: monaco.editor.ITextModel | null = null

onMounted(() => {
  editor = monaco.editor.create(host.value!, {
    value: props.modelValue,
    language: 'sql',
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 14,
    scrollBeyondLastLine: false,
    tabSize: 2,
    renderLineHighlight: 'line',
    readOnly: props.readonly ?? false,
    domReadOnly: props.readonly ?? false,
  })

  editor.onDidChangeModelContent(() => emit('update:modelValue', editor!.getValue()))
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => emit('run'))

  model = editor.getModel()
  if (model && props.completion) setCompletionSource(model, props.completion)
})

// 外部（如双击表名）改写 SQL 时同步进编辑器
watch(
  () => props.modelValue,
  (v) => {
    if (editor && v !== editor.getValue()) editor.setValue(v)
  },
)

onBeforeUnmount(() => {
  if (model) clearCompletionSource(model)
  editor?.dispose()
})
</script>

<template>
  <div ref="host" class="sql-editor"></div>
</template>

<style scoped>
.sql-editor {
  width: 100%;
  height: 100%;
}
</style>
