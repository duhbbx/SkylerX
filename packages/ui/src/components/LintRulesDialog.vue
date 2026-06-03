<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * SQL Linter 自定义规则编辑器
 *
 * 在内置 lint 规则之外,让用户加正则规则(禁用模式 / 命名风格 / 危险操作),
 * 存 localStorage,查询编辑器实时一起跑。带一个测试框即时看哪些规则命中。
 */
import { computed, ref } from 'vue'
import { locale } from '../i18n'
import type { LintSeverity } from '../sqlLint'
import {
  type CustomLintRule,
  lintCustom,
  loadCustomRules,
  newRuleId,
  ruleError,
  saveCustomRules,
} from '../sqlLintCustom'
import Modal from './Modal.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const L = (zh: string, en: string): string => (locale.value === 'en' ? en : zh)

const rules = ref<CustomLintRule[]>(loadCustomRules())
const testSql = ref('SELECT * FROM users;')

function persist(): void {
  saveCustomRules(rules.value)
}
function addRule(): void {
  rules.value.push({
    id: newRuleId(Date.now(), Math.random()),
    enabled: true,
    severity: 'warn',
    pattern: '',
    flags: 'i',
    message: '',
    stripComments: true,
  })
}
function removeRule(i: number): void {
  rules.value.splice(i, 1)
  persist()
}
const errorOf = (r: CustomLintRule): string | null => ruleError(r)
const testFindings = computed(() => lintCustom(testSql.value, rules.value))
const sevList: LintSeverity[] = ['error', 'warn', 'info']
</script>

<template>
  <Modal v-if="open" :title="L('SQL Linter 自定义规则', 'Custom SQL lint rules')" width="wide" @close="emit('close')">
    <div class="lr">
      <div class="bar">
        <button class="primary" @click="addRule">{{ L('+ 新增规则', '+ Add rule') }}</button>
        <span class="note">{{ L('正则匹配 SQL 即触发;在内置规则之外一起跑。改动自动保存。', 'Regex match on SQL triggers a finding; runs alongside built-in rules. Saved automatically.') }}</span>
      </div>

      <p v-if="!rules.length" class="note hint">{{ L('还没有自定义规则。点「新增规则」加一条,比如禁用 SELECT *、强制表名小写等。', 'No custom rules yet — add one, e.g. ban SELECT * or enforce lowercase table names.') }}</p>

      <div v-for="(r, i) in rules" :key="r.id" class="rule" :class="{ off: !r.enabled }">
        <label class="en"><input type="checkbox" v-model="r.enabled" @change="persist" /></label>
        <select v-model="r.severity" class="sev" @change="persist">
          <option v-for="s in sevList" :key="s" :value="s">{{ s }}</option>
        </select>
        <input v-model="r.pattern" class="pat" :placeholder="L('正则,如 SELECT\\s+\\*', 'regex, e.g. SELECT\\s+\\*')" @input="persist" />
        <input v-model="r.flags" class="flg" placeholder="flags" @input="persist" />
        <input v-model="r.message" class="msg" :placeholder="L('提示文案', 'message')" @input="persist" />
        <label class="sc"><input type="checkbox" v-model="r.stripComments" @change="persist" />{{ L('去注释', 'strip cmt') }}</label>
        <button class="del" @click="removeRule(i)">✕</button>
        <span v-if="errorOf(r)" class="err">⚠ {{ errorOf(r) }}</span>
      </div>

      <div class="test">
        <h4>{{ L('测试', 'Test') }}</h4>
        <textarea v-model="testSql" rows="3" class="ta"></textarea>
        <div class="findings">
          <span v-if="!testFindings.length" class="note">{{ L('无命中', 'no matches') }}</span>
          <span v-for="(f, i) in testFindings" :key="i" :class="['fd', f.severity]">{{ f.severity }} · {{ f.message }}</span>
        </div>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.lr { display: flex; flex-direction: column; gap: 10px; min-width: 720px; }
.bar { display: flex; align-items: center; gap: 12px; }
.note { font-size: 12px; color: var(--fg-muted, #888); }
.hint { background: var(--bg-subtle, #f7f7f7); padding: 8px 10px; border-radius: 6px; }
.rule { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 4px 0; border-bottom: 1px solid var(--border, #eee); }
.rule.off { opacity: .5; }
.sev { width: 72px; }
.pat { flex: 1 1 180px; font-family: monospace; }
.flg { width: 56px; }
.msg { flex: 1 1 160px; }
.sc { font-size: 11px; display: inline-flex; align-items: center; gap: 3px; }
.del { color: #c0392b; border: none; background: none; cursor: pointer; }
.err { font-size: 11px; color: #c0392b; flex-basis: 100%; }
.test { margin-top: 8px; }
.test h4 { margin: 0 0 4px; font-size: 13px; }
.ta { width: 100%; font-family: monospace; font-size: 12px; }
.findings { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.fd { font-size: 12px; padding: 2px 8px; border-radius: 4px; background: #f3f3f3; }
.fd.error { background: #fdecea; color: #c0392b; }
.fd.warn { background: #fff5e6; color: #c87f0a; }
.fd.info { background: #eef5ff; color: #2d7ff9; }
.primary { background: var(--accent, #2d7ff9); color: #fff; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; }
</style>
