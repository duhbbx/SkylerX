<script setup lang="ts">
/**
 * I1 「通知 Webhook」配置弹窗
 *
 * - 左侧列表（增 / 选 / 删），右侧表单（name / channel / url / secret / enabled / subscribe）；
 * - 配置存自家 key `skylerx.notifications`，与 settings 解耦；
 * - 「测试发送」直接调 `notify('manual', ...)`，结果用 toast 反馈；
 *   实际派发只把 enabled && subscribe.includes('manual') 的 channel 算进去，
 *   所以测试的渠道要先打勾 enabled 并订阅 manual——表单点保存后立刻生效。
 */
import { computed, ref } from 'vue'
import { confirm, toast } from '../dialog'
import { t } from '../i18n'
import {
  type NotifChannel,
  type NotifConfig,
  type NotifEvent,
  listNotifs,
  notify,
  saveNotifs,
} from '../notifications'
import Modal from './Modal.vue'

// props 无（spec 明确）
const emit = defineEmits<{ close: [] }>()

const items = ref<NotifConfig[]>(listNotifs())
const selectedId = ref<string | null>(items.value[0]?.id ?? null)
const selected = computed(() => items.value.find((x) => x.id === selectedId.value) ?? null)

/** 写盘 + 通知 Vue 重渲染（reactive 已经覆盖，但稳一手） */
function persist(): void {
  saveNotifs(items.value)
}

function uid(): string {
  return `n${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function addNew(): void {
  const item: NotifConfig = {
    id: uid(),
    name: t('notif.defaultName'),
    channel: 'dingtalk',
    webhookUrl: '',
    secret: '',
    enabled: true,
    subscribe: ['query-error', 'slow-query', 'manual'],
  }
  items.value.push(item)
  selectedId.value = item.id
  persist()
}

async function removeSelected(): Promise<void> {
  const cur = selected.value
  if (!cur) return
  const ok = await confirm({
    message: t('notif.confirmDelete', { name: cur.name || cur.id }),
    variant: 'danger',
  })
  if (!ok) return
  const i = items.value.findIndex((x) => x.id === cur.id)
  if (i >= 0) items.value.splice(i, 1)
  selectedId.value = items.value[0]?.id ?? null
  persist()
}

/** 单选事件订阅：勾上则加入，反之移除。空数组在 listNotifs 里会被当全订阅，但 UI 里禁止全清空更明确。 */
function toggleSubscribe(ev: NotifEvent): void {
  const cur = selected.value
  if (!cur) return
  const idx = cur.subscribe.indexOf(ev)
  if (idx >= 0) {
    if (cur.subscribe.length <= 1) return // 至少留一项，避免「保存了等于没订阅」的迷惑态
    cur.subscribe.splice(idx, 1)
  } else {
    cur.subscribe.push(ev)
  }
  persist()
}

const channelOptions: { value: NotifChannel; label: () => string }[] = [
  { value: 'dingtalk', label: () => t('notif.channelDingtalk') },
  { value: 'feishu', label: () => t('notif.channelFeishu') },
  { value: 'slack', label: () => t('notif.channelSlack') },
  { value: 'webhook', label: () => t('notif.channelWebhook') },
]

const eventOptions: NotifEvent[] = ['query-error', 'slow-query', 'manual']
function eventLabel(ev: NotifEvent): string {
  if (ev === 'query-error') return t('notif.eventQueryError')
  if (ev === 'slow-query') return t('notif.eventSlowQuery')
  return t('notif.eventManual')
}

/** 当前 channel 是否需要 secret 字段（钉钉/飞书才有签名） */
const needSecret = computed(
  () => selected.value?.channel === 'dingtalk' || selected.value?.channel === 'feishu',
)

const testing = ref(false)
async function sendTest(): Promise<void> {
  const cur = selected.value
  if (!cur) return
  // 先存盘——notify() 读 localStorage，不读当前 ref
  persist()
  if (!cur.enabled) {
    toast.warn(t('notif.testDisabledHint'))
    return
  }
  if (!cur.webhookUrl.trim()) {
    toast.warn(t('notif.testNoUrl'))
    return
  }
  if (!cur.subscribe.includes('manual')) {
    toast.warn(t('notif.testNoManualSub'))
    return
  }
  testing.value = true
  try {
    // notify 自己吞错误，这里靠侧信道：直接派发并立即 toast 成功；
    // 真出错只会在控制台看到 warn——做不到「点测试就准确知道服务器拒绝」是 spec 的取舍
    // （要求 notify 错误吞掉）。给用户一个清晰的「已发送」即可。
    await notify('manual', {
      title: t('notif.testTitle'),
      body: t('notif.testBody', { name: cur.name || cur.id }),
      level: 'info',
    })
    toast.success(t('notif.sent'))
  } catch (e) {
    // 兜底（notify 不抛，但 listNotifs 解析失败之类极端情况）
    toast.error(e instanceof Error ? e.message : String(e))
  } finally {
    testing.value = false
  }
}

/** 输入变更后立即持久化（每个 input/change 调一下，简单粗暴但够用，量小） */
function onFieldChange(): void {
  persist()
}
</script>

<template>
  <Modal
    :title="t('notif.title')"
    width="wide"
    fixed-height
    storage-key="notif-settings"
    @close="emit('close')"
  >
    <div class="notif">
      <aside class="list">
        <div class="list-head">
          <span>{{ t('notif.listTitle') }}</span>
          <button class="ghost sm" :title="t('notif.add')" @click="addNew">＋</button>
        </div>
        <ul v-if="items.length">
          <li
            v-for="it in items"
            :key="it.id"
            :class="{ active: it.id === selectedId, off: !it.enabled }"
            @click="selectedId = it.id"
          >
            <div class="name">{{ it.name || t('notif.unnamed') }}</div>
            <div class="sub">
              {{
                it.channel === 'dingtalk'
                  ? t('notif.channelDingtalk')
                  : it.channel === 'feishu'
                    ? t('notif.channelFeishu')
                    : it.channel === 'slack'
                      ? t('notif.channelSlack')
                      : t('notif.channelWebhook')
              }}
              <span v-if="!it.enabled" class="tag">{{ t('notif.disabledTag') }}</span>
            </div>
          </li>
        </ul>
        <div v-else class="empty">{{ t('notif.empty') }}</div>
      </aside>

      <section class="form">
        <template v-if="selected">
          <div class="row">
            <label>{{ t('notif.nameLabel') }}</label>
            <input v-model="selected.name" type="text" @change="onFieldChange" />
          </div>
          <div class="row">
            <label>{{ t('notif.channel') }}</label>
            <select v-model="selected.channel" @change="onFieldChange">
              <option v-for="o in channelOptions" :key="o.value" :value="o.value">
                {{ o.label() }}
              </option>
            </select>
          </div>
          <div class="row">
            <label>{{ t('notif.webhookUrl') }}</label>
            <input
              v-model="selected.webhookUrl"
              type="text"
              :placeholder="t('notif.webhookUrlPlaceholder')"
              @change="onFieldChange"
            />
          </div>
          <div v-if="needSecret" class="row">
            <label>{{ t('notif.secret') }}</label>
            <input
              v-model="selected.secret"
              type="password"
              :placeholder="t('notif.secretPlaceholder')"
              @change="onFieldChange"
            />
          </div>
          <div class="row inline">
            <label class="check">
              <input v-model="selected.enabled" type="checkbox" @change="onFieldChange" />
              <span>{{ t('notif.enabled') }}</span>
            </label>
          </div>
          <div class="row">
            <label>{{ t('notif.subscribe') }}</label>
            <div class="events">
              <label v-for="ev in eventOptions" :key="ev" class="check">
                <input
                  type="checkbox"
                  :checked="selected.subscribe.includes(ev)"
                  @change="toggleSubscribe(ev)"
                />
                <span>{{ eventLabel(ev) }}</span>
              </label>
            </div>
          </div>
          <div class="actions">
            <button class="ghost danger" @click="removeSelected">{{ t('notif.delete') }}</button>
            <span class="spacer"></span>
            <button class="primary" :disabled="testing" @click="sendTest">
              {{ testing ? t('notif.sending') : t('notif.test') }}
            </button>
          </div>
        </template>
        <div v-else class="placeholder">{{ t('notif.selectHint') }}</div>
      </section>
    </div>
  </Modal>
</template>

<style scoped>
.notif {
  display: flex;
  gap: 14px;
  height: 100%;
  min-height: 0;
}
.list {
  width: 220px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--panel);
}
.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  font-size: 13px;
}
.list ul {
  list-style: none;
  margin: 0;
  padding: 4px;
  overflow: auto;
  flex: 1 1 auto;
}
.list li {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.list li:hover {
  background: var(--bg);
}
.list li.active {
  background: var(--bg);
  outline: 1px solid var(--accent);
}
.list li.off .name {
  opacity: 0.6;
}
.list li .name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.list li .sub {
  font-size: 11px;
  color: var(--muted);
}
.tag {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  background: var(--border);
  color: var(--muted);
  border-radius: 8px;
  font-size: 10px;
}
.empty {
  padding: 20px 10px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
.form {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
  padding-right: 4px;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row.inline {
  flex-direction: row;
  align-items: center;
}
.row label {
  font-size: 12px;
  color: var(--muted);
}
.row input[type='text'],
.row input[type='password'],
.row select {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.row input:focus,
.row select:focus {
  border-color: var(--accent);
}
.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
}
.events {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  padding-top: 2px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.spacer {
  flex: 1 1 auto;
}
button {
  padding: 5px 12px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
}
button.sm {
  padding: 2px 8px;
}
button.ghost:hover {
  background: var(--bg);
}
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
button.primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
button.danger {
  color: var(--err, #e04050);
}
.placeholder {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 13px;
}
</style>
