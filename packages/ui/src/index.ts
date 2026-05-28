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
