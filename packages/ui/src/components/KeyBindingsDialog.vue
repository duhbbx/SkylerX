<script setup lang="ts">
/**
 * K1 自定义键盘快捷键弹窗
 *
 * UI 约定：
 *  - 一行 = 一个命令；右列显示当前 chord（formatChord 渲染）+「录制」/「还原」按钮。
 *  - 点「录制」→ 行进入录制态，渲染一个 autofocus 的隐形 input；
 *    监听 keydown：Esc 取消、Enter 保存、Backspace 清空（视为「禁用」）、其它按键 → chordFromEvent 试取。
 *  - 录制态会吃掉所有键事件（preventDefault），保证不会触发全局 hotkey。
 *  - 冲突检测：扫一遍合并后的绑定，发现 chord 已被其它命令占用则在该行尾红字提示。
 *
 * 写入路径：保存时只把「与默认不同」的项落到 settings.keyBindings（覆盖式），
 *           「还原默认」直接清空 settings.keyBindings。
 */
import { computed, nextTick, ref } from 'vue'
import { confirm as appConfirm } from '../dialog'
import { t } from '../i18n'
import {
  COMMANDS,
  DEFAULT_KEY_BINDINGS,
  chordFromEvent,
  formatChord,
  getBindings,
} from '../keybindings'
import { settings } from '../settings'
import Modal from './Modal.vue'

const emit = defineEmits<{ close: [] }>()

/** 当前录制中的命令 id；null 表示无人在录。 */
const recordingId = ref<string | null>(null)
/** 录制态下临时缓存（按键先存这里，按 Enter 才落盘）。 */
const draftChord = ref('')
const recordingInput = ref<HTMLInputElement | null>(null)

/** 实际生效的绑定（默认 + 用户覆盖）。 */
const effective = computed<Record<string, string>>(() => getBindings(settings.keyBindings))

/**
 * 冲突表：chord → 命令 id 数组。空 chord 不算冲突（视为禁用）。
 * 录制态下的 draftChord 也参与冲突检测，让用户当场看见。
 */
const conflicts = computed<Record<string, string[]>>(() => {
  const map: Record<string, string[]> = {}
  for (const cmd of COMMANDS) {
    const chord =
      recordingId.value === cmd.id && draftChord.value
        ? draftChord.value
        : (effective.value[cmd.id] ?? '')
    if (!chord) continue
    if (!map[chord]) map[chord] = []
    map[chord].push(cmd.id)
  }
  return map
})

/** 给指定命令找冲突对手（不包含自己）；返回第一个对手的 labelKey，没冲突就返回空。 */
function conflictWith(id: string): string {
  const chord =
    recordingId.value === id && draftChord.value ? draftChord.value : (effective.value[id] ?? '')
  if (!chord) return ''
  const others = (conflicts.value[chord] ?? []).filter((x) => x !== id)
  if (!others.length) return ''
  const other = COMMANDS.find((c) => c.id === others[0])
  return other ? t(other.labelKey) : (others[0] ?? '')
}

async function startRecord(id: string): Promise<void> {
  recordingId.value = id
  draftChord.value = ''
  await nextTick()
  recordingInput.value?.focus()
}

function cancelRecord(): void {
  recordingId.value = null
  draftChord.value = ''
}

/**
 * 保存当前 draft 到 settings.keyBindings：
 *  - 跟默认值相同 → 删除覆盖项（保持配置精简）
 *  - 跟默认值不同（含空串「禁用」） → 写入覆盖
 */
function commit(id: string, chord: string): void {
  const def = DEFAULT_KEY_BINDINGS[id] ?? ''
  if (chord === def) {
    delete settings.keyBindings[id]
  } else {
    settings.keyBindings[id] = chord
  }
  recordingId.value = null
  draftChord.value = ''
}

function onRecordKeyDown(e: KeyboardEvent): void {
  // 录制态吃掉所有按键，避免触发全局快捷键（比如录到 ⌘W 时关闭弹窗）
  e.preventDefault()
  e.stopPropagation()
  if (!recordingId.value) return
  if (e.key === 'Escape') {
    cancelRecord()
    return
  }
  if (e.key === 'Enter' && draftChord.value) {
    commit(recordingId.value, draftChord.value)
    return
  }
  if (e.key === 'Backspace' && !draftChord.value) {
    // 空 draft 时按 Backspace = 直接落盘为空串（禁用此命令）
    commit(recordingId.value, '')
    return
  }
  const chord = chordFromEvent(e)
  if (chord) draftChord.value = chord
}

/** 单行「还原」按钮：把这条命令的覆盖删掉，回到默认。 */
function resetOne(id: string): void {
  delete settings.keyBindings[id]
  if (recordingId.value === id) cancelRecord()
}

async function resetAll(): Promise<void> {
  if (!Object.keys(settings.keyBindings).length) return
  if (!(await appConfirm({ message: t('kbd.resetAllConfirm'), variant: 'warn' }))) return
  // 用赋空对象的方式触发 reactive 写入；逐 key 删能保留 reactive proxy 行为
  for (const k of Object.keys(settings.keyBindings)) delete settings.keyBindings[k]
  cancelRecord()
}

/** 单行显示：录制中 → 显示 draft 或占位；否则显示当前绑定（空 = 未绑定） */
function displayChord(id: string): string {
  if (recordingId.value === id) {
    return draftChord.value ? formatChord(draftChord.value) : t('kbd.recording')
  }
  const chord = effective.value[id] ?? ''
  return chord ? formatChord(chord) : t('kbd.unbound')
}

/** 该行是否被用户改过默认？用于「还原」按钮的可见性 */
function isOverridden(id: string): boolean {
  return Object.hasOwn(settings.keyBindings, id)
}
</script>

<template>
  <Modal
    :title="t('kbd.title')"
    width="medium"
    fixed-height
    storage-key="key-bindings"
    @close="emit('close')"
  >
    <div class="kb">
      <div class="bar">
        <span class="note">{{ t('kbd.note') }}</span>
        <span class="spacer"></span>
        <button class="ghost" @click="resetAll">{{ t('kbd.resetAll') }}</button>
      </div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th class="col-cmd">{{ t('kbd.cmd') }}</th>
              <th class="col-key">{{ t('kbd.shortcut') }}</th>
              <th class="col-act"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="cmd in COMMANDS"
              :key="cmd.id"
              :class="{ recording: recordingId === cmd.id }"
            >
              <td class="col-cmd">{{ t(cmd.labelKey) }}</td>
              <td class="col-key">
                <span
                  :class="['chord', { unbound: !effective[cmd.id] && recordingId !== cmd.id }]"
                >
                  {{ displayChord(cmd.id) }}
                </span>
                <span v-if="conflictWith(cmd.id)" class="conflict">
                  {{ t('kbd.conflict', { cmd: conflictWith(cmd.id) }) }}
                </span>
                <input
                  v-if="recordingId === cmd.id"
                  ref="recordingInput"
                  class="rec-input"
                  type="text"
                  readonly
                  :placeholder="t('kbd.recording')"
                  :title="t('kbd.recordHint')"
                  @keydown="onRecordKeyDown"
                  @blur="cancelRecord"
                />
              </td>
              <td class="col-act">
                <button
                  v-if="recordingId !== cmd.id"
                  class="ghost sm"
                  @click="startRecord(cmd.id)"
                >
                  {{ t('kbd.record') }}
                </button>
                <button
                  v-if="recordingId !== cmd.id && isOverridden(cmd.id)"
                  class="ghost sm"
                  @click="resetOne(cmd.id)"
                >
                  {{ t('kbd.reset') }}
                </button>
                <span v-if="recordingId === cmd.id" class="hint">{{ t('kbd.recordHint') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.kb {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.note {
  font-size: 12px;
  color: var(--muted);
}
.spacer {
  flex: 1 1 auto;
}
.bar button {
  padding: 5px 12px;
  font-size: 12px;
}
.tbl-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.tbl th,
.tbl td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}
.tbl th {
  position: sticky;
  top: 0;
  background: var(--panel);
  font-weight: 600;
  font-size: 12px;
  color: var(--muted);
  z-index: 1;
}
.tbl tbody tr:last-child td {
  border-bottom: none;
}
.tbl tbody tr.recording {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.col-cmd {
  width: 40%;
}
.col-key {
  width: 35%;
  font-family: ui-monospace, monospace;
  position: relative;
}
.col-act {
  width: 25%;
  text-align: right;
  white-space: nowrap;
}
.col-act button {
  margin-left: 6px;
}
.col-act button.sm {
  padding: 3px 10px;
  font-size: 12px;
}
.chord {
  display: inline-block;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  min-width: 60px;
  text-align: center;
}
.chord.unbound {
  color: var(--muted);
  font-style: italic;
  border-style: dashed;
}
.conflict {
  display: inline-block;
  margin-left: 10px;
  color: var(--err, #e04050);
  font-family: -apple-system, Segoe UI, Roboto, sans-serif;
  font-size: 11px;
}
.hint {
  font-size: 11px;
  color: var(--muted);
}
/* 录制隐形 input：吃键盘焦点，但视觉上不存在；用户感知到的是行高亮 + chord 即时刷新 */
.rec-input {
  position: absolute;
  left: -9999px;
  top: 0;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
