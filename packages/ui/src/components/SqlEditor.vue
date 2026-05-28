<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { locale, t } from '../i18n'
import {
  type Suggestion,
  clearCompletionSource,
  monaco,
  setCompletionSource,
} from '../monaco-setup'
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
const emit = defineEmits<{
  'update:modelValue': [string]
  run: []
  format: []
  saveSnippet: []
  favorite: []
  aiExplain: []
  compress: []
  stripComments: []
}>()

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
    tabSize: settings.tabSize,
    wordWrap: settings.wordWrap ? 'on' : 'off',
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
  if (model && props.completion && settings.enableCompletion)
    setCompletionSource(model, props.completion)
  registerCustomActions()
})

/**
 * 注册我们自己的右键菜单动作（Monaco addAction）。
 * - 所有标签走 t() 取当前语言；切换 locale 时全部 dispose 再重新注册。
 * - editorHasSelection 前置条件用 Monaco 内置 context key，确保只在有选区时才出现选区类动作。
 * - 内置 Cut/Copy/Paste/Find 等保留 Monaco 原版（受限于 monaco-nls，标签仍为英文，等 NLS 整合后再统一）。
 */
let actionDisposables: { dispose(): void }[] = []
function registerCustomActions(): void {
  if (!editor) return
  for (const d of actionDisposables) d.dispose()
  actionDisposables = []
  const G_PRIMARY = '1_skylerx_primary' // 顶部一组：执行 / 运行选中
  const G_TOOLS = '2_skylerx_tools' // 编辑工具：格式化 / 压缩 / 去注释
  const G_SAVE = '3_skylerx_save' // 保存类：存为片段 / 收藏 / AI
  const add = (
    id: string,
    label: string,
    group: string,
    order: number,
    run: () => void,
    opts: { precondition?: string; keybindings?: number[] } = {},
  ) => {
    actionDisposables.push(
      editor!.addAction({
        id,
        label,
        contextMenuGroupId: group,
        contextMenuOrder: order,
        precondition: opts.precondition,
        keybindings: opts.keybindings,
        run: () => run(),
      }),
    )
  }
  // 执行类
  add('skylerx.run', t('editor.action.run'), G_PRIMARY, 1, () => emit('run'))
  add('skylerx.run-selection', t('editor.action.runSelection'), G_PRIMARY, 2, () => emit('run'), {
    precondition: 'editorHasSelection',
  })
  // 工具类
  add('skylerx.format', t('editor.action.formatAll'), G_TOOLS, 1, () => emit('format'))
  add('skylerx.compress', t('editor.action.compress'), G_TOOLS, 2, () => emit('compress'))
  add('skylerx.strip-comments', t('editor.action.stripComments'), G_TOOLS, 3, () =>
    emit('stripComments'),
  )
  // 保存 / AI
  add('skylerx.save-snippet', t('editor.action.saveSnippet'), G_SAVE, 1, () => emit('saveSnippet'))
  add('skylerx.favorite', t('editor.action.favorite'), G_SAVE, 2, () => emit('favorite'))
  add('skylerx.ai-explain', t('editor.action.aiExplain'), G_SAVE, 3, () => emit('aiExplain'))
}

// 切换语言时重注册，标签实时跟随 locale
watch(locale, () => registerCustomActions())

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
watch(
  () => settings.tabSize,
  (n) => editor?.updateOptions({ tabSize: n }),
)
watch(
  () => settings.wordWrap,
  (w) => editor?.updateOptions({ wordWrap: w ? 'on' : 'off' }),
)
watch(
  () => settings.enableCompletion,
  (on) => {
    if (!model || !props.completion) return
    if (on) setCompletionSource(model, props.completion)
    else clearCompletionSource(model)
  },
)

/** 当前选中的文本（无选区时返回空串）。供「存为片段」等取选区用。 */
function getSelectedText(): string {
  const sel = editor?.getSelection()
  if (!editor || !sel) return ''
  return editor.getModel()?.getValueInRange(sel) ?? ''
}

/** 光标之前的全部文本（含光标所在列）。供「运行到光标处」用。 */
function getTextBeforeCursor(): string {
  const pos = editor?.getPosition()
  const model = editor?.getModel()
  if (!editor || !pos || !model) return ''
  return model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: pos.lineNumber,
    endColumn: pos.column,
  })
}

defineExpose({ getSelectedText, getTextBeforeCursor })

onBeforeUnmount(() => {
  for (const d of actionDisposables) d.dispose()
  actionDisposables = []
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
