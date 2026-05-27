<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { type Suggestion, clearCompletionSource, monaco, setCompletionSource } from '../monaco-setup'
import { settings } from '../settings'

const props = defineProps<{
  modelValue: string
  readonly?: boolean
  completion?: (ctx: {
    text: string
    word: string
    before: string
  }) => Promise<Suggestion[]> | Suggestion[]
}>()
const emit = defineEmits<{ 'update:modelValue': [string]; run: []; format: [] }>()

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
    fontSize: settings.fontSize,
    scrollBeyondLastLine: false,
    tabSize: 2,
    renderLineHighlight: 'line',
    readOnly: props.readonly ?? false,
    domReadOnly: props.readonly ?? false,
  })

  editor.onDidChangeModelContent(() => emit('update:modelValue', editor!.getValue()))

  // 在 onKeyDown 拦截执行/格式化快捷键：addCommand 注册的键位会被自动补全弹窗
  // （suggestWidget 可见时）等上下文吞掉，导致刚打完字、弹窗还开着时 ⌘/Ctrl+Enter 不生效。
  // 这里抢先处理并 stopPropagation，阻止 Monaco 后续按键派发，保证任何状态下都能触发。
  editor.onKeyDown((e) => {
    const mod = e.metaKey || e.ctrlKey
    // ⌘/Ctrl+Enter 执行
    if (mod && !e.altKey && e.keyCode === monaco.KeyCode.Enter) {
      e.preventDefault()
      e.stopPropagation()
      emit('run')
      return
    }
    // ⌘/Ctrl+Shift+F 格式化
    if (mod && e.shiftKey && e.keyCode === monaco.KeyCode.KeyF) {
      e.preventDefault()
      e.stopPropagation()
      emit('format')
    }
  })

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

// 设置里改字号 → 实时应用
watch(
  () => settings.fontSize,
  (fs) => editor?.updateOptions({ fontSize: fs }),
)

/** 当前选中的文本（无选区时返回空串）。供「存为片段」等取选区用。 */
function getSelectedText(): string {
  const sel = editor?.getSelection()
  if (!editor || !sel) return ''
  return editor.getModel()?.getValueInRange(sel) ?? ''
}

defineExpose({ getSelectedText })

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
