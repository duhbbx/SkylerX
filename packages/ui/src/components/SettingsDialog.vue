<script setup lang="ts">
import { ref } from 'vue'
import { LOCALE_LABEL, type Locale, locale, setLocale, t } from '../i18n'
import { AI_PROVIDER_LABEL, AI_PROVIDER_ORDER, type AiProvider, resetSettings, settings, zoomIn, zoomOut, zoomReset } from '../settings'
import Modal from './Modal.vue'

const emit = defineEmits<{ close: [] }>()
const props = defineProps<{ initialSection?: SectionId }>()

type SectionId = 'general' | 'editor' | 'grid' | 'watermark' | 'ai'

const SECTIONS: { id: SectionId; icon: string; labelKey: string }[] = [
  { id: 'general', icon: '⚙', labelKey: 'settings.cat.general' },
  { id: 'editor', icon: '⌨', labelKey: 'settings.cat.editor' },
  { id: 'grid', icon: '▦', labelKey: 'settings.cat.grid' },
  { id: 'watermark', icon: '⚠', labelKey: 'settings.cat.watermark' },
  { id: 'ai', icon: '✨', labelKey: 'settings.cat.ai' },
]
const active = ref<SectionId>(props.initialSection ?? 'general')

const PAGE_SIZES = [50, 100, 200, 500, 1000]
const LOCALES: Locale[] = ['zh', 'en']
const aiTab = ref<AiProvider>(settings.aiProvider)
// 点 tab 同时设为「正在编辑」与「当前激活」—— 避免用户切了 tab 以为已激活
function onPickProvider(p: AiProvider): void {
  aiTab.value = p
  settings.aiProvider = p
}

// 水印实时预览（同 Watermark 组件使用的 SVG data URL 生成方式）
function watermarkPreviewSvg(): string {
  const w = 240
  const h = 120
  const text = settings.watermarkText || '生产环境'
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="50%" y="50%" fill="${settings.watermarkColor}" fill-opacity="${settings.watermarkOpacity}" font-size="${settings.watermarkSize}" font-family="-apple-system,Segoe UI,Roboto,sans-serif" text-anchor="middle" dominant-baseline="middle" transform="rotate(${settings.watermarkAngle} ${w / 2} ${h / 2})">${safe}</text></svg>`
  return `url('data:image/svg+xml;utf8,${encodeURIComponent(xml)}')`
}
</script>

<template>
  <Modal :title="t('settings.title')" width="medium" fixed-height storage-key="settings" @close="emit('close')">
    <div class="cfg">
      <nav class="cfg-nav">
        <button
          v-for="s in SECTIONS"
          :key="s.id"
          :class="{ on: active === s.id }"
          @click="active = s.id"
        >
          <span class="ico">{{ s.icon }}</span>
          <span class="lbl">{{ t(s.labelKey) }}</span>
        </button>
      </nav>

      <section class="cfg-body">
        <!-- 常规 -->
        <template v-if="active === 'general'">
          <h3>{{ t('settings.cat.general') }}</h3>
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
            <span class="lbl">{{ t('settings.zoom') }}</span>
            <button class="step" @click="zoomOut">−</button>
            <span class="zoomval">{{ Math.round(settings.uiZoom * 100) }}%</span>
            <button class="step" @click="zoomIn">+</button>
            <button class="ghost reset-zoom" @click="zoomReset">{{ t('settings.zoomReset') }}</button>
          </label>
        </template>

        <!-- 编辑器 -->
        <template v-else-if="active === 'editor'">
          <h3>{{ t('settings.cat.editor') }}</h3>
          <label class="row">
            <span class="lbl">{{ t('settings.fontSize') }}</span>
            <input v-model.number="settings.fontSize" type="number" min="10" max="24" />
            <span class="unit">px</span>
          </label>
          <label class="row">
            <span class="lbl">{{ t('settings.tabSize') }}</span>
            <input v-model.number="settings.tabSize" type="number" min="1" max="8" />
          </label>
          <label class="row">
            <span class="lbl">{{ t('settings.wordWrap') }}</span>
            <input v-model="settings.wordWrap" type="checkbox" />
          </label>
          <label class="row">
            <span class="lbl">{{ t('settings.enableCompletion') }}</span>
            <input v-model="settings.enableCompletion" type="checkbox" />
          </label>
          <label class="row">
            <span class="lbl">{{ t('settings.keywordCase') }}</span>
            <select v-model="settings.keywordCase">
              <option value="upper">{{ t('settings.keywordCase.upper') }}</option>
              <option value="lower">{{ t('settings.keywordCase.lower') }}</option>
              <option value="preserve">{{ t('settings.keywordCase.preserve') }}</option>
            </select>
          </label>
        </template>

        <!-- 数据网格 -->
        <template v-else-if="active === 'grid'">
          <h3>{{ t('settings.cat.grid') }}</h3>
          <label class="row">
            <span class="lbl">{{ t('settings.pageSize') }}</span>
            <select v-model.number="settings.pageSize">
              <option v-for="s in PAGE_SIZES" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>
          <label class="row">
            <span class="lbl">{{ t('settings.nullDisplay') }}</span>
            <input v-model="settings.nullDisplay" type="text" placeholder="NULL" />
          </label>
        </template>

        <!-- 生产水印 -->
        <template v-else-if="active === 'watermark'">
          <h3>{{ t('settings.cat.watermark') }}</h3>
          <p class="note">{{ t('settings.watermark.note') }}</p>
          <label class="row">
            <span class="lbl">{{ t('settings.watermark.text') }}</span>
            <input v-model="settings.watermarkText" type="text" class="grow" />
          </label>
          <label class="row">
            <span class="lbl">{{ t('settings.watermark.opacity') }}</span>
            <input v-model.number="settings.watermarkOpacity" type="range" min="0.04" max="0.5" step="0.01" />
            <span class="unit">{{ settings.watermarkOpacity.toFixed(2) }}</span>
          </label>
          <label class="row">
            <span class="lbl">{{ t('settings.watermark.angle') }}</span>
            <input v-model.number="settings.watermarkAngle" type="range" min="-90" max="90" step="1" />
            <span class="unit">{{ settings.watermarkAngle }}°</span>
          </label>
          <label class="row">
            <span class="lbl">{{ t('settings.watermark.size') }}</span>
            <input v-model.number="settings.watermarkSize" type="number" min="16" max="120" />
            <span class="unit">px</span>
          </label>
          <label class="row">
            <span class="lbl">{{ t('settings.watermark.color') }}</span>
            <input v-model="settings.watermarkColor" type="color" />
            <input v-model="settings.watermarkColor" type="text" class="grow" />
          </label>
          <div class="wm-preview" :style="{ backgroundImage: watermarkPreviewSvg() }">
            <div class="wm-fake">SELECT * FROM users;</div>
          </div>
        </template>

        <!-- AI 助手（左侧分类的 AI 节点 → 右侧顶部 provider tabs + 表单） -->
        <template v-else-if="active === 'ai'">
          <h3>{{ t('settings.cat.ai') }}</h3>
          <p class="note">{{ t('settings.ai.tabsHint') }}</p>

          <!-- 点击 provider tab = 既切换为编辑视图，也设为当前激活 provider；
               避免「选了 tab 没激活」的歧义。当前激活的有粗描边 + ● 标记。 -->
          <div class="ai-tabs">
            <button
              v-for="p in AI_PROVIDER_ORDER"
              :key="p"
              class="ai-tab"
              :class="{ on: aiTab === p, active: settings.aiProvider === p }"
              @click="onPickProvider(p)"
            >
              <span v-if="settings.aiProvider === p" class="dot">●</span>
              {{ AI_PROVIDER_LABEL[p] }}
            </button>
          </div>

          <div class="ai-form">
            <div class="active-banner" :class="{ ok: settings.aiProvider === aiTab }">
              <template v-if="settings.aiProvider === aiTab">
                ✓ {{ t('settings.ai.activeNote', { name: AI_PROVIDER_LABEL[aiTab] }) }}
              </template>
              <template v-else>
                <span>{{ t('settings.ai.notActive', { name: AI_PROVIDER_LABEL[aiTab] }) }}</span>
                <button class="link" @click="settings.aiProvider = aiTab">{{ t('settings.ai.setActive') }}</button>
              </template>
            </div>
            <label class="row">
              <span class="lbl">API Key</span>
              <input v-model="settings.aiProviders[aiTab].apiKey" type="password" class="grow" :placeholder="t('settings.aiApiKeyPh')" />
            </label>
            <label class="row">
              <span class="lbl">{{ t('settings.aiModel') }}</span>
              <input v-model="settings.aiProviders[aiTab].model" type="text" class="grow" />
            </label>
            <label class="row">
              <span class="lbl">Base URL</span>
              <input v-model="settings.aiProviders[aiTab].baseUrl" type="text" class="grow" />
            </label>
          </div>
          <p class="note">{{ t('settings.aiNote') }}</p>
        </template>
      </section>
    </div>

    <div class="actions">
      <button class="ghost" @click="resetSettings">{{ t('common.resetDefault') }}</button>
      <button class="primary" @click="emit('close')">{{ t('common.done') }}</button>
    </div>
  </Modal>
</template>

<style scoped>
.cfg {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr); /* minmax(0,1fr) 让右列允许收缩，子元素不会撑出横向溢出 */
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0; /* 给内部 overflow:auto 一个能收缩的容器 */
}
.cfg-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-right: 1px solid var(--border);
  padding-right: 10px;
}
.cfg-nav button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  border-radius: 6px;
  font-size: 13px;
  text-align: left;
}
.cfg-nav button:hover {
  background: rgba(124, 108, 255, 0.10);
  color: var(--text);
}
.cfg-nav button.on {
  background: rgba(124, 108, 255, 0.18);
  color: var(--text);
}
.cfg-nav .ico {
  width: 16px;
  text-align: center;
}
.cfg-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
  min-width: 0; /* 让 grid 列允许收缩，长 input/url 不撑出横向溢出 */
}
.cfg-body h3 {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.row .lbl {
  width: 130px;
  font-size: 13px;
  color: var(--muted);
}
.row select,
.row input[type='text'],
.row input[type='password'],
.row input[type='number'] {
  padding: 5px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
}
.row input[type='number'] {
  width: 80px;
}
.row input[type='color'] {
  width: 36px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.row .grow {
  flex: 1;
  min-width: 0;
}
.unit {
  font-size: 12px;
  color: var(--muted);
  min-width: 36px;
}
.step {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}
.zoomval {
  min-width: 48px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
}
.reset-zoom {
  margin-left: 6px;
  font-size: 12px;
  padding: 4px 10px;
}
.ai-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-top: 8px;
}
.ai-tab {
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
  border-bottom: 2px solid transparent;
}
.ai-tab:hover {
  color: var(--text);
}
.ai-tab.on {
  color: var(--text);
  border-bottom-color: var(--accent, #7c6cff);
}
.ai-tab .dot {
  color: var(--accent, #7c6cff);
  font-size: 10px;
  margin-right: 2px;
}
.ai-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 2px;
}
.active-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  background: rgba(124, 108, 255, 0.10);
  color: var(--muted);
}
.active-banner.ok {
  background: rgba(76, 175, 80, 0.14);
  color: var(--text);
}
.active-banner .link {
  margin-left: auto;
}
.note {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.wm-preview {
  margin-top: 8px;
  height: 140px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background-color: var(--panel);
  background-repeat: repeat;
  position: relative;
  overflow: hidden;
}
.wm-fake {
  position: absolute;
  left: 12px;
  top: 12px;
  font-family: ui-monospace, monospace;
  color: var(--muted);
  font-size: 12px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  flex: none;
}
.actions button {
  padding: 6px 16px;
}
</style>
