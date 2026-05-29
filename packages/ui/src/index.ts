/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
export { default as Workspace } from './Workspace.vue'
export { DataClientKey, useDataClient } from './data-client'
export { type Locale, LOCALE_LABEL, locale, setLocale, t } from './i18n'
export {
  registerTreeAction,
  registerBuiltinSnippet,
  pluginTreeActions,
  pluginBuiltinSnippets,
} from './plugins'
export type { TreeAction } from './components/tree-actions'
