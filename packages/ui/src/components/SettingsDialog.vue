<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { onMounted, ref } from 'vue'
import { type AiTestResult, testAiProvider } from '../ai'
import { confirm as appConfirm, toast } from '../dialog'
import { reportError } from '../errorReporter'
import { LOCALE_LABEL, type Locale, locale, setLocale, t } from '../i18n'
import { addFact, clearFacts, clearVectorMemory, removeFact } from '../memory'
import { clearUsage as clearNavUsage } from '../nav-usage'
import {
  AI_PROVIDER_LABEL,
  AI_PROVIDER_ORDER,
  type AiProvider,
  isLocalAiProvider,
  resetSettings,
  settings,
  zoomIn,
  zoomOut,
  zoomReset,
} from '../settings'
import Modal from './Modal.vue'

const emit = defineEmits<{ close: [] }>()
const props = defineProps<{ initialSection?: SectionId }>()

type SectionId = 'general' | 'editor' | 'grid' | 'watermark' | 'ai' | 'updates'

const SECTIONS: { id: SectionId; icon: string; labelKey: string }[] = [
  { id: 'general', icon: '⚙', labelKey: 'settings.cat.general' },
  { id: 'editor', icon: '⌨', labelKey: 'settings.cat.editor' },
  { id: 'grid', icon: '▦', labelKey: 'settings.cat.grid' },
  { id: 'watermark', icon: '⚠', labelKey: 'settings.cat.watermark' },
  { id: 'ai', icon: '✨', labelKey: 'settings.cat.ai' },
  { id: 'updates', icon: '⬇', labelKey: 'settings.cat.updates' },
]

// ─── 应用更新 (electron-updater 通道) ─────────────────────────────────────
type UpdateChannel = 'github' | 'oss-cn'
interface UpdatesApi {
  getStatus: () => Promise<unknown>
  check: () => Promise<{ devMode?: boolean; ok?: boolean; error?: string }>
  downloadAndInstall: () => Promise<{ devMode?: boolean; ok?: boolean; error?: string }>
  install: () => Promise<{ devMode?: boolean; ok?: boolean }>
  getChannel: () => Promise<UpdateChannel>
  setChannel: (c: UpdateChannel) => Promise<{ ok: boolean; error?: string }>
  onStatus: (handler: (s: unknown) => void) => () => void
}
function updatesApi(): UpdatesApi | null {
  const w = window as unknown as { api?: { updates?: UpdatesApi } }
  return w.api?.updates ?? null
}

const updateChannel = ref<UpdateChannel>('github')
const updateStatus = ref<string>('')
const updateChecking = ref(false)
const updatePackagedMode = ref(true) // 默认假装是 packaged,dev 模式 check() 返回 devMode 时切回

onMounted(async () => {
  const api = updatesApi()
  if (!api) return
  try {
    updateChannel.value = await api.getChannel()
  } catch {
    /* preload 老版本可能没暴露 getChannel,降级 */
  }
})

async function onChangeChannel(c: UpdateChannel): Promise<void> {
  if (c === updateChannel.value) return
  const api = updatesApi()
  if (!api) {
    toast.warn(t('settings.updates.notAvailable'))
    return
  }
  const r = await api.setChannel(c)
  if (r.ok) {
    updateChannel.value = c
    toast.success(
      c === 'oss-cn' ? t('settings.updates.switchedOss') : t('settings.updates.switchedGithub'),
    )
  } else {
    reportError(new Error(r.error ?? 'unknown error'))
  }
}

async function onCheckUpdates(): Promise<void> {
  const api = updatesApi()
  if (!api) {
    toast.warn(t('settings.updates.notAvailable'))
    return
  }
  updateChecking.value = true
  updateStatus.value = t('settings.updates.checking')
  try {
    const r = await api.check()
    if (r.devMode) {
      updatePackagedMode.value = false
      updateStatus.value = t('settings.updates.devMode')
    } else if (r.ok) {
      updateStatus.value = t('settings.updates.checkSent')
    } else {
      updateStatus.value = r.error ?? t('settings.updates.checkFail')
    }
  } finally {
    updateChecking.value = false
  }
}
const active = ref<SectionId>(props.initialSection ?? 'general')

const PAGE_SIZES = [50, 100, 200, 500, 1000]
const LOCALES: Locale[] = ['zh', 'en']
const aiTab = ref<AiProvider>(settings.aiProvider)

// AI Provider 连通测试 (#28). Per-tab,
// 切换 tab 时清掉旧结果, 避免显示对其他 provider 的过时结论.
const aiTesting = ref(false)
const aiTestResult = ref<AiTestResult | null>(null)
async function onTestAi(): Promise<void> {
  aiTestResult.value = null
  aiTesting.value = true
  try {
    aiTestResult.value = await testAiProvider(aiTab.value, settings.aiProviders[aiTab.value])
  } finally {
    aiTesting.value = false
  }
}
// 点 tab 同时设为「正在编辑」与「当前激活」—— 避免用户切了 tab 以为已激活
function onPickProvider(p: AiProvider): void {
  aiTab.value = p
  settings.aiProvider = p
  // 清掉旧 provider 的测试结果, 不让它误导新 tab 的判断
  aiTestResult.value = null
}

// ── 记忆与画像 ──
/** #13 加一行空白脱敏规则 */
/** 用户报告 #7：清空 NavTree 库/schema 使用频率统计。 */
async function resetNavUsage(): Promise<void> {
  const ok = await appConfirm({
    title: t('settings.navSortByUsageReset'),
    message: t('settings.navSortByUsageResetConfirm'),
    variant: 'warn',
  })
  if (ok) {
    clearNavUsage()
    toast.success(t('common.done'))
  }
}

function addMaskRule(): void {
  settings.maskingRules.push({
    name: '',
    columnPattern: '',
    kind: 'default',
    enabled: true,
  })
}

const newFact = ref('')
function onAddFact(): void {
  const v = newFact.value.trim()
  if (!v) return
  addFact(v)
  newFact.value = ''
}
function onRemoveFact(id: string): void {
  removeFact(id)
}
async function onClearFacts(): Promise<void> {
  if (!settings.aiFacts.length) return
  if (!(await appConfirm({ message: t('settings.mem.bClearConfirm'), variant: 'warn' }))) return
  clearFacts()
}
async function onClearVectors(): Promise<void> {
  if (!settings.aiVectorMemories.length) return
  if (!(await appConfirm({ message: t('settings.mem.cClearConfirm'), variant: 'warn' }))) return
  clearVectorMemory()
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
              <option value="system">{{ t('settings.theme.system') }}</option>
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
          <!-- 全局「提交模式」：仅作为「新建查询页」的默认值（首次打开时继承此设置）；
               已经打开的查询 tab 各自保持当前的 auto/manual 状态，不会被这里的修改回溯影响。 -->
          <label class="row">
            <span class="lbl">{{ t('commit.mode') }}</span>
            <select v-model="settings.commitMode">
              <option value="auto">{{ t('commit.modeAuto') }}</option>
              <option value="manual">{{ t('commit.modeManual') }}</option>
            </select>
          </label>
          <p class="hint">
            <!-- 文案上明示：本项仅影响「新建查询页」的初始提交模式；已打开的 tab 不受影响 -->
            {{ settings.commitMode === 'manual' ? t('commit.modeManualDesc') : t('commit.modeAutoDesc') }}
          </p>
          <!-- 用户报告 #7：NavTree 库/schema 按使用频率排序（默认关） -->
          <label class="row">
            <span class="lbl">{{ t('settings.navSortByUsage') }}</span>
            <input v-model="settings.navSortByUsage" type="checkbox" class="chk" />
          </label>
          <p class="hint">
            {{ t('settings.navSortByUsageDesc') }}
            <button v-if="settings.navSortByUsage" class="link-btn" @click="resetNavUsage">
              {{ t('settings.navSortByUsageReset') }}
            </button>
          </p>
          <!-- 显示系统对象：PG 系 pg_catalog/openGauss dbe_perf 等系统 schema、Oracle 系统用户（默认关） -->
          <label class="row">
            <span class="lbl">{{ t('settings.showSystemObjects') }}</span>
            <input v-model="settings.showSystemObjects" type="checkbox" class="chk" />
          </label>
          <p class="hint">{{ t('settings.showSystemObjectsDesc') }}</p>
          <!-- #13 数据脱敏：列名匹配 → 结果集渲染遮罩 -->
          <label class="row">
            <span class="lbl">{{ t('mask.enabled') }}</span>
            <input v-model="settings.maskingEnabled" type="checkbox" class="chk" :title="t('mask.enabledTitle')" />
          </label>
          <div v-if="settings.maskingEnabled" class="mask-rules">
            <div class="mask-head">
              <span>{{ t('mask.rulesTitle') }}</span>
              <button class="ghost sm" @click="addMaskRule">+ {{ t('mask.addRule') }}</button>
            </div>
            <div v-for="(r, i) in settings.maskingRules" :key="i" class="mask-row">
              <input v-model="r.enabled" type="checkbox" class="chk" :title="t('mask.toggleRule')" />
              <input v-model="r.name" class="m-name" :placeholder="t('mask.ruleName')" />
              <input v-model="r.columnPattern" class="m-pat" :placeholder="t('mask.patternPh')" />
              <select v-model="r.kind" class="m-kind">
                <option value="phone">phone</option>
                <option value="email">email</option>
                <option value="idCard">idCard</option>
                <option value="bankCard">bankCard</option>
                <option value="name">name</option>
                <option value="address">address</option>
                <option value="default">default</option>
              </select>
              <button class="ghost sm" :title="t('common.remove')" @click="settings.maskingRules.splice(i, 1)">×</button>
            </div>
          </div>
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
              <input
                v-model="settings.aiProviders[aiTab].apiKey"
                type="password"
                class="grow"
                :placeholder="isLocalAiProvider(aiTab) ? t('settings.ai.localKeyPh') : t('settings.aiApiKeyPh')"
              />
            </label>
            <p v-if="isLocalAiProvider(aiTab)" class="note local-hint">{{ t('settings.ai.ollamaHint') }}</p>
            <label class="row">
              <span class="lbl">{{ t('settings.aiModel') }}</span>
              <input v-model="settings.aiProviders[aiTab].model" type="text" class="grow" />
            </label>
            <label class="row">
              <span class="lbl">Base URL</span>
              <input v-model="settings.aiProviders[aiTab].baseUrl" type="text" class="grow" />
            </label>
            <!-- Connectivity test (#28): lightweight GET /v1/models (with chat fallback)
                 against the provider's Base URL using the entered API Key. Doesn't
                 touch settings.aiProvider — runs against the panel's edited values. -->
            <div class="row ai-test-row">
              <span class="lbl"></span>
              <div class="ai-test-cell">
                <button class="ai-test-btn" :disabled="aiTesting" @click="onTestAi">
                  {{ aiTesting ? '测试中…' : '测试连通' }}
                </button>
                <span
                  v-if="aiTestResult"
                  :class="['ai-test-result', aiTestResult.ok ? 'ok' : 'err']"
                  :title="aiTestResult.message"
                >
                  {{ aiTestResult.ok ? '✓' : '✗' }} {{ aiTestResult.message }}
                </span>
              </div>
            </div>
          </div>
          <p class="note">{{ t('settings.aiNote') }}</p>

          <!-- ── 记忆与画像（A/B/C 三档）── -->
          <h3 class="sub">{{ t('settings.mem.title') }}</h3>
          <p class="note">{{ t('settings.mem.note') }}</p>

          <!-- A 档：自由文本画像 -->
          <label class="row top">
            <span class="lbl">{{ t('settings.mem.aTitle') }}</span>
            <textarea
              v-model="settings.aiCustomInstructions"
              class="grow"
              rows="4"
              :placeholder="t('settings.mem.aPh')"
            />
          </label>

          <!-- B 档：结构化事实清单 -->
          <div class="mem-section">
            <div class="mem-head">
              <span class="lbl">{{ t('settings.mem.bTitle') }}</span>
              <label class="schk">
                <input v-model="settings.aiAutoExtractFacts" type="checkbox" />
                <span>{{ t('settings.mem.bAuto') }}</span>
              </label>
              <button class="ghost sm" :disabled="!settings.aiFacts.length" @click="onClearFacts">
                {{ t('settings.mem.bClear', { n: settings.aiFacts.length }) }}
              </button>
            </div>
            <div class="fact-add">
              <input v-model="newFact" type="text" :placeholder="t('settings.mem.bAddPh')" @keyup.enter="onAddFact" />
              <button @click="onAddFact" :disabled="!newFact.trim()">{{ t('settings.mem.bAdd') }}</button>
            </div>
            <ul class="fact-list">
              <li v-if="!settings.aiFacts.length" class="muted">{{ t('settings.mem.bEmpty') }}</li>
              <li v-for="f in settings.aiFacts" :key="f.id">
                <span>{{ f.text }}</span>
                <button class="fact-del" @click="onRemoveFact(f.id)" :title="t('common.remove')">✕</button>
              </li>
            </ul>
          </div>

          <!-- 嵌入端点：向量记忆 + RAG 共用，始终可配（不再藏在向量记忆开关后） -->
          <div class="mem-section">
            <div class="lbl" style="margin-bottom: 6px">{{ t('settings.mem.cEmbedHead') }}</div>
            <label class="row">
              <span class="lbl">{{ t('settings.mem.cBaseUrl') }}</span>
              <input v-model="settings.aiEmbeddingBaseUrl" class="grow" type="text" />
            </label>
            <label class="row">
              <span class="lbl">{{ t('settings.mem.cApiKey') }}</span>
              <input v-model="settings.aiEmbeddingApiKey" class="grow" type="password" :placeholder="t('settings.mem.cApiKeyPh')" />
            </label>
            <label class="row">
              <span class="lbl">{{ t('settings.mem.cModel') }}</span>
              <input v-model="settings.aiEmbeddingModel" class="grow" type="text" />
            </label>
            <p class="note">{{ t('settings.mem.cEmbedShared') }}</p>
          </div>

          <!-- C 档：向量记忆（仅控制记忆行为；嵌入端点见上） -->
          <div class="mem-section">
            <label class="row">
              <span class="lbl">{{ t('settings.mem.cToggle') }}</span>
              <input v-model="settings.aiVectorMemory" type="checkbox" />
              <span class="muted">{{ t('settings.mem.cToggleHint', { n: settings.aiVectorMemories.length }) }}</span>
            </label>
            <template v-if="settings.aiVectorMemory">
              <label class="row">
                <span class="lbl">{{ t('settings.mem.cTopK') }}</span>
                <input v-model.number="settings.aiVectorTopK" type="number" min="1" max="20" />
                <button class="ghost sm" :disabled="!settings.aiVectorMemories.length" @click="onClearVectors">
                  {{ t('settings.mem.cClear', { n: settings.aiVectorMemories.length }) }}
                </button>
              </label>
              <p class="note">{{ t('settings.mem.cNote') }}</p>
            </template>
          </div>
        </template>

        <!-- 应用更新 (electron-updater channel + 手动检查) -->
        <template v-if="active === 'updates'">
          <h3>{{ t('settings.cat.updates') }}</h3>
          <p class="note">{{ t('settings.updates.intro') }}</p>

          <div class="row col">
            <span class="lbl">{{ t('settings.updates.channel') }}</span>
            <div class="upd-channel">
              <button
                type="button"
                class="upd-ch-btn"
                :class="{ on: updateChannel === 'oss-cn' }"
                :title="t('settings.updates.ossTip')"
                @click="onChangeChannel('oss-cn')"
              >
                🇨🇳 {{ t('settings.updates.ossLabel') }}
              </button>
              <button
                type="button"
                class="upd-ch-btn"
                :class="{ on: updateChannel === 'github' }"
                :title="t('settings.updates.githubTip')"
                @click="onChangeChannel('github')"
              >
                🌐 {{ t('settings.updates.githubLabel') }}
              </button>
            </div>
            <p class="note small">
              {{ updateChannel === 'oss-cn'
                ? t('settings.updates.ossDesc')
                : t('settings.updates.githubDesc') }}
            </p>
          </div>

          <div class="row col">
            <span class="lbl">{{ t('settings.updates.checkNow') }}</span>
            <div class="upd-check">
              <button class="primary sm" :disabled="updateChecking" @click="onCheckUpdates">
                {{ updateChecking ? t('settings.updates.checking') : t('settings.updates.checkBtn') }}
              </button>
              <span v-if="updateStatus" class="upd-status">{{ updateStatus }}</span>
            </div>
            <p v-if="!updatePackagedMode" class="note small warn">
              {{ t('settings.updates.devModeNote') }}
            </p>
          </div>
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
/* #28 AI provider connectivity test row — button + inline status. */
.ai-test-row {
  align-items: flex-start;
}
.ai-test-cell {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}
.ai-test-btn {
  padding: 6px 14px;
  background: var(--panel, #2a2a2a);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.ai-test-btn:hover:not(:disabled) {
  border-color: var(--accent, #7c6cff);
}
.ai-test-btn:disabled {
  opacity: 0.6;
  cursor: progress;
}
.ai-test-result {
  font-size: 12px;
  word-break: break-all;
  min-width: 0;
}
.ai-test-result.ok {
  color: var(--ok, #4caf50);
}
.ai-test-result.err {
  color: var(--err, #e04050);
}
.hint {
  margin: 4px 0 8px 140px; /* 跟 .lbl 宽度对齐 */
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}
.link-btn {
  background: none;
  border: none;
  padding: 0 0 0 8px;
  color: var(--accent, #7c6cff);
  cursor: pointer;
  font-size: 12px;
  text-decoration: underline;
}
/* ── #13 数据脱敏规则编辑 ── */
.mask-rules {
  margin-left: 140px;
  padding: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.mask-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--muted);
}
.mask-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
}
.mask-row .m-name { width: 90px; }
.mask-row .m-pat { flex: 1; font-family: var(--font-mono); font-size: 12px; }
.mask-row .m-kind { width: 90px; }
.mask-row input, .mask-row select {
  padding: 3px 6px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 12px;
}
.chk { transform: scale(1.05); }
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
h3.sub {
  margin: 16px 0 4px;
  font-size: 13px;
  font-weight: 600;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.row.top {
  align-items: flex-start;
}
.row.top .lbl {
  padding-top: 6px;
}
.row textarea {
  width: 100%;
  resize: vertical;
  padding: 6px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-family: inherit;
  font-size: 12px;
  box-sizing: border-box;
}
.mem-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0;
}
.mem-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.mem-head .lbl {
  flex: none;
  width: 130px;
  color: var(--muted);
}
.mem-head .schk {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  margin-left: auto;
}
.fact-add {
  display: flex;
  gap: 6px;
}
.fact-add input {
  flex: 1;
  padding: 5px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 12px;
}
.fact-add button {
  padding: 5px 14px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}
.fact-add button:disabled {
  opacity: 0.4;
  cursor: default;
}
.fact-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow-y: auto;
}
.fact-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
}
.fact-list li.muted {
  color: var(--muted);
  border: none;
  font-style: italic;
  padding: 4px 0;
}
.fact-list li span {
  flex: 1;
  word-break: break-word;
}
.fact-del {
  background: transparent;
  border: none;
  color: var(--muted);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
}
.fact-del:hover {
  color: var(--err);
}
.ghost.sm {
  font-size: 11px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--muted);
  cursor: pointer;
}
.ghost.sm:disabled {
  opacity: 0.4;
  cursor: default;
}
.muted {
  color: var(--muted);
  font-size: 12px;
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
  font-family: var(--font-mono);
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

/* ── 应用更新 section ── */
.row.col {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}
.row.col .lbl {
  width: auto;
}
.upd-channel {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px;
  background: var(--bg);
  align-self: flex-start;
}
.upd-ch-btn {
  border: none;
  background: transparent;
  padding: 5px 14px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 12px;
  color: var(--muted);
  font-family: inherit;
}
.upd-ch-btn.on {
  background: var(--accent, #7c6cff);
  color: #fff;
  font-weight: 600;
}
.upd-ch-btn:not(.on):hover {
  color: var(--text);
}
.upd-check {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.primary.sm {
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 6px;
  background: var(--accent, #7c6cff);
  color: #fff;
  border: 1px solid var(--accent, #7c6cff);
  cursor: pointer;
  font-family: inherit;
}
.primary.sm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.upd-status {
  font-size: 12px;
  color: var(--muted);
}
.note.small {
  font-size: 11px;
  margin: 0;
}
.note.small.warn {
  color: var(--err, #e04050);
}
</style>
