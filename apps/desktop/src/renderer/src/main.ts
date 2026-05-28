// !! 这个 import 必须放最前 —— 在 monaco-editor 被任何代码路径加载之前，
// 先把中文翻译数组塞到 globalThis._VSCODE_NLS_MESSAGES（Monaco 的 NLS 全局），
// 否则 Cut/Copy/Paste/Change All Occurrences/Open Command Palette 这些内置菜单
// 拿不到翻译只能回退英文。
import '@db-tool/ui/monaco-nls'

import '@db-tool/ui/styles.css'
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
