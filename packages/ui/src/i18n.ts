import { ref } from 'vue'

/**
 * 轻量 i18n（不引第三方）：响应式当前语言 + 词条字典 + {name} 插值 + localStorage 持久化。
 *
 * 词条按 `key: [中文, English]` 成对维护，避免两套字典漂移。
 * 用法（组件 `<script setup>` 内）：import { t } from '../i18n'，模板里 {{ t('nav.title') }}。
 * `t()` 读取 `locale.value`，语言切换时使用它的模板/计算属性会自动重算。
 */
export type Locale = 'zh' | 'en'

const STORAGE_KEY = 'skylerx.locale'

function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* localStorage 不可用时忽略 */
  }
  if (typeof navigator !== 'undefined' && !/^zh/i.test(navigator.language)) return 'en'
  return 'zh' // 默认中文（主要用户群）
}

export const locale = ref<Locale>(detect())

export const LOCALE_LABEL: Record<Locale, string> = { zh: '简体中文', en: 'English' }

export function setLocale(l: Locale): void {
  const prev = locale.value
  locale.value = l
  try {
    localStorage.setItem(STORAGE_KEY, l)
  } catch {
    /* 忽略写入失败 */
  }
  // 同步切 Monaco NLS：对「未来新打开」的编辑器立刻生效；
  // 已渲染编辑器的内置菜单 label 由 Monaco 在模块加载期已缓存，需要刷新窗口才能完整跟随。
  if (prev !== l) {
    void import('./monaco-nls').then((m) => m.applyMonacoLocale(l))
    if (typeof window !== 'undefined') {
      // 异步弹应用主题的确认框，避免阻塞同步流程；Monaco 缓存的菜单文案要刷新窗口才能完整切换
      void import('./dialog').then(async ({ confirm: appConfirm }) => {
        const tip =
          l === 'zh'
            ? '语言已切换到中文。要立即刷新窗口以让 SQL 编辑器内置菜单（剪切/查找等）完整切换吗？'
            : 'Language switched to English. Reload the window now to fully apply the editor built-in menus?'
        if (await appConfirm({ message: tip, variant: 'info' })) window.location.reload()
      })
    }
  }
}

// key: [中文, English]
const DICT: Record<string, [string, string]> = {
  // ── 导航 / 通用 ──
  'nav.title': ['导航', 'Navigator'],
  'nav.newConn': ['新建连接', 'New connection'],
  'nav.refresh': ['刷新', 'Refresh'],
  'nav.settings': ['设置', 'Settings'],
  'nav.aiChat': ['AI 聊天侧边栏（⌘⇧L）', 'AI chat sidebar (⌘⇧L)'],
  'nav.empty': ['还没有连接，点上方 + 新建', 'No connections yet — click + above to add one'],
  'nav.loading': ['加载中…', 'Loading…'],
  'bulk.selected': ['已选 {n} 项', '{n} selected'],
  'bulk.delete': ['批量删除', 'Delete selected'],
  'bulk.copyNames': ['复制名', 'Copy names'],
  'common.cancel': ['取消', 'Cancel'],
  'common.done': ['完成', 'Done'],
  'common.delete': ['删除', 'Delete'],
  'common.confirm': ['确定', 'OK'],
  'common.run': ['执行', 'Run'],
  'common.copy': ['复制', 'Copy'],
  'common.refresh': ['刷新', 'Refresh'],
  'common.resetDefault': ['恢复默认', 'Reset to defaults'],
  'common.untitled': ['(未命名)', '(untitled)'],
  'common.loading': ['加载中…', 'Loading…'],
  'common.remove': ['移除', 'Remove'],

  // ── 设置 ──
  'settings.title': ['设置', 'Settings'],
  'settings.language': ['语言', 'Language'],
  'settings.theme': ['主题', 'Theme'],
  'settings.theme.dark': ['深色', 'Dark'],
  'settings.theme.light': ['浅色', 'Light'],
  'settings.pageSize': ['默认每页条数', 'Default rows per page'],
  'settings.fontSize': ['编辑器字号', 'Editor font size'],
  'settings.zoom': ['界面缩放', 'UI zoom'],
  'settings.zoomReset': ['重置', 'Reset'],
  'settings.tabSize': ['Tab 宽度', 'Tab size'],
  'settings.wordWrap': ['自动换行', 'Word wrap'],
  'settings.enableCompletion': ['启用补全', 'Enable autocompletion'],
  'settings.nullDisplay': ['NULL 显示', 'NULL display'],
  // ── 设置中心分类 ──
  'settings.cat.general': ['常规', 'General'],
  'settings.cat.editor': ['编辑器', 'Editor'],
  'settings.cat.grid': ['数据网格', 'Data grid'],
  'settings.cat.watermark': ['生产水印', 'Production watermark'],
  'settings.cat.ai': ['AI 助手', 'AI Assistant'],
  'settings.ai.active': ['激活的 Provider', 'Active provider'],
  // ── AI 记忆 ──
  'settings.mem.title': ['记忆与画像（A/B/C 三档）', 'Memory & profile (A/B/C tiers)'],
  'settings.mem.note': [
    '三档会按顺序拼到 system prompt 最前面：A（画像，自由文本，总注入）→ B（事实清单，全量）→ C（向量记忆，相关 top-K）。',
    'All three are prepended to the system prompt: A (free-form profile, always) → B (full facts list) → C (top-K relevant vector memories).',
  ],
  'settings.mem.aTitle': ['A · 我的画像', 'A · Profile'],
  'settings.mem.aPh': [
    '比如：「我常用 MySQL 8（utf8mb4）；主要在 orders / users / products 三张表上工作；写 SQL 偏好表别名单字母 + 列名 snake_case；不要解释基础概念，直接给 SQL」',
    'e.g.: "I use MySQL 8 (utf8mb4); work mainly on orders/users/products; prefer single-letter table aliases + snake_case columns; skip basic explanations, just give SQL."',
  ],
  'settings.mem.bTitle': ['B · 事实清单', 'B · Facts'],
  'settings.mem.bAuto': ['每轮自动抽取', 'Auto-extract each turn'],
  'settings.mem.bAdd': ['添加', 'Add'],
  'settings.mem.bAddPh': [
    '一条短事实（如：用户名约束至少 6 位）',
    'One short fact (e.g., "username must be ≥6 chars")',
  ],
  'settings.mem.bEmpty': [
    '（暂无事实；可以手动添加或开启「每轮自动抽取」）',
    '(no facts yet; add manually or enable auto-extract)',
  ],
  'settings.mem.bClear': ['清空（{n}）', 'Clear ({n})'],
  'settings.mem.bClearConfirm': [
    '确定清空所有事实？此操作不可撤销。',
    'Clear all facts? This cannot be undone.',
  ],
  'settings.mem.cToggle': ['C · 向量记忆', 'C · Vector memory'],
  'settings.mem.cToggleHint': ['当前已存 {n} 条', '{n} memories stored'],
  'settings.mem.cBaseUrl': ['Embedding Base URL', 'Embedding base URL'],
  'settings.mem.cApiKey': ['Embedding API Key', 'Embedding API key'],
  'settings.mem.cApiKeyPh': [
    'sk-…（与上面 AI provider 可不同；推荐 OpenAI 兼容端点）',
    'sk-… (can differ from AI provider; OpenAI-compatible endpoint)',
  ],
  'settings.mem.cModel': ['模型', 'Model'],
  'settings.mem.cTopK': ['检索 top-K', 'Top-K recall'],
  'settings.mem.cClear': ['清空（{n}）', 'Clear ({n})'],
  'settings.mem.cClearConfirm': [
    '确定清空所有向量记忆？此操作不可撤销。',
    'Clear all vector memories? This cannot be undone.',
  ],
  'settings.mem.cNote': [
    'Anthropic 没有 embeddings 端点；推荐填 OpenAI / DeepSeek 兼容地址。embedding 调用走主进程绕过 CORS。',
    'Anthropic has no embeddings endpoint; use OpenAI / DeepSeek-compatible URL. Calls go through the main process to bypass CORS.',
  ],

  'settings.ai.tabsHint': [
    '点击 provider 标签 = 同时切换为「当前激活」并编辑该 provider 的配置。',
    'Clicking a provider tab activates it and lets you edit its config.',
  ],
  'settings.ai.activeNote': [
    '{name} 已是当前激活的 provider',
    '{name} is the currently active provider',
  ],
  'settings.ai.notActive': [
    '你在编辑 {name} 的配置，但当前激活的不是它。',
    'You are editing {name} but it is not the active provider.',
  ],
  'settings.ai.setActive': ['设为当前激活', 'Set as active'],
  'settings.watermark.note': [
    '为标记为「生产环境」的连接，在所有查询页平铺斜向水印（仅 UI，不影响 SQL）。',
    'For connections marked as production, tile a diagonal watermark across all query panes (UI-only).',
  ],
  'settings.watermark.text': ['水印文字', 'Watermark text'],
  'settings.watermark.opacity': ['不透明度', 'Opacity'],
  'settings.watermark.angle': ['倾斜角度', 'Angle'],
  'settings.watermark.size': ['字号', 'Font size'],
  'settings.watermark.color': ['颜色', 'Color'],
  'settings.aiSection': ['AI 助手', 'AI Assistant'],
  'settings.aiApiKey': ['API Key', 'API Key'],
  'settings.aiApiKeyPh': ['sk-ant-…（仅本地保存）', 'sk-ant-… (stored locally only)'],
  'settings.aiModel': ['模型', 'Model'],
  'settings.aiBaseUrl': ['Base URL', 'Base URL'],
  'settings.aiNote': [
    'API Key 仅保存在本机 localStorage；请求直连 Anthropic（或自定义代理）。',
    'API key is stored only in localStorage on this device; requests go directly to Anthropic (or your proxy).',
  ],
  'settings.keywordCase': ['SQL 格式化关键字', 'SQL keyword case'],
  'settings.keywordCase.upper': ['大写 UPPER', 'UPPER'],
  'settings.keywordCase.lower': ['小写 lower', 'lower'],
  'settings.keywordCase.preserve': ['保持原样', 'Preserve'],
  'settings.note': [
    '设置即时生效并本地保存；字号对新打开的编辑器生效。',
    'Changes apply instantly and are saved locally; font size affects newly opened editors.',
  ],

  // ── 查询页 QueryPane ──
  'query.run': ['执行', 'Run'],
  'query.run.title': [
    '执行（选中则只跑选区） ⌘/Ctrl+Enter',
    'Run (selection only, if any) ⌘/Ctrl+Enter',
  ],
  'query.runToCursor': ['运行到此', 'Run to cursor'],
  'query.runToCursor.title': ['只执行光标之前的 SQL', 'Run only the SQL before the cursor'],
  'query.compress': ['压缩', 'Compress'],
  'query.compress.title': ['去注释并压缩为单行', 'Strip comments and collapse to one line'],
  'query.stripComments': ['去注释', 'Strip comments'],
  'query.stripComments.title': ['去除 SQL 中的注释', 'Remove comments from the SQL'],
  'query.explain': ['解释', 'Explain'],
  'query.explain.title': ['解释执行计划 (EXPLAIN)', 'Explain plan (EXPLAIN)'],
  'query.format': ['格式化', 'Format'],
  'query.format.title': ['格式化 SQL', 'Format SQL'],
  'query.stop': ['停止', 'Stop'],
  'query.clear': ['清空', 'Clear'],
  'query.saveSnippet': ['存为片段', 'Save snippet'],
  'query.saveSnippet.title': [
    '把选中语句（无选区则全部）存为片段',
    'Save selected statement (or all) as a snippet',
  ],
  'query.hint': [
    '⌘/Ctrl+Enter 执行（选中则只跑选区）',
    '⌘/Ctrl+Enter to run (selection only, if any)',
  ],
  'query.defaultDb': ['（默认库）', '(default database)'],
  'query.defaultSchema': ['（默认 schema）', '(default schema)'],
  'query.splitterTitle': ['拖拽调整高度', 'Drag to resize'],
  'query.tabResult': ['结果 {n}', 'Result {n}'],
  'query.tabPlan': ['计划', 'Plan'],
  'query.tabHistory': ['历史', 'History'],
  'query.tabSnippets': ['片段', 'Snippets'],
  'query.paramsTitle': ['填写查询参数', 'Fill query parameters'],
  'query.paramsPlaceholder': [
    '数字原样 · 文本自动加引号 · 留空=NULL',
    'Numbers as-is · text auto-quoted · empty = NULL',
  ],
  'query.explainUnsupported': [
    '当前数据库方言暂不支持「解释」',
    'EXPLAIN is not supported for this dialect',
  ],
  'query.explainFailed': ['解释失败：{msg}', 'Explain failed: {msg}'],
  'query.commitFailed': ['提交失败：{msg}', 'Commit failed: {msg}'],
  'query.commitFailedTitle': ['提交失败', 'Commit failed'],
  'query.commitPreviewTitle': [
    '提交前预览（{n} 条语句）',
    'Preview before commit ({n} statements)',
  ],
  'query.commitConfirm': ['确认执行', 'Execute'],
  'query.snippetNamePrompt': ['片段名称', 'Snippet name'],
  'query.snippetTagsPrompt': ['标签（逗号分隔，可留空）', 'Tags (comma-separated, optional)'],
  'query.dangerDeleteNoWhere': ['DELETE 无 WHERE：{sql}', 'DELETE without WHERE: {sql}'],
  'query.dangerUpdateNoWhere': ['UPDATE 无 WHERE：{sql}', 'UPDATE without WHERE: {sql}'],
  'query.prodDanger': [
    '⚠️ 这是【生产】连接的高危操作：\n\n{dangers}\n\n如确认执行，请键入连接名「{name}」：',
    '⚠️ Dangerous operation on a PRODUCTION connection:\n\n{dangers}\n\nType the connection name "{name}" to proceed:',
  ],
  'query.dangerConfirm': [
    '⚠️ 检测到高危操作：\n\n{dangers}\n\n确定执行？',
    '⚠️ Dangerous operation detected:\n\n{dangers}\n\nProceed?',
  ],
  'query.dangerTitle': ['高危操作确认', 'Dangerous operation'],
  // ── 手动提交 ──
  'commit.mode': ['提交模式', 'Commit mode'],
  'commit.modeAuto': ['自动提交', 'Auto commit'],
  'commit.modeManual': ['手动提交', 'Manual commit'],
  'commit.modeInherit': ['跟随全局', 'Inherit global'],
  'commit.modeAutoDesc': [
    '每条 SQL 立即提交（默认）',
    'Each statement commits immediately (default)',
  ],
  'commit.modeManualDesc': [
    '需要点「提交 / 回滚」才会落库；适合做批量改动前的演练',
    'Changes require explicit Commit / Rollback; good for staged edits',
  ],
  'commit.commit': ['提交', 'Commit'],
  'commit.commitTitle': [
    '提交当前事务（COMMIT），并自动开始下一个事务',
    'Commit current transaction (COMMIT) and begin the next one',
  ],
  'commit.rollback': ['回滚', 'Rollback'],
  'commit.rollbackTitle': [
    '回滚未提交改动（ROLLBACK），并自动开始下一个事务',
    'Roll back pending changes (ROLLBACK) and begin the next one',
  ],
  'commit.rollbackConfirm': [
    '当前事务里有未提交的改动，确定全部回滚？',
    'Pending changes will be discarded. Roll back?',
  ],
  'commit.dirty': ['有未提交', 'Pending'],
  'commit.dirtyTitle': [
    '当前事务里有写操作但还没提交',
    'Uncommitted writes in current transaction',
  ],
  'commit.clean': ['干净', 'Clean'],
  'commit.cleanTitle': ['当前事务没有未提交的写操作', 'No uncommitted writes'],
  'commit.committed': ['已提交', 'Committed'],
  'commit.rolledBack': ['已回滚', 'Rolled back'],
  'commit.commitFail': ['提交失败：{msg}', 'Commit failed: {msg}'],
  'commit.rollbackFail': ['回滚失败：{msg}', 'Rollback failed: {msg}'],
  'commit.unsupported': [
    '当前方言暂不支持手动提交，已自动按"自动提交"执行。MySQL / PostgreSQL 可用。',
    'Manual commit not supported for this dialect; falling back to auto. Available on MySQL / PostgreSQL.',
  ],
  'commit.closePendingTitle': ['有未提交事务', 'Uncommitted transaction'],
  'commit.closePending': [
    '该查询页处于手动提交模式且仍有未提交改动。\n\n选「提交」会执行 COMMIT 落库；选「回滚」会 ROLLBACK 放弃。',
    'This tab is in manual commit mode with pending changes.\n\n"Commit" runs COMMIT; "Rollback" discards them.',
  ],
  'query.readOnlyBlocked': [
    '🔒 该连接为只读模式，已拦截写操作：\n\n{sql}',
    '🔒 This connection is read-only; write blocked:\n\n{sql}',
  ],
  'completion.function': ['函数', 'function'],
  'completion.snippet': ['片段', 'snippet'],
  'completion.table': ['表', 'table'],
  'env.dangerTitle': [
    '环境：{label}（高危操作需键入连接名确认）',
    'Environment: {label} (dangerous ops require typing the connection name)',
  ],

  // ── 结果网格 ResultGrid ──
  'grid.running': ['执行中…', 'Running…'],
  'grid.empty': [
    '在上方输入 SQL，⌘/Ctrl+Enter 或点「运行」执行',
    'Type SQL above, then ⌘/Ctrl+Enter or Run',
  ],
  'grid.errorTitle': ['执行报错', 'Execution failed'],
  'grid.execOk': ['执行成功', 'Executed successfully'],
  'grid.addRow': ['新增行', 'Add row'],
  'grid.delRow': ['删除选中行', 'Delete selected rows'],
  'grid.commit': ['提交', 'Commit'],
  'grid.commitTitle': ['提交修改', 'Commit changes'],
  'grid.revert': ['还原', 'Revert'],
  'grid.changes': ['{n} 项改动', '{n} change(s)'],
  'grid.selectedRows': ['已选 {n} 行', '{n} row(s) selected'],
  'grid.editHint': [
    '双击单元格编辑 · 单击选行（⌘/Shift 多选）',
    'Double-click to edit · click to select row (⌘/Shift to multi-select)',
  ],
  'grid.filterPh': ['🔍 筛选当前页…', '🔍 Filter current page…'],
  'grid.copy': ['复制 ▾', 'Copy ▾'],
  'grid.selRows': ['选中行', 'Selected'],
  'grid.all': ['全部', 'All'],
  'grid.cols': ['列 ▾', 'Columns ▾'],
  'grid.viewGrid': ['网格', 'Grid'],
  'grid.viewJson': ['JSON', 'JSON'],
  'grid.viewForm': ['表单', 'Form'],
  'grid.freeze': ['冻结首列', 'Freeze 1st column'],
  'grid.summary': ['汇总', 'Summary'],
  'grid.summaryTitle': [
    '显示汇总行（数值列求和/均值，其余计非空数）',
    'Show summary row (SUM/AVG for numeric, COUNT otherwise)',
  ],
  'grid.sortHint': [
    '点列头排序 · 双击单元格查看 · 点行号看整行',
    'Click header to sort · double-click cell to view · click row number for full row',
  ],
  'grid.filterColTitle': ['筛选该列（生成 WHERE）', 'Filter column (builds WHERE)'],
  'grid.resizeColTitle': ['拖拽调整列宽', 'Drag to resize column'],
  'grid.viewRowTitle': ['查看整行', 'View full row'],
  'grid.cellEditorTitle': ['大文本 / JSON 编辑器', 'Large text / JSON editor'],
  'grid.prevPage': ['‹ 上一页', '‹ Prev'],
  'grid.nextPage': ['下一页 ›', 'Next ›'],
  'grid.pageInfo': ['第 {n} 页', 'Page {n}'],
  'grid.perPage': ['每页', 'Per page'],
  'grid.jumpTo': ['跳至', 'Go to'],
  'grid.jump': ['跳转', 'Go'],
  'grid.rowCount': ['{n} 行', '{n} rows'],
  'grid.affected': ['影响 {n} 行', '{n} rows affected'],
  'grid.truncated': ['（已截断）', '(truncated)'],
  'grid.exportTitle': ['导出结果', 'Export results'],
  'grid.export': ['导出 ▾', 'Export ▾'],
  'grid.cellTitle': ['单元格 · {col}', 'Cell · {col}'],
  'grid.rowTitle': ['第 {n} 行', 'Row {n}'],
  'grid.apply': ['应用', 'Apply'],
  'grid.setNull': ['设为 NULL', 'Set NULL'],
  'grid.setDefault': ['设为 DEFAULT', 'Set DEFAULT'],
  'grid.fkJump': ['→ {tbl}', '→ {tbl}'],
  'grid.fkJumpTitle': [
    '打开新查询页：{tbl}.{col} = 当前值',
    'Open new query: {tbl}.{col} = current value',
  ],
  'grid.revFkTitle': ['被以下 {n} 张表引用：', 'Referenced by {n} table(s):'],
  'grid.copyHex': ['复制 Hex', 'Copy hex'],
  'grid.copyAsSql': ['复制为 SQL', 'Copy as SQL'],
  'grid.prevRow': ['‹ 上一行', '‹ Prev row'],
  'grid.nextRow': ['下一行 ›', 'Next row ›'],
  'grid.copyJson': ['复制为 JSON', 'Copy as JSON'],
  'grid.exportPrompt': ['SQL 导出：目标表名', 'SQL export: target table name'],
  'grid.filterPrompt': [
    "筛选「{col}」——输入条件（如  = 5  /  > 10  /  LIKE '%a%'  /  IS NULL），留空清除",
    'Filter "{col}" — condition (e.g. = 5 / > 10 / LIKE \'%a%\' / IS NULL); empty to clear',
  ],

  // ── 环境标记 ──
  'env.dev': ['开发', 'Dev'],
  'env.test': ['测试', 'Test'],
  'env.prod': ['生产', 'Prod'],
  'env.dotTitle': ['环境：{label}', 'Environment: {label}'],

  // ── 连接表单 ConnectionForm ──
  'conn.failed': ['✗ 连接失败：{msg}', '✗ Connection failed: {msg}'],
  'conn.tab.general': ['常规', 'General'],
  'conn.tab.ssh': ['SSH 隧道', 'SSH tunnel'],
  'conn.name': ['名称', 'Name'],
  'conn.name.ph': ['本地 MySQL', 'Local MySQL'],
  'conn.dialect': ['数据库类型', 'Database type'],
  'conn.host': ['主机', 'Host'],
  'conn.port': ['端口', 'Port'],
  'conn.user': ['用户名', 'Username'],
  'conn.password': ['密码', 'Password'],
  'conn.database': ['默认库', 'Default database'],
  'conn.optional': ['可选', 'Optional'],
  'conn.group': ['分组', 'Group'],
  'conn.group.ph': ['可选，如 生产 / 测试', 'Optional, e.g. Prod / Test'],
  'conn.env': ['环境', 'Environment'],
  'conn.env.none': ['未标记', 'Unset'],
  'conn.readOnly': ['只读', 'Read-only'],
  'conn.readOnlyTitle': [
    '只读连接：拦截一切写操作（仅放行 SELECT/SHOW/EXPLAIN 等）',
    'Read-only connection: blocks all writes (allows SELECT/SHOW/EXPLAIN only)',
  ],
  'conn.ssl.enable': ['启用 SSL', 'Enable SSL'],
  'conn.ssl.verify': ['校验服务端证书', 'Verify server certificate'],
  'conn.ssl.ca': ['CA 证书', 'CA certificate'],
  'conn.ssl.caPh': ['CA 证书 PEM 内容（可选）', 'CA cert PEM (optional)'],
  'conn.ssl.cert': ['客户端证书', 'Client certificate'],
  'conn.ssl.certPh': ['客户端证书 PEM（可选）', 'Client cert PEM (optional)'],
  'conn.ssl.key': ['客户端私钥', 'Client private key'],
  'conn.ssl.keyPh': ['客户端私钥 PEM（可选）', 'Client key PEM (optional)'],
  'conn.ssh.enable': ['启用 SSH 隧道', 'Enable SSH tunnel'],
  'conn.ssh.host': ['跳板机主机', 'Jump host'],
  'conn.ssh.port': ['跳板机端口', 'Jump port'],
  'conn.ssh.user': ['SSH 用户名', 'SSH username'],
  'conn.ssh.password': ['SSH 密码', 'SSH password'],
  'conn.ssh.passwordPh': ['密码或私钥二选一', 'Password or private key'],
  'conn.ssh.key': ['私钥', 'Private key'],
  'conn.ssh.keyPh': ['私钥 PEM 内容（可选）', 'Private key PEM (optional)'],
  'conn.ssh.passphrase': ['私钥口令', 'Key passphrase'],
  'conn.save': ['保存', 'Save'],
  'conn.create': ['创建', 'Create'],
  'conn.test': ['测试连接', 'Test connection'],
  'conn.ok': ['✓ 连接成功', '✓ Connected'],
  'conn.removeConfirm': ['确定删除该连接？', 'Delete this connection?'],

  // ── 表设计器 TableDesigner ──
  'designer.tab.fields': ['字段', 'Fields'],
  'designer.tab.indexes': ['索引', 'Indexes'],
  'designer.tab.fk': ['外键', 'Foreign keys'],
  'designer.tab.unique': ['唯一键', 'Unique'],
  'designer.tab.check': ['检查', 'Checks'],
  'designer.tab.trigger': ['触发器', 'Triggers'],
  'designer.tab.options': ['选项', 'Options'],
  'designer.tab.storage': ['存储', 'Storage'],
  'designer.tab.comment': ['注释', 'Comment'],
  'designer.tab.sql': ['SQL 预览', 'SQL preview'],
  'designer.noChanges': ['-- 无字段 / 约束变更', '-- no column / constraint changes'],
  'designer.noApply': ['没有可应用的变更', 'No changes to apply'],
  'designer.needName': ['请输入表名', 'Please enter a table name'],
  'designer.needField': ['至少需要一个有效字段', 'At least one valid field is required'],
  'designer.saveAsPrompt': ['另存为（新表名）', 'Save as (new table name)'],
  'designer.alterBadge': ['修改表', 'Alter table'],
  'designer.new': ['新建', 'New'],
  'designer.save': ['保存', 'Save'],
  'designer.saving': ['保存中…', 'Saving…'],
  'designer.saveAs': ['另存为', 'Save as'],
  'designer.addField': ['添加字段', 'Add field'],
  'designer.insertField': ['插入字段', 'Insert field'],
  'designer.deleteField': ['删除字段', 'Delete field'],
  'designer.pk': ['主键', 'PK'],
  'designer.up': ['上移', 'Up'],
  'designer.down': ['下移', 'Down'],
  'designer.tableName': ['表名', 'Table name'],
  'designer.newTableName': ['新表名', 'New table name'],
  'designer.loadingStruct': ['加载结构中…', 'Loading structure…'],
  'designer.h.name': ['名称', 'Name'],
  'designer.h.fieldName': ['字段名', 'Field'],
  'designer.h.type': ['类型', 'Type'],
  'designer.h.length': ['长度', 'Length'],
  'designer.h.scale': ['小数点', 'Scale'],
  'designer.h.allowNull': ['允许 NULL', 'Allow NULL'],
  'designer.h.pk': ['主键', 'PK'],
  'designer.h.default': ['默认值', 'Default'],
  'designer.h.comment': ['注释', 'Comment'],
  'designer.h.colsComma': ['字段(逗号分隔)', 'Columns (comma-separated)'],
  'designer.h.cols': ['字段', 'Columns'],
  'designer.h.unique': ['唯一', 'Unique'],
  'designer.h.indexType': ['类型', 'Method'],
  'designer.h.refTable': ['引用表', 'Ref table'],
  'designer.h.refCols': ['引用字段', 'Ref columns'],
  'designer.h.expr': ['表达式', 'Expression'],
  'designer.addIndex': ['+ 添加索引', '+ Add index'],
  'designer.addFk': ['+ 添加外键', '+ Add foreign key'],
  'designer.addUnique': ['+ 添加唯一键', '+ Add unique'],
  'designer.addCheck': ['+ 添加检查', '+ Add check'],
  'designer.exprPh': ['如 age >= 0', 'e.g. age >= 0'],
  'designer.triggerNote': [
    '触发器需在表创建后单独管理（CREATE TRIGGER）。可在表创建完后用查询页添加。',
    'Triggers are managed separately after the table exists (CREATE TRIGGER). Add them via the query page.',
  ],
  'designer.engine': ['引擎', 'Engine'],
  'designer.charset': ['字符集', 'Charset'],
  'designer.rowFormat': ['行格式', 'Row format'],
  'designer.autoIncStart': ['AUTO_INCREMENT 起始', 'AUTO_INCREMENT start'],
  'designer.noOptions': ['当前方言无额外表选项。', 'No extra table options for this dialect.'],
  'designer.storageNote': [
    '表空间 / 存储参数（方言相关，暂未提供 UI）。',
    'Tablespace / storage parameters (dialect-specific, no UI yet).',
  ],
  'designer.commentPh': ['表注释', 'Table comment'],
  'designer.fieldProps': ['字段属性：{name}', 'Field properties: {name}'],
  'designer.unsigned': ['无符号 UNSIGNED', 'UNSIGNED'],
  'designer.autoInc': ['自增 AUTO_INCREMENT', 'AUTO_INCREMENT'],
  'designer.onUpdateNow': ['ON UPDATE CURRENT_TIMESTAMP', 'ON UPDATE CURRENT_TIMESTAMP'],
  'designer.colCharset': ['字符集', 'Charset'],
  'designer.colCharsetPh': ['utf8mb4', 'utf8mb4'],
  'designer.colCollation': ['排序规则', 'Collation'],
  'designer.colCollationPh': ['utf8mb4_unicode_ci', 'utf8mb4_unicode_ci'],
  'designer.copyDdl': ['复制 DDL', 'Copy DDL'],
  'designer.compressDdl': ['压缩为单行', 'Compress to one line'],
  'designer.idxColsPh': ['col1, col2(10) DESC', 'col1, col2(10) DESC'],
  'designer.idxColsTitle': [
    '多列逗号分隔；可加前缀长度 col(10)（MySQL）与排序 ASC/DESC',
    'Comma-separated; supports col(10) prefix (MySQL) and ASC/DESC',
  ],
  'designer.zerofill': ['ZEROFILL', 'ZEROFILL'],
  'designer.wherePh': ['status = 1', 'status = 1'],
  'designer.concurrentTitle': [
    'CONCURRENTLY：在线建索引（PG，不锁表）',
    'CONCURRENTLY: build the index without locking the table (PG)',
  ],
  'designer.inheritsPh': ['parent_table', 'parent_table'],
  'designer.generated': ['生成列表达式', 'Generated expression'],
  'designer.generatedPh': [
    '如 price * qty（留空=普通列）',
    'e.g. price * qty (empty = normal column)',
  ],

  // ── 通用补充 ──
  'common.close': ['关闭', 'Close'],
  'common.resizeHint': [
    '拖动右下角调整大小（会自动记住）',
    'Drag the bottom-right corner to resize (auto-saved)',
  ],
  'common.unsavedConfirm': [
    '当前表单有未保存的修改，确认丢弃并关闭吗？',
    'You have unsaved changes. Discard and close?',
  ],
  'common.none': ['（无）', '(none)'],
  'diff.onlyMyPg': ['暂仅支持 MySQL / PostgreSQL 系方言', 'MySQL / PostgreSQL dialects only'],
  'diff.onlyMyPgShort': ['暂仅支持 MySQL / PostgreSQL 系', 'MySQL / PostgreSQL only'],
  'diff.selectConn': ['选择连接', 'Select connection'],
  'diff.schemaPh': ['库/schema', 'database/schema'],
  'diff.comparing': ['对比中…', 'Comparing…'],
  'diff.compare': ['对比', 'Compare'],
  'diff.openTarget': ['在目标查询页打开', 'Open in target query page'],

  // ── 全局对象搜索 ObjectSearchDialog ──
  'osearch.title': ['全局对象搜索', 'Global object search'],
  'osearch.ph': [
    '搜表 / 视图 / 列名（≥2 字，回车）',
    'Search tables / views / columns (≥2 chars, Enter)',
  ],
  'osearch.unsupported': [
    '该连接方言暂不支持搜索（仅 MySQL / PostgreSQL 系）',
    'Search not supported for this dialect (MySQL / PostgreSQL only)',
  ],
  'osearch.searching': ['搜索中…', 'Searching…'],
  'osearch.noMatch': ['无匹配对象', 'No matching objects'],
  'osearch.min': ['输入至少 2 个字符', 'Type at least 2 characters'],
  'osearch.col': ['列', 'Column'],
  'osearch.view': ['视图', 'View'],
  'osearch.table': ['表', 'Table'],
  'osearch.previewTitle': ['查询前 200 行', 'Preview first 200 rows'],
  'osearch.preview': ['预览', 'Preview'],
  'osearch.foot': [
    '点击结果在导航树中定位选中；「预览」查询前 200 行',
    'Click a result to locate it in the tree; "Preview" shows first 200 rows',
  ],

  // ── 操作日志 OperationLogDialog ──
  'oplog.title': ['操作日志', 'Operation log'],
  'oplog.searchPh': ['搜索 SQL…', 'Search SQL…'],
  'oplog.statusAll': ['全部状态', 'All statuses'],
  'oplog.statusOk': ['成功', 'Succeeded'],
  'oplog.statusErr': ['失败', 'Failed'],
  'oplog.allConns': ['全部连接', 'All connections'],
  'oplog.exportCsv': ['导出 CSV', 'Export CSV'],
  'oplog.empty': ['无匹配的执行记录', 'No matching execution records'],
  'oplog.foot': [
    '共 {n} 条 · 点击任一行可在对应连接打开该 SQL',
    '{n} records · click a row to open the SQL on its connection',
  ],

  // ── 服务器监控 ServerMonitorDialog ──
  'monitor.title': ['服务器监控', 'Server monitor'],
  'monitor.unsupported': [
    '服务器监控目前支持 MySQL / PostgreSQL 系连接',
    'Server monitoring currently supports MySQL / PostgreSQL connections',
  ],
  'monitor.uptime': ['运行时长', 'Uptime'],
  'monitor.qps': ['每秒查询(QPS)', 'Queries/s (QPS)'],
  'monitor.tps': ['每秒事务(TPS)', 'Txns/s (TPS)'],
  'monitor.connections': ['连接数', 'Connections'],
  'monitor.running': ['活动', 'Active'],
  'monitor.waiting': ['等待锁', 'Waiting on lock'],
  'monitor.slow': ['慢查询累计', 'Slow queries (total)'],
  'monitor.aborted': ['失败连接累计', 'Aborted connects (total)'],
  'monitor.cacheHit': ['缓存命中率', 'Cache hit ratio'],
  'monitor.foot': [
    '每 2 秒刷新 · QPS/TPS 由计数器增量估算',
    'Refreshes every 2s · QPS/TPS estimated from counter deltas',
  ],

  // ── 关于 ──
  'about.title': ['关于', 'About'],
  'about.tag': [
    '现代数据库管理工具 · 桌面端 + Web 端',
    'Modern database management · Desktop + Web',
  ],
  'about.version': ['版本', 'Version'],
  'about.license': ['许可', 'License'],
  'about.repo': ['仓库', 'Repository'],
  'about.issues': ['反馈', 'Feedback'],
  'about.fileIssue': ['提交 Issue', 'File an issue'],
  'about.update': ['更新', 'Update'],
  'about.check': ['检查更新', 'Check for updates'],
  'about.checking': ['检查中…', 'Checking…'],
  'about.upToDate': ['已是最新', 'Up to date'],
  'about.newer': ['有新版本 v{v}', 'Newer version v{v} available'],

  // ── AI 助手 AiAssistantDialog ──
  'ai.title': ['AI 助手', 'AI Assistant'],
  'ai.modeNl2sql': ['自然语言 → SQL', 'NL → SQL'],
  'ai.modeExplain': ['解释 SQL', 'Explain SQL'],
  'ai.modeOptimize': ['优化建议', 'Optimize'],
  'ai.modeDiagnose': ['错误诊断', 'Diagnose error'],
  'ai.useSchema': ['附带库结构', 'Include schema'],
  'ai.phNl': [
    '用一句话描述你想做的事，例如：找出最近 7 天注册的用户',
    'Describe what you want, e.g.: find users registered in the last 7 days',
  ],
  'ai.phSql': ['粘贴 SQL 语句…', 'Paste SQL here…'],
  'ai.phError': ['数据库返回的错误信息…', 'Database error message…'],
  'ai.ask': ['询问', 'Ask'],
  'ai.stop': ['停止', 'Stop'],
  'ai.insert': ['插入到查询页', 'Open as draft'],
  'ai.configure': ['配置 API Key', 'Configure API key'],
  'ai.noKey': [
    '未配置 API Key — 请打开「设置 → AI 助手」填入',
    'No API key configured — open "Settings → AI Assistant"',
  ],
  'ai.schemaUnsupported': [
    '库结构上下文仅支持 MySQL/PG 系连接',
    'Schema context only supports MySQL/PG connections',
  ],
  'ai.schemaEmpty': [
    '未拉取到库结构（请确认连接默认库已设置）',
    'No schema fetched (check connection default database)',
  ],
  'ai.tabTitle': ['AI 草稿', 'AI draft'],
  'ai.foot': [
    '请求按「设置 → AI 助手」里激活的 provider 直发；模型回答仅供参考，执行前请人工核查。',
    'Requests go directly to the active provider configured in Settings → AI Assistant; always review SQL before running.',
  ],

  // ── 查询页 AI 按钮 ──
  'query.ai': ['AI', 'AI'],
  'query.ai.title': [
    '用 AI 解释 / 诊断 / 优化当前 SQL（有错误自动切到诊断）',
    'Explain / diagnose / optimize current SQL with AI (diagnose mode if error present)',
  ],
  'query.more': ['更多操作', 'More actions'],

  // ── Monaco 右键自定义动作（addAction 标签；按 locale 实时重注册） ──
  'editor.action.run': ['▶ 运行 SQL', '▶ Run SQL'],
  'editor.action.runSelection': ['▶ 运行选中', '▶ Run selection'],
  'editor.action.formatAll': ['格式化', 'Format'],
  'editor.action.compress': ['压缩为单行', 'Compress to single line'],
  'editor.action.stripComments': ['去除注释', 'Strip comments'],
  'editor.action.saveSnippet': ['存为片段…', 'Save as snippet…'],
  'editor.action.favorite': ['★ 收藏为查询', '★ Favorite as query'],
  'editor.action.aiExplain': ['✨ AI 解释 / 优化', '✨ AI explain / optimize'],
  'query.fkTabTitle': ['→ {tbl} (FK)', '→ {tbl} (FK)'],
  'query.favorite': ['收藏', 'Favorite'],
  'query.favoriteTitle': [
    '把当前选区/全部 SQL 加入收藏夹',
    'Add current selection / SQL to favorites',
  ],
  'query.favName': ['给这条查询起个名字：', 'Name this query:'],
  'query.favTag': ['分组标签（可留空）：', 'Group tag (optional):'],

  // ── 结构对比 SchemaDiffDialog ──
  'sdiff.status.added': ['新增表', 'New table'],
  'sdiff.status.changed': ['改表', 'Changed'],
  'sdiff.status.removed': ['仅目标有', 'Target-only'],
  'sdiff.title': ['结构对比（源 → 目标）', 'Schema diff (source → target)'],
  'sdiff.srcConn': ['源连接', 'Source connection'],
  'sdiff.tgtConn': ['目标连接（将被改成与源一致）', 'Target connection (will match source)'],
  'sdiff.identical': ['结构一致 ✓', 'Identical ✓'],
  'sdiff.diffLabel': ['差异：', 'Diff: '],
  'sdiff.added': ['新增表', 'new'],
  'sdiff.changed': ['改表', 'changed'],
  'sdiff.removed': ['仅目标有', 'target-only'],
  'sdiff.migSql': ['迁移 SQL（在目标执行）', 'Migration SQL (run on target)'],

  // ── 数据对比 DataDiffDialog ──
  'ddiff.needKey': [
    '源表未检测到主键，请在「配对列」手动填写用于配对行的列（逗号分隔）。',
    'No primary key on source; enter pairing columns manually (comma-separated).',
  ],
  'ddiff.consistent': ['-- 数据一致，无需同步', '-- data is identical, nothing to sync'],
  'ddiff.title': ['数据对比 / 同步（源 → 目标）', 'Data diff / sync (source → target)'],
  'ddiff.srcConn': ['源连接 / 库 / 表', 'Source connection / db / table'],
  'ddiff.tgtConn': [
    '目标连接 / 库 / 表（将被同步）',
    'Target connection / db / table (will be synced)',
  ],
  'ddiff.tablePh': ['表名', 'Table name'],
  'ddiff.keyCols': ['配对列', 'Pairing cols'],
  'ddiff.keyColsPh': ['留空=自动取主键', 'empty = use PK'],
  'ddiff.maxRows': ['最多行数', 'Max rows'],
  'ddiff.pk': ['主键：', 'PK: '],
  'ddiff.ins': ['新增', 'inserts'],
  'ddiff.upd': ['更新', 'updates'],
  'ddiff.del': ['删除', 'deletes'],
  'ddiff.syncSql': ['同步 SQL（在目标执行）', 'Sync SQL (run on target)'],

  // ── 用户与权限 PrivilegesDialog ──
  'priv.unsupported': [
    '该方言暂不支持用户管理（仅 MySQL / PostgreSQL 系）',
    'User management not supported for this dialect (MySQL / PostgreSQL only)',
  ],
  'priv.readFail': ['（读取授权失败：{msg}）', '(failed to read grants: {msg})'],
  'priv.title': ['用户与权限', 'Users & privileges'],
  'priv.usersRoles': ['用户 / 角色（{n}）', 'Users / roles ({n})'],
  'priv.existingGrants': ['已有授权', 'Existing grants'],
  'priv.grantTitle': ['授予权限（GRANT）', 'Grant privileges'],
  'priv.targetPh': [
    '目标，如 `db`.* / schema.table / *.*',
    'Target, e.g. `db`.* / schema.table / *.*',
  ],
  'priv.openQuery': ['在查询页打开', 'Open in query page'],
  'priv.pickUser': [
    '选择左侧用户查看授权并生成 GRANT',
    'Select a user on the left to view grants and build GRANT',
  ],
  'priv.noneOrLoading': ['（无 / 读取中）', '(none / loading)'],

  // ── 查询页签 QueryTabs ──
  'tabs.titleStructure': ['{name} · 结构', '{name} · Structure'],
  'tabs.titleEdit': ['{name} · 编辑', '{name} · Edit'],
  'tabs.titleDesign': ['{name} · 设计', '{name} · Design'],
  'tabs.empty': [
    '展开左侧连接，右键「新建查询 / 新建表…」或双击连接开始',
    'Expand a connection, right-click "New query / New table…" or double-click to start',
  ],
  'tabs.newQuery': ['新建查询', 'New query'],
  'tabs.pin': ['固定标签', 'Pin tab'],
  'tabs.unpin': ['取消固定', 'Unpin tab'],
  'tabs.pinHint': ['双击可固定 / 取消固定', 'Double-click to pin / unpin'],

  // ── 表结构 TableStructure ──
  'struct.tab.columns': ['字段', 'Fields'],
  'struct.tab.indexes': ['索引', 'Indexes'],
  'struct.tab.keys': ['键', 'Keys'],
  'struct.tab.ddl': ['DDL', 'DDL'],
  'struct.h.field': ['字段', 'Field'],
  'struct.h.type': ['类型', 'Type'],
  'struct.h.nullable': ['可空', 'Nullable'],
  'struct.h.pk': ['主键', 'PK'],
  'struct.h.default': ['默认值', 'Default'],
  'struct.h.comment': ['注释', 'Comment'],
  'struct.indexName': ['索引名', 'Index name'],
  'struct.constraintName': ['约束名', 'Constraint name'],

  // ── DDL 编辑器 DdlEditor ──
  'ddl.unsupported': [
    '当前方言暂不支持载入该对象定义（目前支持 MySQL / PostgreSQL 的 视图/函数/过程）',
    'Loading this object definition is not supported for this dialect (MySQL / PostgreSQL views/functions/procedures only)',
  ],
  'ddl.noDef': ['未取到对象定义', 'Object definition not found'],
  'ddl.executing': ['执行中…', 'Running…'],
  'ddl.saveExec': ['保存（执行）', 'Save (run)'],
  'ddl.create': ['创建', 'Create'],
  'ddl.loadingDef': ['载入定义中…', 'Loading definition…'],
  'ddl.location': ['位置：{target}', 'Location: {target}'],

  // ── 历史 HistoryPanel ──
  'hist.searchPh': ['🔍 搜索历史…', '🔍 Search history…'],
  'hist.clear': ['清空', 'Clear'],
  'hist.empty': ['还没有执行记录', 'No history yet'],
  'hist.noMatch': ['无匹配记录', 'No matching records'],
  'hist.loadEditor': ['双击载入编辑器', 'Double-click to load into editor'],
  'hist.saveSnippet': ['存为片段', 'Save as snippet'],

  // ── 执行计划 PlanPanel ──
  'plan.head': ['执行计划（节点 · 代价 · 预估行）', 'Plan (node · cost · est. rows)'],
  'plan.empty': ['无执行计划', 'No plan'],

  // ── 命令面板 CommandPalette ──
  'palette.ph': ['跳转连接 / 执行命令…', 'Jump to connection / run command…'],
  'palette.empty': ['无匹配', 'No match'],

  // ── 导出选项 ExportOptionsDialog ──
  'export.structOnly': ['仅结构（CREATE TABLE）', 'Structure only (CREATE TABLE)'],
  'export.structData': ['结构 + 数据（CREATE + INSERT）', 'Structure + data (CREATE + INSERT)'],
  'export.go': ['导出', 'Export'],

  // ── 右键菜单 ContextMenu ──
  'ctx.empty': ['无可用操作', 'No actions'],

  // ── 右键菜单（TREE_ACTIONS）所有动作标签 ──
  'ctx.new-query': ['新建查询', 'New query'],
  'ctx.new-table': ['新建表', 'New table'],
  'ctx.new-view': ['新建视图', 'New view'],
  'ctx.new-function': ['新建函数', 'New function'],
  'ctx.new-procedure': ['新建存储过程', 'New procedure'],
  'ctx.new-sequence': ['新建序列', 'New sequence'],
  'ctx.new-event': ['新建事件', 'New event'],
  'ctx.select-200': ['查询前 200 行', 'Select first 200 rows'],
  'ctx.view-structure': ['查看结构', 'View structure'],
  'ctx.view-definition': ['查看定义', 'View definition'],
  'ctx.design-table': ['设计表', 'Design table'],
  'ctx.edit-object': ['编辑定义', 'Edit definition'],
  'ctx.edit-comment': ['编辑注释', 'Edit comment'],
  'ctx.create-index': ['新建索引', 'New index'],
  'ctx.rename-table': ['重命名表', 'Rename table'],
  'ctx.gen-select': ['生成 SELECT', 'Generate SELECT'],
  'ctx.gen-insert': ['生成 INSERT', 'Generate INSERT'],
  'ctx.gen-update': ['生成 UPDATE', 'Generate UPDATE'],
  'ctx.gen-delete': ['生成 DELETE', 'Generate DELETE'],
  'ctx.copy-structure': ['复制建表结构 (CREATE LIKE)', 'Copy structure (CREATE LIKE)'],
  'ctx.copy-table-struct': ['复制表 → 仅结构', 'Duplicate table → schema only'],
  'ctx.copy-table-full': ['复制表 → 结构 + 数据', 'Duplicate table → schema + data'],
  'ctx.copy-ddl': ['复制 DDL', 'Copy DDL'],
  'ctx.copy-qualified': ['复制限定名', 'Copy qualified name'],
  'ctx.copy-name': ['复制名称', 'Copy name'],
  'ctx.empty-table': ['清空表 (DELETE)', 'Empty table (DELETE)'],
  'ctx.truncate-table': ['截断表 (TRUNCATE)', 'Truncate table'],
  'ctx.mock-data': ['生成测试数据', 'Generate mock data'],
  'ctx.import-data': ['导入数据（CSV）', 'Import data (CSV)'],
  'ctx.table-stats': ['统计信息', 'Statistics'],
  'ctx.deps': ['依赖关系（外键）', 'Dependencies (FK)'],
  'ctx.erd': ['ER 图', 'ER diagram'],
  'ctx.export-sql': ['导出为 SQL（结构+数据）', 'Export as SQL (schema + data)'],
  'ctx.transfer-data': ['数据传输（复制到…）', 'Data transfer (copy to…)'],
  'ctx.export-schema-sql': ['导出库为 SQL（结构+数据）', 'Export schema as SQL (schema + data)'],
  'ctx.data-dict': ['生成数据字典（Markdown）', 'Data dictionary (Markdown)'],
  'ctx.data-dict-html': ['生成数据字典（HTML）', 'Data dictionary (HTML)'],
  'ctx.toggle-favorite': ['收藏 / 取消收藏', 'Favorite / Unfavorite'],
  'ctx.edit-conn': ['编辑连接', 'Edit connection'],
  'ctx.toggle-prod': ['标记为生产环境 / 取消标记', 'Mark as production / Unmark'],
  'ctx.refresh': ['刷新', 'Refresh'],
  'ctx.drop-object': ['删除', 'Drop'],
  'ctx.del-conn': ['删除连接', 'Delete connection'],

  // ── ER 图 ErdView ──
  'erd.fileNotReady': [
    '文件接口未就绪：请完整重启应用（preload 更新需重启，非热更新）。',
    'File API not ready: fully restart the app (preload changes need a restart, not HMR).',
  ],
  'erd.ddlFail': ['生成 DDL 失败：{msg}', 'Failed to generate DDL: {msg}'],
  'erd.noNew': ['没有新增的表或外键', 'No new tables or foreign keys'],
  'erd.applyConfirm': [
    '将对数据库执行以下 DDL：\n\n{ddl}',
    'The following DDL will run against the database:\n\n{ddl}',
  ],
  'erd.applyFail': ['应用失败：{msg}', 'Apply failed: {msg}'],
  'erd.applyTitle': ['应用 DDL 变更', 'Apply DDL changes'],
  'erd.applyFailTitle': ['应用失败', 'Apply failed'],
  'erd.title': ['ER 图 · {name}', 'ER diagram · {name}'],
  'erd.stats': ['{tables} 表 · {edges} 外键', '{tables} tables · {edges} FKs'],
  'erd.zoomOut': ['缩小', 'Zoom out'],
  'erd.zoomIn': ['放大', 'Zoom in'],
  'erd.reset': ['重置视图', 'Reset view'],
  'erd.editing': ['✓ 编辑中', '✓ Editing'],
  'erd.edit': ['编辑', 'Edit'],
  'erd.addTable': ['+ 表', '+ Table'],
  'erd.applyToDb': ['应用到库', 'Apply to DB'],
  'erd.genDdl': ['生成 DDL', 'Generate DDL'],
  'erd.hintEdit': [
    '拖列圆点到目标列建外键 · 拖表框移动',
    'Drag a column dot onto a target column to create a FK · drag a box to move',
  ],
  'erd.hintView': [
    '滚轮缩放 · 拖表框移动 · 拖空白平移',
    'Wheel to zoom · drag a box to move · drag empty space to pan',
  ],
  'erd.unsupported': [
    '当前方言暂不支持 ER 图（目前支持 MySQL / PostgreSQL 系）',
    'ER diagram not supported for this dialect (MySQL / PostgreSQL only)',
  ],
  'erd.delTable': ['删除表', 'Delete table'],
  'erd.delCol': ['删除列', 'Delete column'],
  'erd.fkDrag': ['拖到目标列建外键', 'Drag to a target column to create a FK'],
  'erd.addCol': ['+ 列', '+ Column'],

  // ── 导入 ImportDialog ──
  'import.colN': ['列 {n}', 'Column {n}'],
  'import.dataFiles': ['数据文件', 'Data files'],
  'common.allFiles': ['所有文件', 'All files'],
  'import.parseFail': ['解析失败：{msg}', 'Parse failed: {msg}'],
  'import.excelFail': ['解析 Excel 失败：{msg}', 'Failed to parse Excel: {msg}'],
  'import.needMap': ['请至少映射一列', 'Map at least one column'],
  'import.noRows': ['没有可导入的数据行', 'No data rows to import'],
  'import.title': ['导入数据 → {name}', 'Import data → {name}'],
  'import.pickFile': ['选择文件（CSV / JSON）…', 'Choose file (CSV / JSON)…'],
  'import.hasHeader': ['首行为表头', 'First row is header'],
  'import.rowCount': ['共 {n} 行数据', '{n} data rows'],
  'import.mapHead': ['列映射（目标列 ← 源列）', 'Column mapping (target ← source)'],
  'import.skip': ['（不导入）', '(skip)'],
  'import.preview': ['预览（前 5 行）', 'Preview (first 5 rows)'],
  'import.importing': ['导入中…', 'Importing…'],
  'import.importN': ['导入 {n} 列', 'Import {n} columns'],
  'import.step.pick': ['选文件', 'Pick file'],
  'import.step.map': ['字段映射', 'Map columns'],
  'import.step.run': ['执行', 'Execute'],
  'import.back': ['← 上一步', '← Back'],
  'import.next': ['下一步 →', 'Next →'],
  'import.autoMap': ['自动映射', 'Auto-map'],
  'import.mappedHint': ['已映射 {n} / {total} 列', 'Mapped {n} / {total} columns'],
  'import.ty.number': ['数字', 'number'],
  'import.ty.date': ['日期', 'date'],
  'import.ty.boolean': ['布尔', 'boolean'],
  'import.ty.string': ['字符串', 'string'],
  'import.ty.nullable': ['含空值', 'has nulls'],
  'import.preTruncate': ['先 TRUNCATE 目标表', 'TRUNCATE target table first'],
  'import.preTruncateHint': ['不可回滚；建议先备份', 'Not rollback-able; back up first'],
  'import.chunkSize': ['每批行数', 'Rows per batch'],
  'import.chunkSizeHint': ['每条 INSERT 合并 N 行 VALUES', 'Combine N rows of VALUES per INSERT'],
  'import.summary': ['即将导入 {rows} 行 · {cols} 列', 'Will import {rows} rows · {cols} columns'],

  // ── 数据传输 DataTransferDialog ──
  'transfer.needTarget': ['请选择目标连接', 'Please select a target connection'],
  'transfer.needTable': ['请填写目标表名', 'Please enter a target table name'],
  'transfer.title': ['数据传输 · {name}', 'Data transfer · {name}'],
  'transfer.sourceLabel': ['源：', 'Source: '],
  'transfer.colsCount': ['（{n} 列）', '({n} cols)'],
  'transfer.targetConn': ['目标连接', 'Target connection'],
  'transfer.current': ['（当前）', '(current)'],
  'transfer.targetDb': ['目标库', 'Target database'],
  'transfer.targetSchema': ['目标 schema', 'Target schema'],
  'transfer.schemaPh': ['（PG/SQLServer 需要）', '(needed for PG/SQLServer)'],
  'transfer.targetTable': ['目标表', 'Target table'],
  'transfer.tablePh': ['表名（需已存在且列匹配）', 'Table name (must exist with matching columns)'],
  'transfer.batchRows': ['每批行数', 'Rows per batch'],
  'transfer.truncateFirst': ['先清空目标', 'Truncate target first'],
  'transfer.progress': ['已传输 {n} 行', 'Transferred {n} rows'],
  'transfer.note': [
    '按主键/列名对齐插入，要求目标表已存在且列兼容；跨方言时类型/布尔/日期为尽力转换。大表分批读写。',
    'Inserts aligned by column name; target table must exist with compatible columns. Cross-dialect type/boolean/date are best-effort. Large tables are batched.',
  ],
  'transfer.transferring': ['传输中…', 'Transferring…'],
  'transfer.start': ['开始传输', 'Start transfer'],

  // ── 片段面板 SnippetsPanel ──
  'snip.searchPh': ['🔍 搜索片段…', '🔍 Search snippets…'],
  'snip.empty': [
    '还没有片段。在编辑器里写好 SQL，点工具栏「存为片段」，或在历史里「★」收藏。',
    'No snippets yet. Write SQL and click "Save snippet", or star one from history.',
  ],
  'snip.noMatch': ['无匹配片段', 'No matching snippets'],
  'snip.loadEditor': ['双击载入编辑器', 'Double-click to load into editor'],
  'snip.del': ['删除片段', 'Delete snippet'],

  // ── 对象类型名（删除确认等用）──
  'obj.table': ['表', 'table'],
  'obj.view': ['视图', 'view'],
  'obj.function': ['函数', 'function'],
  'obj.procedure': ['存储过程', 'procedure'],
  'obj.sequence': ['序列', 'sequence'],
  'obj.trigger': ['触发器', 'trigger'],
  'obj.event': ['事件', 'event'],
  'obj.database': ['数据库', 'database'],
  'obj.schema': ['Schema', 'schema'],

  // ── 工作区 Workspace（命令面板 / 弹窗 / 提示）──
  'ws.mockPrompt': ['为 {name} 生成多少行测试数据？', 'How many rows of test data for {name}?'],
  'ws.noCols': ['未取到列信息', 'No column info'],
  'ws.tabMockData': ['{name} · 测试数据', '{name} · Test data'],
  'ws.statsUnsupported': [
    '该方言暂不支持统计信息（仅 MySQL / PostgreSQL 系）',
    'Statistics not supported for this dialect (MySQL / PostgreSQL only)',
  ],
  'ws.noStats': ['未取到统计信息', 'No statistics'],
  'ws.depsUnsupported': [
    '该方言暂不支持依赖分析（仅 MySQL / PostgreSQL 系）',
    'Dependency analysis not supported for this dialect (MySQL / PostgreSQL only)',
  ],
  'ws.defUnsupported': [
    '该对象暂不支持查看定义',
    'Viewing definition not supported for this object',
  ],
  'ws.noDef': ['未取到定义', 'Definition not found'],
  'ws.ddlCopied': ['已复制建表语句', 'CREATE statement copied'],
  'ws.confirmEmptyTable': [
    '即将对 {ref} 执行 DELETE FROM（事务安全、可回滚，但会触发 ON DELETE 触发器）。\n继续？',
    'About to run DELETE FROM {ref} (transactional, fires ON DELETE triggers).\nContinue?',
  ],
  'ws.confirmTruncateTable': [
    '即将对 {ref} 执行 TRUNCATE TABLE（极快、重置自增、DDL 不可回滚！）。\n继续？',
    'About to run TRUNCATE TABLE {ref} (fast, resets AUTO_INCREMENT, NOT rollback-able!).\nContinue?',
  ],
  'ws.emptyTableTitle': ['清空表', 'Empty table'],
  'ws.truncateTableTitle': ['截断表', 'Truncate table'],
  'ws.emptyTableDone': ['{ref} 已清空', '{ref} emptied'],
  'ws.truncateTableDone': ['{ref} 已截断', '{ref} truncated'],
  'ws.renamePrompt': ['把 {name} 重命名为：', 'Rename {name} to:'],
  'ws.copyTablePrompt': ['新表名（复制自 {name}）：', 'New table name (copied from {name}):'],
  'ws.copyTableTabTitle': ['复制为 {name}', 'Copy → {name}'],
  'ws.tabDef': ['{name} · 定义', '{name} · Definition'],
  'ws.tabNewSequence': ['新建序列', 'New sequence'],
  'ws.tabNewEvent': ['新建事件', 'New event'],
  'ws.viewDefFail': ['查看定义失败：{msg}', 'Failed to view definition: {msg}'],
  'ws.genSqlFail': ['生成 SQL 失败：{msg}', 'Failed to generate SQL: {msg}'],
  'ws.exportFail': ['导出失败：{msg}', 'Export failed: {msg}'],
  'ws.noTables': ['该库/schema 下没有表', 'No tables in this database/schema'],
  'ws.dumpHeader': [
    '-- SkylerX 库导出：{label}（{n} 表）',
    '-- SkylerX schema export: {label} ({n} tables)',
  ],
  'ws.transferDone': ['数据传输完成：{count} 行', 'Data transfer done: {count} rows'],
  'ws.importDone': ['已导入 {count} 行到 {name}', 'Imported {count} rows into {name}'],
  'ws.tabMigration': ['结构迁移', 'Schema migration'],
  'ws.importConnsResult': [
    '导入 {n} 个连接（密码未含，请逐个补填）',
    'Imported {n} connections (passwords not included; fill them in)',
  ],
  'ws.importConnsFail': ['导入失败：{msg}', 'Import failed: {msg}'],
  'ws.titleEditConn': ['编辑连接', 'Edit connection'],
  'ws.titleNewConn': ['新建连接', 'New connection'],
  'ws.dropTitle': ['删除确认', 'Confirm delete'],
  'ws.dropMsg': [
    '确定删除{label} {name} 吗？此操作不可撤销。',
    'Delete {label} {name}? This cannot be undone.',
  ],
  'ws.cascade': [
    '级联删除（CASCADE，连同依赖对象一并删除）',
    'Cascade (CASCADE, drop dependent objects too)',
  ],
  'ws.deleting': ['删除中…', 'Deleting…'],
  'ws.bulkDropTitle': ['批量删除确认', 'Confirm bulk delete'],
  'ws.bulkDropMsg': [
    '确定删除以下 {n} 个对象吗？此操作不可撤销。',
    'Delete these {n} objects? This cannot be undone.',
  ],
  'ws.cascadeBulk': [
    '级联删除（CASCADE，对支持的对象连同依赖一并删除）',
    'Cascade (CASCADE, drop dependents where supported)',
  ],
  'ws.bulkErr': [
    '✗ 已删除 {done}/{total}，中断于：{msg}',
    '✗ Deleted {done}/{total}, stopped at: {msg}',
  ],
  'ws.bulkDeleting': ['删除中… {done}/{total}', 'Deleting… {done}/{total}'],
  'ws.bulkContinue': ['继续删除', 'Continue'],
  'ws.bulkDeleteN': ['删除 {n} 项', 'Delete {n}'],
  'ws.exportSchemaTitle': ['导出库 {name} 为 SQL', 'Export database {name} as SQL'],
  'ws.exportTableTitle': ['导出表 {name} 为 SQL', 'Export table {name} as SQL'],
  'ws.depsTitle': ['依赖关系 · {name}', 'Dependencies · {name}'],
  'ws.depsOut': ['引用的表（本表外键 →）', 'References (this table → )'],
  'ws.depsIn': ['被引用（← 外键指向本表）', 'Referenced by ( → this table)'],
  'ws.depsNone': ['无', 'None'],
  'ws.depsFoot': ['点击表名在导航树中定位', 'Click a table to locate it in the tree'],
  'ws.statsTitle': ['统计信息 · {name}', 'Statistics · {name}'],
  'ws.statsRows': ['行数（估算）', 'Rows (estimated)'],
  'ws.statsData': ['数据大小', 'Data size'],
  'ws.statsIndex': ['索引大小', 'Index size'],
  'ws.statsTotal': ['合计', 'Total'],
  'pal.newConn': ['新建连接', 'New connection'],
  'pal.objectSearch': ['全局对象搜索（表/视图/列）', 'Global object search (tables/views/columns)'],
  'pal.schemaDiff': ['结构对比 / 同步', 'Schema diff / sync'],
  'pal.dataDiff': ['数据对比 / 同步', 'Data diff / sync'],
  'pal.privileges': ['用户与权限', 'Users & privileges'],
  'pal.settings': ['设置', 'Settings'],
  'pal.exportConns': ['导出连接配置', 'Export connections'],
  'pal.importConns': ['导入连接配置', 'Import connections'],
  'pal.refresh': ['刷新导航树', 'Refresh tree'],
  'pal.shortcuts': ['快捷键参考', 'Keyboard shortcuts'],
  'pal.favorites': ['收藏夹', 'Favorites'],
  'pal.oplog': ['操作日志', 'Operation log'],
  'pal.monitor': ['服务器监控', 'Server monitor'],
  'pal.ai': ['AI 助手', 'AI Assistant'],
  'pal.aiChat': ['AI 聊天侧边栏（开/关）', 'AI chat sidebar (toggle)'],
  'pal.about': ['关于 SkylerX', 'About SkylerX'],

  // ── 右侧 AI 聊天侧边栏 AiChatPanel ──
  'aichat.title': ['AI 聊天', 'AI Chat'],
  'aichat.resizeHint': ['拖动调整面板宽度（自动记住）', 'Drag to resize panel (auto-saved)'],
  'aichat.conn': ['连接', 'Conn'],
  'aichat.connFor': [
    '关联的连接（决定生成 SQL 的方言 + 可拉取库结构）',
    'Linked connection (decides SQL dialect + schema source)',
  ],
  'aichat.db': ['库', 'DB'],
  'aichat.dbTitle': [
    '要扫的 database（MySQL）或 schema（PG）；只有这一个范围的表/列会作为 AI 上下文',
    'Database (MySQL) or schema (PG) to scan; only its tables/columns are sent as context',
  ],
  'aichat.dbNone': ['（无）', '(none)'],
  'aichat.schemaUnsupported': [
    '当前方言暂不支持库结构上下文（仅 MySQL/PG）',
    'Schema context unsupported for this dialect (MySQL/PG only)',
  ],
  'aichat.schemaNoTarget': [
    '请先在「库」下拉里选择要扫的 database 或 schema',
    'Pick a database or schema in the "DB" dropdown first',
  ],
  'aichat.schemaEmpty': [
    '{name} 下未取到任何表/列；可能是空库或权限不足',
    'No tables/columns under {name}; possibly empty schema or insufficient privileges',
  ],
  'aichat.useSchema': ['附带库结构', 'Include schema'],
  'aichat.useSchemaTitle': [
    '勾选后会把当前连接 information_schema 里的表/列汇总发给 AI 作为上下文（压缩后最多 6KB）',
    'When checked, sends a compact list of tables/columns from the current connection as context (capped at ~6KB)',
  ],
  'aichat.clear': ['清空对话', 'Clear chat'],
  'aichat.clearConfirm': ['确定清空当前对话历史吗？', 'Clear the chat history?'],
  'aichat.welcomeTitle': ['你的 SQL 副驾', 'Your SQL copilot'],
  'aichat.welcomeTip': [
    '可以问我：「最近 7 天新增用户怎么查」「这条 SQL 为啥慢」「帮我加个索引」…\n勾上「附带库结构」我就知道你的表名和字段了。',
    'Ask me: "how to find users created in the last 7 days", "why is this SQL slow", "add an index for me"…\nCheck "Include schema" so I can see your tables and columns.',
  ],
  'aichat.inputPh': [
    '问点什么…（Enter 发送，Shift+Enter 换行）',
    'Ask anything… (Enter to send, Shift+Enter for newline)',
  ],
  'aichat.send': ['发送', 'Send'],
  'aichat.stop': ['停止', 'Stop'],
  'aichat.thinking': ['思考中…', 'Thinking…'],
  'aichat.maybeStuck': [
    '（卡住了？点停止试试，或换个 provider）',
    '(stuck? click stop or try another provider)',
  ],
  'aichat.timeoutHint': [
    '请求 {secs} 秒未返回。可能：① provider 限流 / 不可达 ② 本机代理（Privoxy 等）拦了出口 ③ Base URL 错。试试切到「设置 → AI 助手」其它 provider，或检查网络。',
    'No response for {secs}s. Likely: 1) provider throttled / unreachable, 2) local proxy (Privoxy) blocking egress, 3) wrong Base URL. Try another provider in Settings or check your network.',
  ],
  'aichat.insertDraft': ['插入查询页', 'Insert as draft'],
  'aichat.run': ['运行', 'Run'],
  'aichat.runConfirm': [
    '确定在所选连接上执行这条 SQL 吗？',
    'Run this SQL on the selected connection?',
  ],
  'aichat.lastSqlHint': [
    '本轮有 {n} 段 SQL 可一键操作',
    '{n} SQL block(s) ready for one-click action',
  ],
  'aichat.draftTitle': ['AI 草稿', 'AI draft'],
  'aichat.switchProvider': [
    '切换 AI 提供商（仅显示已配置 API Key 的）',
    'Switch AI provider (only ones with API key configured shown)',
  ],
  'aichat.openSettings': ['打开 AI 设置', 'Open AI settings'],
  'aichat.noneConfigured': ['未配置任何 AI provider →', 'No AI provider configured →'],
  'aichat.runPending': ['{time} 派发中', '{time} dispatched'],
  'aichat.runOk': ['{time} 已执行', '{time} executed'],
  'aichat.runErr': ['{time} 执行失败', '{time} failed'],
  'aichat.askAi': ['问 AI', 'Ask AI'],
  'aichat.copyError': ['复制错误', 'Copy error'],
  'aichat.copied': ['已复制', 'Copied'],
  'aichat.askingAi': ['正在把错误发给 AI…', 'Sending error to AI…'],
  'aichat.askAiPrompt': [
    '帮我分析下这条 SQL 为什么报错，并给出修复方案。',
    'Help me analyze why this SQL errored and how to fix it.',
  ],
  'ws.shortcutsTitle': ['快捷键参考', 'Keyboard shortcuts'],
  'ws.favoritesTitle': ['收藏夹', 'Favorites'],
  'ws.favoritesEmpty': [
    '暂无收藏。右键表/视图 →「收藏 / 取消收藏」。',
    'No favorites yet. Right-click a table/view → "Favorite / Unfavorite".',
  ],
  'ws.favoritesUntagged': ['未分组', 'Untagged'],
  'ws.favoritesEditTag': ['编辑分组', 'Edit group tag'],
  'ws.scAction': ['操作', 'Action'],
  'ws.scKey': ['快捷键', 'Shortcut'],
  'pal.groupActions': ['操作', 'Actions'],
  'pal.groupConns': ['连接', 'Connections'],
}

/** 翻译：取当前语言文案，缺失回退 key；支持 {name} 插值。 */
export function t(key: string, params?: Record<string, string | number>): string {
  const pair = DICT[key]
  let s = pair ? (locale.value === 'en' ? pair[1] : pair[0]) : key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return s
}
