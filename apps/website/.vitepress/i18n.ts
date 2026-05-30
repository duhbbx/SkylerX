/**
 * 多语言 nav / sidebar / UI 标签集中维护。
 * 内容(markdown)在各 locale 子目录里;这里只翻译"页面外壳"的字符串。
 *
 * 加新语言:
 *   1. 在 LocaleLabels 增加翻译对象
 *   2. 在 config.ts 的 locales 注册
 *   3. 创建 apps/website/<lang>/ 目录 + 翻译 markdown
 */
export interface LocaleLabels {
  // Nav
  home: string
  download: string
  databases: string
  docs: string
  links: string
  github: string
  changelog: string
  feedback: string

  // Sidebar groups
  gettingStarted: string
  queryEditing: string
  schemaData: string
  nosqlDeep: string
  aiAssistant: string
  securityProductivity: string
  advanced: string

  // Sidebar items
  quickStart: string
  installAndUpgrade: string
  connections: string
  sqlEditor: string
  resultGrid: string
  altViews: string
  schemaManagement: string
  dataFlow: string
  dbaMonitoring: string
  mongoRedisEs: string
  aiGuide: string
  securityCompliance: string
  productivity: string
  advancedFeatures: string
  troubleshooting: string

  // UI labels
  outlineLabel: string
  prevPage: string
  nextPage: string
  lastUpdated: string
  themeLabel: string
  menuLabel: string
  returnTop: string
  searchButton: string
  searchAria: string
  noResults: string
  resetButton: string
  selectText: string
  navigateText: string
  closeText: string
  editLink: string

  // Footer
  company: string
}

export const ZH: LocaleLabels = {
  home: '首页',
  download: '下载',
  databases: '支持的数据库',
  docs: '文档',
  links: '链接',
  github: 'GitHub',
  changelog: '版本日志',
  feedback: '反馈 issue',
  gettingStarted: '入门',
  queryEditing: '查询与编辑',
  schemaData: '结构与数据',
  nosqlDeep: 'NoSQL 深度',
  aiAssistant: 'AI 助手',
  securityProductivity: '安全与生产力',
  advanced: '高级',
  quickStart: '快速开始',
  installAndUpgrade: '安装与升级',
  connections: '连接管理',
  sqlEditor: 'SQL 编辑器',
  resultGrid: '结果集网格',
  altViews: '替代视图(图表/透视/地理/时间轴/树)',
  schemaManagement: '结构管理(设计器/快照/对比/ER)',
  dataFlow: '数据流(导入/导出/备份/迁移)',
  dbaMonitoring: 'DBA 与监控',
  mongoRedisEs: 'MongoDB / Redis / Elasticsearch',
  aiGuide: 'AI 全通道指南',
  securityCompliance: '安全与合规(国密/等保/脱敏)',
  productivity: '生产力(命令面板/快捷键/Dashboard/Webhook)',
  advancedFeatures: '高级特性(EXPLAIN/索引/迁移向导)',
  troubleshooting: '排错与兼容性',
  outlineLabel: '本页目录',
  prevPage: '上一篇',
  nextPage: '下一篇',
  lastUpdated: '最后更新',
  themeLabel: '主题',
  menuLabel: '菜单',
  returnTop: '回到顶部',
  searchButton: '搜索文档',
  searchAria: '搜索',
  noResults: '无匹配结果',
  resetButton: '重置',
  selectText: '选择',
  navigateText: '切换',
  closeText: '关闭',
  editLink: '在 GitHub 上编辑此页',
  company: '武汉斯凯勒网络科技有限公司',
}

export const EN: LocaleLabels = {
  home: 'Home',
  download: 'Download',
  databases: 'Databases',
  docs: 'Docs',
  links: 'Links',
  github: 'GitHub',
  changelog: 'Changelog',
  feedback: 'Issues',
  gettingStarted: 'Getting Started',
  queryEditing: 'Query & Edit',
  schemaData: 'Schema & Data',
  nosqlDeep: 'NoSQL Deep Dive',
  aiAssistant: 'AI Assistant',
  securityProductivity: 'Security & Productivity',
  advanced: 'Advanced',
  quickStart: 'Quick Start',
  installAndUpgrade: 'Install & Upgrade',
  connections: 'Connections',
  sqlEditor: 'SQL Editor',
  resultGrid: 'Result Grid',
  altViews: 'Alternative Views (Chart / Pivot / Geo / Timeline / Tree)',
  schemaManagement: 'Schema Management (Designer / Snapshots / Diff / ER)',
  dataFlow: 'Data Flow (Import / Export / Backup / Transfer)',
  dbaMonitoring: 'DBA & Monitoring',
  mongoRedisEs: 'MongoDB / Redis / Elasticsearch',
  aiGuide: 'Full AI Guide',
  securityCompliance: 'Security & Compliance (SM2/3/4 / GB17859 / Masking)',
  productivity: 'Productivity (Palette / Shortcuts / Dashboard / Webhook)',
  advancedFeatures: 'Advanced Features (EXPLAIN / Index / Migration Wizard)',
  troubleshooting: 'Troubleshooting',
  outlineLabel: 'On this page',
  prevPage: 'Previous',
  nextPage: 'Next',
  lastUpdated: 'Last updated',
  themeLabel: 'Theme',
  menuLabel: 'Menu',
  returnTop: 'Back to top',
  searchButton: 'Search docs',
  searchAria: 'Search',
  noResults: 'No matching results',
  resetButton: 'Reset',
  selectText: 'select',
  navigateText: 'navigate',
  closeText: 'close',
  editLink: 'Edit this page on GitHub',
  company: 'Wuhan Skyler Network Technology Co., Ltd.',
}

export const ES: LocaleLabels = {
  home: 'Inicio',
  download: 'Descargar',
  databases: 'Bases de datos',
  docs: 'Documentación',
  links: 'Enlaces',
  github: 'GitHub',
  changelog: 'Cambios',
  feedback: 'Reportar problema',
  gettingStarted: 'Primeros pasos',
  queryEditing: 'Consulta y edición',
  schemaData: 'Esquema y datos',
  nosqlDeep: 'NoSQL en profundidad',
  aiAssistant: 'Asistente IA',
  securityProductivity: 'Seguridad y productividad',
  advanced: 'Avanzado',
  quickStart: 'Inicio rápido',
  installAndUpgrade: 'Instalación y actualización',
  connections: 'Conexiones',
  sqlEditor: 'Editor SQL',
  resultGrid: 'Cuadrícula de resultados',
  altViews: 'Vistas alternativas (Gráfico / Pivote / Geo / Línea temporal / Árbol)',
  schemaManagement: 'Gestión de esquema (Diseñador / Capturas / Diff / ER)',
  dataFlow: 'Flujo de datos (Importar / Exportar / Copia / Transferir)',
  dbaMonitoring: 'DBA y monitoreo',
  mongoRedisEs: 'MongoDB / Redis / Elasticsearch',
  aiGuide: 'Guía completa de IA',
  securityCompliance: 'Seguridad y cumplimiento (SM2/3/4 / Enmascaramiento)',
  productivity: 'Productividad (Paleta / Atajos / Dashboard / Webhook)',
  advancedFeatures: 'Características avanzadas (EXPLAIN / Índice / Migración)',
  troubleshooting: 'Solución de problemas',
  outlineLabel: 'En esta página',
  prevPage: 'Anterior',
  nextPage: 'Siguiente',
  lastUpdated: 'Última actualización',
  themeLabel: 'Tema',
  menuLabel: 'Menú',
  returnTop: 'Volver arriba',
  searchButton: 'Buscar en docs',
  searchAria: 'Buscar',
  noResults: 'Sin resultados',
  resetButton: 'Reiniciar',
  selectText: 'seleccionar',
  navigateText: 'navegar',
  closeText: 'cerrar',
  editLink: 'Editar esta página en GitHub',
  company: 'Wuhan Skyler Network Technology Co., Ltd.',
}

export const FR: LocaleLabels = {
  home: 'Accueil',
  download: 'Téléchargement',
  databases: 'Bases de données',
  docs: 'Documentation',
  links: 'Liens',
  github: 'GitHub',
  changelog: 'Notes de version',
  feedback: 'Signaler un problème',
  gettingStarted: 'Démarrage',
  queryEditing: 'Requête et édition',
  schemaData: 'Schéma et données',
  nosqlDeep: 'NoSQL en profondeur',
  aiAssistant: 'Assistant IA',
  securityProductivity: 'Sécurité et productivité',
  advanced: 'Avancé',
  quickStart: 'Démarrage rapide',
  installAndUpgrade: 'Installation et mise à jour',
  connections: 'Connexions',
  sqlEditor: 'Éditeur SQL',
  resultGrid: 'Grille de résultats',
  altViews: 'Vues alternatives (Graphique / Pivot / Géo / Chronologie / Arbre)',
  schemaManagement: 'Gestion de schéma (Concepteur / Instantanés / Diff / ER)',
  dataFlow: 'Flux de données (Import / Export / Sauvegarde / Transfert)',
  dbaMonitoring: 'DBA et supervision',
  mongoRedisEs: 'MongoDB / Redis / Elasticsearch',
  aiGuide: 'Guide IA complet',
  securityCompliance: 'Sécurité et conformité (SM2/3/4 / Masquage)',
  productivity: 'Productivité (Palette / Raccourcis / Dashboard / Webhook)',
  advancedFeatures: 'Fonctionnalités avancées (EXPLAIN / Index / Migration)',
  troubleshooting: 'Dépannage',
  outlineLabel: 'Sur cette page',
  prevPage: 'Précédent',
  nextPage: 'Suivant',
  lastUpdated: 'Dernière mise à jour',
  themeLabel: 'Thème',
  menuLabel: 'Menu',
  returnTop: 'Retour en haut',
  searchButton: 'Rechercher',
  searchAria: 'Rechercher',
  noResults: 'Aucun résultat',
  resetButton: 'Réinitialiser',
  selectText: 'sélectionner',
  navigateText: 'naviguer',
  closeText: 'fermer',
  editLink: 'Modifier cette page sur GitHub',
  company: 'Wuhan Skyler Network Technology Co., Ltd.',
}

export const JA: LocaleLabels = {
  home: 'ホーム',
  download: 'ダウンロード',
  databases: '対応データベース',
  docs: 'ドキュメント',
  links: 'リンク',
  github: 'GitHub',
  changelog: '変更履歴',
  feedback: 'Issue 報告',
  gettingStarted: 'はじめに',
  queryEditing: 'クエリと編集',
  schemaData: 'スキーマとデータ',
  nosqlDeep: 'NoSQL 詳細ガイド',
  aiAssistant: 'AI アシスタント',
  securityProductivity: 'セキュリティと生産性',
  advanced: '高度な機能',
  quickStart: 'クイックスタート',
  installAndUpgrade: 'インストールとアップデート',
  connections: '接続管理',
  sqlEditor: 'SQL エディタ',
  resultGrid: '結果グリッド',
  altViews: '代替ビュー(チャート/ピボット/地理/タイムライン/ツリー)',
  schemaManagement: 'スキーマ管理(デザイナー/スナップショット/差分/ER)',
  dataFlow: 'データフロー(インポート/エクスポート/バックアップ/転送)',
  dbaMonitoring: 'DBA と監視',
  mongoRedisEs: 'MongoDB / Redis / Elasticsearch',
  aiGuide: 'AI 完全ガイド',
  securityCompliance: 'セキュリティとコンプライアンス(SM2/3/4 / マスキング)',
  productivity: '生産性(パレット/ショートカット/ダッシュボード/Webhook)',
  advancedFeatures: '高度な機能(EXPLAIN/インデックス/移行ウィザード)',
  troubleshooting: 'トラブルシューティング',
  outlineLabel: 'このページの目次',
  prevPage: '前へ',
  nextPage: '次へ',
  lastUpdated: '最終更新',
  themeLabel: 'テーマ',
  menuLabel: 'メニュー',
  returnTop: 'トップに戻る',
  searchButton: 'ドキュメントを検索',
  searchAria: '検索',
  noResults: '結果が見つかりません',
  resetButton: 'リセット',
  selectText: '選択',
  navigateText: '移動',
  closeText: '閉じる',
  editLink: 'GitHub でこのページを編集',
  company: 'Wuhan Skyler Network Technology Co., Ltd.',
}

export const KO: LocaleLabels = {
  home: '홈',
  download: '다운로드',
  databases: '지원 데이터베이스',
  docs: '문서',
  links: '링크',
  github: 'GitHub',
  changelog: '변경 이력',
  feedback: '이슈 보고',
  gettingStarted: '시작하기',
  queryEditing: '쿼리 및 편집',
  schemaData: '스키마 및 데이터',
  nosqlDeep: 'NoSQL 상세 가이드',
  aiAssistant: 'AI 어시스턴트',
  securityProductivity: '보안 및 생산성',
  advanced: '고급 기능',
  quickStart: '빠른 시작',
  installAndUpgrade: '설치 및 업그레이드',
  connections: '연결 관리',
  sqlEditor: 'SQL 에디터',
  resultGrid: '결과 그리드',
  altViews: '대체 뷰(차트/피벗/지리/타임라인/트리)',
  schemaManagement: '스키마 관리(디자이너/스냅샷/비교/ER)',
  dataFlow: '데이터 흐름(가져오기/내보내기/백업/전송)',
  dbaMonitoring: 'DBA 및 모니터링',
  mongoRedisEs: 'MongoDB / Redis / Elasticsearch',
  aiGuide: 'AI 종합 가이드',
  securityCompliance: '보안 및 컴플라이언스(SM2/3/4 / 마스킹)',
  productivity: '생산성(팔레트/단축키/대시보드/Webhook)',
  advancedFeatures: '고급 기능(EXPLAIN/인덱스/마이그레이션)',
  troubleshooting: '문제 해결',
  outlineLabel: '이 페이지 목차',
  prevPage: '이전',
  nextPage: '다음',
  lastUpdated: '마지막 업데이트',
  themeLabel: '테마',
  menuLabel: '메뉴',
  returnTop: '맨 위로',
  searchButton: '문서 검색',
  searchAria: '검색',
  noResults: '검색 결과 없음',
  resetButton: '초기화',
  selectText: '선택',
  navigateText: '이동',
  closeText: '닫기',
  editLink: 'GitHub에서 이 페이지 편집',
  company: 'Wuhan Skyler Network Technology Co., Ltd.',
}

export const PT: LocaleLabels = {
  home: 'Início',
  download: 'Download',
  databases: 'Bancos de dados',
  docs: 'Documentação',
  links: 'Links',
  github: 'GitHub',
  changelog: 'Changelog',
  feedback: 'Reportar problema',
  gettingStarted: 'Primeiros passos',
  queryEditing: 'Consulta e edição',
  schemaData: 'Esquema e dados',
  nosqlDeep: 'NoSQL detalhado',
  aiAssistant: 'Assistente IA',
  securityProductivity: 'Segurança e produtividade',
  advanced: 'Avançado',
  quickStart: 'Início rápido',
  installAndUpgrade: 'Instalação e atualização',
  connections: 'Conexões',
  sqlEditor: 'Editor SQL',
  resultGrid: 'Grade de resultados',
  altViews: 'Visualizações alternativas (Gráfico / Pivô / Geo / Linha do tempo / Árvore)',
  schemaManagement: 'Gestão de esquema (Designer / Snapshots / Diff / ER)',
  dataFlow: 'Fluxo de dados (Importar / Exportar / Backup / Transferir)',
  dbaMonitoring: 'DBA e monitoramento',
  mongoRedisEs: 'MongoDB / Redis / Elasticsearch',
  aiGuide: 'Guia completo de IA',
  securityCompliance: 'Segurança e conformidade (SM2/3/4 / Mascaramento)',
  productivity: 'Produtividade (Paleta / Atalhos / Dashboard / Webhook)',
  advancedFeatures: 'Recursos avançados (EXPLAIN / Índice / Migração)',
  troubleshooting: 'Solução de problemas',
  outlineLabel: 'Nesta página',
  prevPage: 'Anterior',
  nextPage: 'Próximo',
  lastUpdated: 'Última atualização',
  themeLabel: 'Tema',
  menuLabel: 'Menu',
  returnTop: 'Voltar ao topo',
  searchButton: 'Buscar docs',
  searchAria: 'Buscar',
  noResults: 'Nenhum resultado',
  resetButton: 'Limpar',
  selectText: 'selecionar',
  navigateText: 'navegar',
  closeText: 'fechar',
  editLink: 'Editar esta página no GitHub',
  company: 'Wuhan Skyler Network Technology Co., Ltd.',
}

/* ---------------------------------------------------------------------------
 * ComponentLabels: 给 .vitepress/components/*.vue 用的运行时翻译表.
 *
 * 与 LocaleLabels(nav/sidebar)分开维护,避免一个超大接口。
 * 组件里:
 *   import { useData } from 'vitepress'
 *   import { getComponentLabels } from '../i18n'
 *   const { lang } = useData()
 *   const L = computed(() => getComponentLabels(lang.value))
 * ------------------------------------------------------------------------ */

/** DatabaseGrid 内部 tag key(保留中文当作稳定的 internal key,渲染时翻译) */
export type DbTagKey =
  | '主流'
  | '国产信创'
  | 'MySQL 协议兼容'
  | 'PG 协议兼容'
  | '列存 OLAP'
  | 'MPP'
  | '分布式'
  | '本地文件'
  | '云 DW'
  | '时序'
  | '文档'
  | 'KV / 数据结构'
  | '搜索引擎'
  | 'PG-server 模式'

/** DownloadMatrix rows[].label 的 key */
export type MatrixRowKey =
  | 'macArm'
  | 'winInstaller'
  | 'winInstallerArm'
  | 'winPortable'
  | 'winPortableArm'
  | 'linuxAppimage'
  | 'linuxDeb'
  | 'linuxRpm'
  | 'linuxPacman'
  | 'linuxAppimageArm'
  | 'linuxTarGz'

export interface ComponentLabels {
  hero: {
    dialects: string
    chinese: string
    multiAi: string
    license: string
  }
  features: Array<{ icon: string; title: string; desc: string }>
  db: {
    sql: string
    nosql: string
    driver: string
    tags: Record<DbTagKey, string>
    notes: {
      oracleThin: string
      obOracle: string
    }
  }
  download: {
    platforms: { macos: string; windows: string; linux: string; unknown: string }
    currentPlatform: string
    seeAll: string
    /** "下载(macOS arm64)" */
    download: (label: string) => string
    cnMirror: string
    githubSrc: string
    cnTip: string
    intlTip: string
  }
  matrix: {
    loading: string
    latestVersion: string
    fallbackPrefix: string
    fallbackSuffix: string
    ossLabel: string
    githubLabel: string
    history: string
    cnMirrorBtn: string
    cnMirrorTitle: string
    githubBtn: string
    githubBtnTitle: string
    th: { platform: string; arch: string; format: string; desc: string; download: string }
    rowLabels: Record<MatrixRowKey, string>
    /** 表格格式列里的中文「安装版」/「绿色版」翻译 */
    formats: { exeSetup: string; exePortable: string }
    downloadLink: string
    /** errorTpl("OSS 镜像" | "GitHub API", msg) → 完整错误字符串 */
    errorTpl: (src: string, err: string, link: string) => string
    tipOss: string
    tipGithub: string
  }
  lightbox: { close: string }
}

/* ---------- 复用的 helpers,避免每个 locale 重复抄 ---------- */
const ZH_FEATURES: ComponentLabels['features'] = [
  { icon: '🧠', title: 'AI 助手', desc: 'Anthropic / OpenAI / DeepSeek / Codex / Grok 多家选,内置 7 个专业 Toolbox + 行内补全' },
  { icon: '🔌', title: '20+ 方言', desc: '主流 SQL + 国产信创(达梦/金仓/openGauss/OceanBase/TiDB)+ NoSQL(Mongo/Redis/ES)' },
  { icon: '✏️', title: 'Monaco 编辑器', desc: 'SQL 高亮 + 自动补全 + 格式化 + 参数化查询 + 片段库;⌘+Enter 即跑' },
  { icon: '📊', title: '可视化结果集', desc: '虚拟滚动 + 可编辑 + JSON/BLOB 识别 + 数字列 sparkline + 条件着色' },
  { icon: '🛡', title: '生产保护', desc: 'prod 标记 + 危险 SQL 二次确认 + SQL Linter + 数据脱敏 / 契约' },
  { icon: '🔍', title: 'EXPLAIN 可视化', desc: '预估行 vs 实际行,慢算子高亮,可选 ANALYZE 真跑测' },
  { icon: '🧬', title: '结构对比 / 漂移', desc: '两连接对比 → 自动生成对齐 SQL;Schema 快照 + 演化历史' },
  { icon: '🛠', title: 'DBA 工具箱', desc: '服务器活动 / KILL / 慢查询日志解析 / 复制延迟监控 / 索引推荐' },
  { icon: '🇨🇳', title: '信创就绪', desc: '达梦 / 金仓 / openGauss / OceanBase / TiDB / 国密 SM2/SM3/SM4 + 等保合规面板' },
]

const EN_FEATURES: ComponentLabels['features'] = [
  { icon: '🧠', title: 'AI Assistant', desc: 'Pick from Anthropic / OpenAI / DeepSeek / Codex / Grok, with 7 built-in toolboxes and inline completion' },
  { icon: '🔌', title: '20+ Dialects', desc: 'Mainstream SQL + Chinese DBs (DM / Kingbase / openGauss / OceanBase / TiDB) + NoSQL (Mongo / Redis / ES)' },
  { icon: '✏️', title: 'Monaco Editor', desc: 'SQL highlighting, autocompletion, formatting, parameterized queries, snippet library — run with ⌘+Enter' },
  { icon: '📊', title: 'Rich Result Grid', desc: 'Virtual scroll + inline edit + JSON/BLOB detection + numeric sparklines + conditional coloring' },
  { icon: '🛡', title: 'Production Safety', desc: 'Prod-flagged connections + dangerous-SQL confirmation + SQL linter + data masking & contracts' },
  { icon: '🔍', title: 'EXPLAIN Visualizer', desc: 'Estimated vs actual rows, slow operators highlighted, optional real ANALYZE run' },
  { icon: '🧬', title: 'Schema Diff & Drift', desc: 'Compare two connections → auto-generate alignment SQL; schema snapshots + evolution history' },
  { icon: '🛠', title: 'DBA Toolbox', desc: 'Server activity / KILL / slow-query log parsing / replication lag monitoring / index suggestions' },
  { icon: '🇨🇳', title: 'Chinese Stack Ready', desc: 'DM / Kingbase / openGauss / OceanBase / TiDB + SM2/SM3/SM4 crypto + GB-compliance panels' },
]

const ES_FEATURES: ComponentLabels['features'] = [
  { icon: '🧠', title: 'Asistente IA', desc: 'Elige entre Anthropic / OpenAI / DeepSeek / Codex / Grok, con 7 toolboxes integrados y autocompletado en línea' },
  { icon: '🔌', title: '20+ dialectos', desc: 'SQL principales + bases chinas (DM / Kingbase / openGauss / OceanBase / TiDB) + NoSQL (Mongo / Redis / ES)' },
  { icon: '✏️', title: 'Editor Monaco', desc: 'Resaltado SQL, autocompletado, formato, consultas parametrizadas, biblioteca de snippets; ⌘+Enter para ejecutar' },
  { icon: '📊', title: 'Resultados visuales', desc: 'Scroll virtual + edición en línea + detección JSON/BLOB + sparklines numéricos + coloreado condicional' },
  { icon: '🛡', title: 'Protección de producción', desc: 'Marcado prod + confirmación de SQL peligroso + linter SQL + enmascaramiento y contratos de datos' },
  { icon: '🔍', title: 'EXPLAIN visual', desc: 'Filas estimadas vs reales, operadores lentos resaltados, ANALYZE real opcional' },
  { icon: '🧬', title: 'Diff y deriva de esquema', desc: 'Compara dos conexiones → SQL de alineación auto-generado; snapshots + historial de evolución' },
  { icon: '🛠', title: 'Caja de herramientas DBA', desc: 'Actividad del servidor / KILL / parser de slow log / monitor de replicación / sugerencias de índices' },
  { icon: '🇨🇳', title: 'Listo para stack chino', desc: 'DM / Kingbase / openGauss / OceanBase / TiDB + criptografía SM2/SM3/SM4 + paneles de cumplimiento' },
]

const FR_FEATURES: ComponentLabels['features'] = [
  { icon: '🧠', title: 'Assistant IA', desc: 'Anthropic / OpenAI / DeepSeek / Codex / Grok au choix, avec 7 toolboxes intégrées et complétion en ligne' },
  { icon: '🔌', title: '20+ dialectes', desc: 'SQL grand public + BDD chinoises (DM / Kingbase / openGauss / OceanBase / TiDB) + NoSQL (Mongo / Redis / ES)' },
  { icon: '✏️', title: 'Éditeur Monaco', desc: 'Coloration SQL, complétion, formatage, requêtes paramétrées, bibliothèque de snippets ; ⌘+Entrée pour exécuter' },
  { icon: '📊', title: 'Grille de résultats riche', desc: 'Scroll virtuel + édition en ligne + détection JSON/BLOB + sparklines numériques + coloration conditionnelle' },
  { icon: '🛡', title: 'Sécurité prod', desc: 'Marquage prod + confirmation des SQL dangereux + linter SQL + masquage et contrats de données' },
  { icon: '🔍', title: 'Visualiseur EXPLAIN', desc: 'Lignes estimées vs réelles, opérateurs lents surlignés, ANALYZE réel optionnel' },
  { icon: '🧬', title: 'Diff et dérive de schéma', desc: 'Compare deux connexions → SQL d\'alignement auto-généré ; snapshots + historique d\'évolution' },
  { icon: '🛠', title: 'Boîte à outils DBA', desc: 'Activité serveur / KILL / parser de slow log / monitoring de réplication / recommandations d\'index' },
  { icon: '🇨🇳', title: 'Stack chinois prêt', desc: 'DM / Kingbase / openGauss / OceanBase / TiDB + crypto SM2/SM3/SM4 + panneaux de conformité GB' },
]

const JA_FEATURES: ComponentLabels['features'] = [
  { icon: '🧠', title: 'AI アシスタント', desc: 'Anthropic / OpenAI / DeepSeek / Codex / Grok から選択、7 つの専門 Toolbox とインライン補完を内蔵' },
  { icon: '🔌', title: '20+ 方言', desc: '主要 SQL + 中国国産 DB(DM / Kingbase / openGauss / OceanBase / TiDB)+ NoSQL(Mongo / Redis / ES)' },
  { icon: '✏️', title: 'Monaco エディタ', desc: 'SQL ハイライト + 補完 + フォーマット + パラメータ化クエリ + スニペット;⌘+Enter で実行' },
  { icon: '📊', title: 'リッチな結果グリッド', desc: '仮想スクロール + インライン編集 + JSON/BLOB 認識 + 数値列スパークライン + 条件付き配色' },
  { icon: '🛡', title: 'プロダクション保護', desc: 'prod フラグ + 危険 SQL の二段確認 + SQL Linter + データマスキング / コントラクト' },
  { icon: '🔍', title: 'EXPLAIN ビジュアライザ', desc: '予測 vs 実際の行数、遅い演算子をハイライト、任意で ANALYZE を実行' },
  { icon: '🧬', title: 'スキーマ Diff / ドリフト', desc: '2 接続を比較 → 整合 SQL を自動生成、スキーマスナップショット + 履歴' },
  { icon: '🛠', title: 'DBA ツールボックス', desc: 'サーバ活動 / KILL / スローログ解析 / レプリ遅延監視 / インデックス推奨' },
  { icon: '🇨🇳', title: '中国国産 DB 対応', desc: 'DM / Kingbase / openGauss / OceanBase / TiDB + SM2/SM3/SM4 国密 + GB 準拠パネル' },
]

const KO_FEATURES: ComponentLabels['features'] = [
  { icon: '🧠', title: 'AI 어시스턴트', desc: 'Anthropic / OpenAI / DeepSeek / Codex / Grok 선택, 7 개 전문 Toolbox + 인라인 자동완성 내장' },
  { icon: '🔌', title: '20+ 방언', desc: '주요 SQL + 중국 국산 DB(DM / Kingbase / openGauss / OceanBase / TiDB)+ NoSQL(Mongo / Redis / ES)' },
  { icon: '✏️', title: 'Monaco 에디터', desc: 'SQL 하이라이트, 자동완성, 포맷, 파라미터 쿼리, 스니펫; ⌘+Enter 로 실행' },
  { icon: '📊', title: '풍부한 결과 그리드', desc: '가상 스크롤 + 인라인 편집 + JSON/BLOB 인식 + 숫자 컬럼 스파크라인 + 조건부 색상' },
  { icon: '🛡', title: '프로덕션 보호', desc: 'prod 표시 + 위험 SQL 재확인 + SQL Linter + 데이터 마스킹 / 계약' },
  { icon: '🔍', title: 'EXPLAIN 시각화', desc: '예상 vs 실제 행 수, 느린 연산자 하이라이트, 선택적 ANALYZE 실행' },
  { icon: '🧬', title: '스키마 Diff / 드리프트', desc: '두 연결 비교 → 정렬 SQL 자동 생성; 스키마 스냅샷 + 진화 이력' },
  { icon: '🛠', title: 'DBA 툴박스', desc: '서버 활동 / KILL / 슬로우 쿼리 로그 파싱 / 복제 지연 모니터링 / 인덱스 추천' },
  { icon: '🇨🇳', title: '중국 국산 DB 지원', desc: 'DM / Kingbase / openGauss / OceanBase / TiDB + SM2/SM3/SM4 + 등급 보호 컴플라이언스 패널' },
]

const PT_FEATURES: ComponentLabels['features'] = [
  { icon: '🧠', title: 'Assistente IA', desc: 'Anthropic / OpenAI / DeepSeek / Codex / Grok à escolha, com 7 toolboxes integradas e autocompletar inline' },
  { icon: '🔌', title: '20+ dialetos', desc: 'SQL convencionais + bancos chineses (DM / Kingbase / openGauss / OceanBase / TiDB) + NoSQL (Mongo / Redis / ES)' },
  { icon: '✏️', title: 'Editor Monaco', desc: 'Realce SQL, autocompletar, formatação, queries parametrizadas, biblioteca de snippets; ⌘+Enter para executar' },
  { icon: '📊', title: 'Grade de resultados rica', desc: 'Scroll virtual + edição inline + detecção JSON/BLOB + sparklines numéricos + coloração condicional' },
  { icon: '🛡', title: 'Proteção de produção', desc: 'Marcação prod + confirmação de SQL perigoso + linter SQL + mascaramento e contratos de dados' },
  { icon: '🔍', title: 'Visualizador EXPLAIN', desc: 'Linhas estimadas vs reais, operadores lentos destacados, ANALYZE real opcional' },
  { icon: '🧬', title: 'Diff e drift de esquema', desc: 'Compare duas conexões → SQL de alinhamento auto-gerado; snapshots de esquema + histórico de evolução' },
  { icon: '🛠', title: 'Caixa de ferramentas DBA', desc: 'Atividade do servidor / KILL / parser de slow log / monitoramento de replicação / sugestão de índices' },
  { icon: '🇨🇳', title: 'Pronto para stack chinês', desc: 'DM / Kingbase / openGauss / OceanBase / TiDB + criptografia SM2/SM3/SM4 + painéis de conformidade GB' },
]

export const COMPONENT_LABELS: Record<string, ComponentLabels> = {
  'zh-CN': {
    hero: {
      dialects: '✨ 17 SQL + 3 NoSQL 方言',
      chinese: '🇨🇳 国产信创全家桶',
      multiAi: '🤖 多 provider AI 助手',
      license: '⚖️ Apache 2.0 开源',
    },
    features: ZH_FEATURES,
    db: {
      sql: 'SQL',
      nosql: 'NoSQL',
      driver: '驱动',
      tags: {
        主流: '主流',
        国产信创: '国产信创',
        'MySQL 协议兼容': 'MySQL 协议兼容',
        'PG 协议兼容': 'PG 协议兼容',
        '列存 OLAP': '列存 OLAP',
        MPP: 'MPP',
        分布式: '分布式',
        本地文件: '本地文件',
        '云 DW': '云 DW',
        时序: '时序',
        文档: '文档',
        'KV / 数据结构': 'KV / 数据结构',
        搜索引擎: '搜索引擎',
        'PG-server 模式': 'PG-server 模式',
      },
      notes: {
        oracleThin: 'thin 模式,SYSDBA 角色支持',
        obOracle: 'Oracle 租户也可连',
      },
    },
    download: {
      platforms: { macos: 'macOS', windows: 'Windows', linux: 'Linux', unknown: '所有平台' },
      currentPlatform: '当前平台',
      seeAll: '查看所有下载',
      download: (label) => `下载(${label})`,
      cnMirror: '· 🇨🇳 镜像',
      githubSrc: '· 🌐 GitHub',
      cnTip: '中国大陆默认走阿里云 OSS 镜像,下载页可手动切到 GitHub',
      intlTip: '海外默认走 GitHub Releases,下载页可手动切到 OSS 镜像',
    },
    matrix: {
      loading: '加载中…',
      latestVersion: '最新版本:',
      fallbackPrefix: '从 ',
      fallbackSuffix: ' 直接下载',
      ossLabel: 'OSS 镜像',
      githubLabel: 'GitHub Releases',
      history: '历史版本 →',
      cnMirrorBtn: '🇨🇳 国内镜像',
      cnMirrorTitle: '国内镜像:阿里云 OSS (上海),适合中国大陆下载',
      githubBtn: '🌐 GitHub',
      githubBtnTitle: '海外源:GitHub Releases,适合海外用户',
      th: { platform: '平台', arch: '架构', format: '格式', desc: '说明', download: '下载' },
      rowLabels: {
        macArm: 'macOS (Apple Silicon + Rosetta)',
        winInstaller: 'Windows 64 位安装包',
        winInstallerArm: 'Windows ARM64 安装包',
        winPortable: 'Windows 64 位免安装',
        winPortableArm: 'Windows ARM64 免安装',
        linuxAppimage: 'Linux x64',
        linuxDeb: 'Debian / Ubuntu / 麒麟 / UOS',
        linuxRpm: 'Fedora / openEuler / 中标麒麟',
        linuxPacman: 'Arch / Manjaro',
        linuxAppimageArm: 'Linux ARM64',
        linuxTarGz: 'Linux x64 (tar.gz)',
      },
      formats: { exeSetup: '.exe (安装版)', exePortable: '.exe (绿色版)' },
      downloadLink: '下载',
      errorTpl: (src, err, link) =>
        `${src} 不可达(${err}),已尝试自动切换备用源。仍失败可点上方按钮手动切换,或前往 ${link} 手动选择。`,
      tipOss: '💡 当前是国内镜像(阿里云 OSS · 华东 2 上海)。如果国内访问也慢,切到 GitHub 试试;海外用户建议直接选 GitHub。',
      tipGithub: '💡 当前是 GitHub Releases。中国大陆用户访问慢时,点上方 “🇨🇳 国内镜像” 切换到阿里云 OSS;或用 https://github.akams.cn/ 等加速镜像替换 URL 前缀。',
    },
    lightbox: { close: '关闭' },
  },

  'en-US': {
    hero: {
      dialects: '✨ 17 SQL + 3 NoSQL dialects',
      chinese: '🇨🇳 Chinese DB family bundled',
      multiAi: '🤖 Multi-provider AI assistant',
      license: '⚖️ Apache 2.0 open source',
    },
    features: EN_FEATURES,
    db: {
      sql: 'SQL',
      nosql: 'NoSQL',
      driver: 'Driver',
      tags: {
        主流: 'Mainstream',
        国产信创: 'Chinese DB family',
        'MySQL 协议兼容': 'MySQL wire-compatible',
        'PG 协议兼容': 'Postgres wire-compatible',
        '列存 OLAP': 'Columnar OLAP',
        MPP: 'MPP',
        分布式: 'Distributed',
        本地文件: 'Local file',
        '云 DW': 'Cloud DW',
        时序: 'Time-series',
        文档: 'Document',
        'KV / 数据结构': 'KV / data structures',
        搜索引擎: 'Search engine',
        'PG-server 模式': 'PG-server mode',
      },
      notes: {
        oracleThin: 'Thin mode, supports SYSDBA role',
        obOracle: 'Oracle tenant also works',
      },
    },
    download: {
      platforms: { macos: 'macOS', windows: 'Windows', linux: 'Linux', unknown: 'All platforms' },
      currentPlatform: 'Current platform',
      seeAll: 'See all downloads',
      download: (label) => `Download (${label})`,
      cnMirror: '· 🇨🇳 Mirror',
      githubSrc: '· 🌐 GitHub',
      cnTip: 'Mainland China defaults to the Aliyun OSS mirror; you can switch to GitHub on the download page',
      intlTip: 'Defaults to GitHub Releases overseas; you can switch to the OSS mirror on the download page',
    },
    matrix: {
      loading: 'Loading…',
      latestVersion: 'Latest version:',
      fallbackPrefix: 'Download directly from ',
      fallbackSuffix: '',
      ossLabel: 'OSS mirror',
      githubLabel: 'GitHub Releases',
      history: 'All versions →',
      cnMirrorBtn: '🇨🇳 China mirror',
      cnMirrorTitle: 'China mirror: Aliyun OSS (Shanghai), recommended for mainland China',
      githubBtn: '🌐 GitHub',
      githubBtnTitle: 'GitHub Releases, recommended for users outside mainland China',
      th: { platform: 'Platform', arch: 'Arch', format: 'Format', desc: 'Notes', download: 'Download' },
      rowLabels: {
        macArm: 'macOS (Apple Silicon + Rosetta)',
        winInstaller: 'Windows 64-bit installer',
        winInstallerArm: 'Windows ARM64 installer',
        winPortable: 'Windows 64-bit portable',
        winPortableArm: 'Windows ARM64 portable',
        linuxAppimage: 'Linux x64',
        linuxDeb: 'Debian / Ubuntu / Kylin / UOS',
        linuxRpm: 'Fedora / openEuler / NeoKylin',
        linuxPacman: 'Arch / Manjaro',
        linuxAppimageArm: 'Linux ARM64',
        linuxTarGz: 'Linux x64 (tar.gz)',
      },
      formats: { exeSetup: '.exe (installer)', exePortable: '.exe (portable)' },
      downloadLink: 'Download',
      errorTpl: (src, err, link) =>
        `${src} is unreachable (${err}); we already tried the fallback source. If it still fails, use the buttons above to switch manually or go to ${link} to pick a file yourself.`,
      tipOss: '💡 You are on the China mirror (Aliyun OSS · East China 2, Shanghai). If even this is slow, try GitHub; users outside mainland China should pick GitHub directly.',
      tipGithub: '💡 You are on GitHub Releases. Mainland China users who experience slow downloads can click "🇨🇳 China mirror" above to switch to Aliyun OSS, or replace the URL prefix with an accelerator such as https://github.akams.cn/.',
    },
    lightbox: { close: 'Close' },
  },

  'es-ES': {
    hero: {
      dialects: '✨ 17 dialectos SQL + 3 NoSQL',
      chinese: '🇨🇳 Familia china de BD incluida',
      multiAi: '🤖 Asistente IA multi-proveedor',
      license: '⚖️ Código abierto Apache 2.0',
    },
    features: ES_FEATURES,
    db: {
      sql: 'SQL',
      nosql: 'NoSQL',
      driver: 'Driver',
      tags: {
        主流: 'Mainstream',
        国产信创: 'Bases de datos chinas',
        'MySQL 协议兼容': 'Compatible MySQL',
        'PG 协议兼容': 'Compatible Postgres',
        '列存 OLAP': 'OLAP columnar',
        MPP: 'MPP',
        分布式: 'Distribuida',
        本地文件: 'Archivo local',
        '云 DW': 'DW en la nube',
        时序: 'Series temporales',
        文档: 'Documento',
        'KV / 数据结构': 'KV / estructuras',
        搜索引擎: 'Buscador',
        'PG-server 模式': 'Modo PG-server',
      },
      notes: {
        oracleThin: 'Modo thin, soporte para rol SYSDBA',
        obOracle: 'También funciona con tenant Oracle',
      },
    },
    download: {
      platforms: { macos: 'macOS', windows: 'Windows', linux: 'Linux', unknown: 'Todas las plataformas' },
      currentPlatform: 'Plataforma actual',
      seeAll: 'Ver todas las descargas',
      download: (label) => `Descargar (${label})`,
      cnMirror: '· 🇨🇳 Espejo',
      githubSrc: '· 🌐 GitHub',
      cnTip: 'China continental usa por defecto el espejo Aliyun OSS; puedes cambiar a GitHub en la página de descargas',
      intlTip: 'Por defecto usa GitHub Releases; puedes cambiar al espejo OSS en la página de descargas',
    },
    matrix: {
      loading: 'Cargando…',
      latestVersion: 'Última versión:',
      fallbackPrefix: 'Descargar directamente desde ',
      fallbackSuffix: '',
      ossLabel: 'espejo OSS',
      githubLabel: 'GitHub Releases',
      history: 'Todas las versiones →',
      cnMirrorBtn: '🇨🇳 Espejo China',
      cnMirrorTitle: 'Espejo China: Aliyun OSS (Shanghái), recomendado para China continental',
      githubBtn: '🌐 GitHub',
      githubBtnTitle: 'GitHub Releases, recomendado fuera de China continental',
      th: { platform: 'Plataforma', arch: 'Arq.', format: 'Formato', desc: 'Notas', download: 'Descarga' },
      rowLabels: {
        macArm: 'macOS (Apple Silicon + Rosetta)',
        winInstaller: 'Instalador Windows 64-bit',
        winInstallerArm: 'Instalador Windows ARM64',
        winPortable: 'Windows 64-bit portable',
        winPortableArm: 'Windows ARM64 portable',
        linuxAppimage: 'Linux x64',
        linuxDeb: 'Debian / Ubuntu / Kylin / UOS',
        linuxRpm: 'Fedora / openEuler / NeoKylin',
        linuxPacman: 'Arch / Manjaro',
        linuxAppimageArm: 'Linux ARM64',
        linuxTarGz: 'Linux x64 (tar.gz)',
      },
      formats: { exeSetup: '.exe (instalador)', exePortable: '.exe (portable)' },
      downloadLink: 'Descargar',
      errorTpl: (src, err, link) =>
        `${src} no está disponible (${err}); ya se intentó el origen de respaldo. Si sigue fallando, usa los botones de arriba para cambiar manualmente o ve a ${link} para elegir un archivo.`,
      tipOss: '💡 Estás en el espejo de China (Aliyun OSS · Este de China 2, Shanghái). Si va lento, prueba GitHub; los usuarios fuera de China continental deberían elegir GitHub directamente.',
      tipGithub: '💡 Estás en GitHub Releases. Si las descargas son lentas desde China continental, pulsa "🇨🇳 Espejo China" arriba para cambiar a Aliyun OSS, o usa un acelerador como https://github.akams.cn/.',
    },
    lightbox: { close: 'Cerrar' },
  },

  'fr-FR': {
    hero: {
      dialects: '✨ 17 dialectes SQL + 3 NoSQL',
      chinese: '🇨🇳 Famille BDD chinoise intégrée',
      multiAi: '🤖 Assistant IA multi-fournisseur',
      license: '⚖️ Open source Apache 2.0',
    },
    features: FR_FEATURES,
    db: {
      sql: 'SQL',
      nosql: 'NoSQL',
      driver: 'Pilote',
      tags: {
        主流: 'Grand public',
        国产信创: 'Bases de données chinoises',
        'MySQL 协议兼容': 'Compatible MySQL',
        'PG 协议兼容': 'Compatible Postgres',
        '列存 OLAP': 'OLAP en colonnes',
        MPP: 'MPP',
        分布式: 'Distribué',
        本地文件: 'Fichier local',
        '云 DW': 'DW cloud',
        时序: 'Séries temporelles',
        文档: 'Document',
        'KV / 数据结构': 'KV / structures',
        搜索引擎: 'Moteur de recherche',
        'PG-server 模式': 'Mode PG-server',
      },
      notes: {
        oracleThin: 'Mode thin, rôle SYSDBA pris en charge',
        obOracle: 'Compatible aussi avec un tenant Oracle',
      },
    },
    download: {
      platforms: { macos: 'macOS', windows: 'Windows', linux: 'Linux', unknown: 'Toutes plateformes' },
      currentPlatform: 'Plateforme actuelle',
      seeAll: 'Voir tous les téléchargements',
      download: (label) => `Télécharger (${label})`,
      cnMirror: '· 🇨🇳 Miroir',
      githubSrc: '· 🌐 GitHub',
      cnTip: 'La Chine continentale utilise par défaut le miroir Aliyun OSS ; vous pouvez basculer sur GitHub depuis la page de téléchargement',
      intlTip: 'Utilise par défaut GitHub Releases ; vous pouvez basculer sur le miroir OSS depuis la page de téléchargement',
    },
    matrix: {
      loading: 'Chargement…',
      latestVersion: 'Dernière version :',
      fallbackPrefix: 'Télécharger directement depuis ',
      fallbackSuffix: '',
      ossLabel: 'miroir OSS',
      githubLabel: 'GitHub Releases',
      history: 'Toutes les versions →',
      cnMirrorBtn: '🇨🇳 Miroir Chine',
      cnMirrorTitle: 'Miroir Chine : Aliyun OSS (Shanghai), recommandé pour la Chine continentale',
      githubBtn: '🌐 GitHub',
      githubBtnTitle: 'GitHub Releases, recommandé hors de Chine continentale',
      th: { platform: 'Plateforme', arch: 'Arch.', format: 'Format', desc: 'Notes', download: 'Télécharger' },
      rowLabels: {
        macArm: 'macOS (Apple Silicon + Rosetta)',
        winInstaller: 'Installateur Windows 64 bits',
        winInstallerArm: 'Installateur Windows ARM64',
        winPortable: 'Windows 64 bits portable',
        winPortableArm: 'Windows ARM64 portable',
        linuxAppimage: 'Linux x64',
        linuxDeb: 'Debian / Ubuntu / Kylin / UOS',
        linuxRpm: 'Fedora / openEuler / NeoKylin',
        linuxPacman: 'Arch / Manjaro',
        linuxAppimageArm: 'Linux ARM64',
        linuxTarGz: 'Linux x64 (tar.gz)',
      },
      formats: { exeSetup: '.exe (installateur)', exePortable: '.exe (portable)' },
      downloadLink: 'Télécharger',
      errorTpl: (src, err, link) =>
        `${src} indisponible (${err}) ; la source de secours a déjà été tentée. Si l'échec persiste, utilisez les boutons ci-dessus pour basculer manuellement ou allez sur ${link} pour choisir un fichier.`,
      tipOss: '💡 Vous êtes sur le miroir Chine (Aliyun OSS · Chine Est 2, Shanghai). Si c\'est lent, essayez GitHub ; les utilisateurs hors Chine continentale devraient choisir GitHub directement.',
      tipGithub: '💡 Vous êtes sur GitHub Releases. Si les téléchargements sont lents depuis la Chine continentale, cliquez sur « 🇨🇳 Miroir Chine » ci-dessus pour basculer sur Aliyun OSS, ou utilisez un accélérateur comme https://github.akams.cn/.',
    },
    lightbox: { close: 'Fermer' },
  },

  'ja-JP': {
    hero: {
      dialects: '✨ 17 SQL + 3 NoSQL 方言',
      chinese: '🇨🇳 中国国産 DB フルセット',
      multiAi: '🤖 マルチプロバイダ AI アシスタント',
      license: '⚖️ Apache 2.0 オープンソース',
    },
    features: JA_FEATURES,
    db: {
      sql: 'SQL',
      nosql: 'NoSQL',
      driver: 'ドライバ',
      tags: {
        主流: '主要',
        国产信创: '中国国産 DB',
        'MySQL 协议兼容': 'MySQL 互換',
        'PG 协议兼容': 'PostgreSQL 互換',
        '列存 OLAP': 'カラムナ OLAP',
        MPP: 'MPP',
        分布式: '分散',
        本地文件: 'ローカルファイル',
        '云 DW': 'クラウド DW',
        时序: '時系列',
        文档: 'ドキュメント',
        'KV / 数据结构': 'KV / データ構造',
        搜索引擎: '検索エンジン',
        'PG-server 模式': 'PG サーバモード',
      },
      notes: {
        oracleThin: 'thin モード、SYSDBA ロール対応',
        obOracle: 'Oracle テナントも接続可',
      },
    },
    download: {
      platforms: { macos: 'macOS', windows: 'Windows', linux: 'Linux', unknown: 'すべて' },
      currentPlatform: '現在のプラットフォーム',
      seeAll: 'すべてのダウンロードを見る',
      download: (label) => `ダウンロード(${label})`,
      cnMirror: '· 🇨🇳 ミラー',
      githubSrc: '· 🌐 GitHub',
      cnTip: '中国本土ではデフォルトで Aliyun OSS ミラーを使用、ダウンロードページで GitHub に切替可',
      intlTip: '海外ではデフォルトで GitHub Releases、ダウンロードページで OSS ミラーに切替可',
    },
    matrix: {
      loading: '読み込み中…',
      latestVersion: '最新バージョン:',
      fallbackPrefix: '',
      fallbackSuffix: ' から直接ダウンロード',
      ossLabel: 'OSS ミラー',
      githubLabel: 'GitHub Releases',
      history: '過去のバージョン →',
      cnMirrorBtn: '🇨🇳 中国ミラー',
      cnMirrorTitle: '中国ミラー:Aliyun OSS(上海)、中国本土向け推奨',
      githubBtn: '🌐 GitHub',
      githubBtnTitle: 'GitHub Releases、海外ユーザー向け推奨',
      th: { platform: 'プラットフォーム', arch: 'アーキ', format: 'フォーマット', desc: '備考', download: 'ダウンロード' },
      rowLabels: {
        macArm: 'macOS(Apple Silicon + Rosetta)',
        winInstaller: 'Windows 64-bit インストーラ',
        winInstallerArm: 'Windows ARM64 インストーラ',
        winPortable: 'Windows 64-bit ポータブル',
        winPortableArm: 'Windows ARM64 ポータブル',
        linuxAppimage: 'Linux x64',
        linuxDeb: 'Debian / Ubuntu / Kylin / UOS',
        linuxRpm: 'Fedora / openEuler / NeoKylin',
        linuxPacman: 'Arch / Manjaro',
        linuxAppimageArm: 'Linux ARM64',
        linuxTarGz: 'Linux x64 (tar.gz)',
      },
      formats: { exeSetup: '.exe(インストーラ)', exePortable: '.exe(ポータブル)' },
      downloadLink: 'ダウンロード',
      errorTpl: (src, err, link) =>
        `${src} に接続できません(${err})。フォールバックも試しました。なお失敗する場合は上部のボタンで手動切替、または ${link} で手動選択してください。`,
      tipOss: '💡 現在は中国ミラー(Aliyun OSS · 華東 2 上海)です。遅い場合は GitHub を試してください。海外ユーザーは GitHub を直接選ぶことをお勧めします。',
      tipGithub: '💡 現在は GitHub Releases です。中国本土からのアクセスが遅い場合は上部の「🇨🇳 中国ミラー」をクリックして Aliyun OSS に切替えるか、https://github.akams.cn/ などの高速化ミラーで URL を置換してください。',
    },
    lightbox: { close: '閉じる' },
  },

  'ko-KR': {
    hero: {
      dialects: '✨ 17 SQL + 3 NoSQL 방언',
      chinese: '🇨🇳 중국 국산 DB 풀세트',
      multiAi: '🤖 멀티 프로바이더 AI 어시스턴트',
      license: '⚖️ Apache 2.0 오픈소스',
    },
    features: KO_FEATURES,
    db: {
      sql: 'SQL',
      nosql: 'NoSQL',
      driver: '드라이버',
      tags: {
        主流: '주요',
        国产信创: '중국 국산 DB',
        'MySQL 协议兼容': 'MySQL 호환',
        'PG 协议兼容': 'PostgreSQL 호환',
        '列存 OLAP': '컬럼 OLAP',
        MPP: 'MPP',
        分布式: '분산',
        本地文件: '로컬 파일',
        '云 DW': '클라우드 DW',
        时序: '시계열',
        文档: '문서',
        'KV / 数据结构': 'KV / 자료구조',
        搜索引擎: '검색 엔진',
        'PG-server 模式': 'PG 서버 모드',
      },
      notes: {
        oracleThin: 'thin 모드, SYSDBA 역할 지원',
        obOracle: 'Oracle 테넌트도 연결 가능',
      },
    },
    download: {
      platforms: { macos: 'macOS', windows: 'Windows', linux: 'Linux', unknown: '모든 플랫폼' },
      currentPlatform: '현재 플랫폼',
      seeAll: '모든 다운로드 보기',
      download: (label) => `다운로드(${label})`,
      cnMirror: '· 🇨🇳 미러',
      githubSrc: '· 🌐 GitHub',
      cnTip: '중국 본토는 기본적으로 Aliyun OSS 미러 사용, 다운로드 페이지에서 GitHub 로 전환 가능',
      intlTip: '해외는 기본적으로 GitHub Releases, 다운로드 페이지에서 OSS 미러로 전환 가능',
    },
    matrix: {
      loading: '로딩 중…',
      latestVersion: '최신 버전:',
      fallbackPrefix: '',
      fallbackSuffix: ' 에서 직접 다운로드',
      ossLabel: 'OSS 미러',
      githubLabel: 'GitHub Releases',
      history: '이전 버전 →',
      cnMirrorBtn: '🇨🇳 중국 미러',
      cnMirrorTitle: '중국 미러: Aliyun OSS (상하이), 중국 본토 사용자 권장',
      githubBtn: '🌐 GitHub',
      githubBtnTitle: 'GitHub Releases, 중국 본토 외 사용자 권장',
      th: { platform: '플랫폼', arch: '아키', format: '포맷', desc: '비고', download: '다운로드' },
      rowLabels: {
        macArm: 'macOS (Apple Silicon + Rosetta)',
        winInstaller: 'Windows 64-bit 인스톨러',
        winInstallerArm: 'Windows ARM64 인스톨러',
        winPortable: 'Windows 64-bit 포터블',
        winPortableArm: 'Windows ARM64 포터블',
        linuxAppimage: 'Linux x64',
        linuxDeb: 'Debian / Ubuntu / Kylin / UOS',
        linuxRpm: 'Fedora / openEuler / NeoKylin',
        linuxPacman: 'Arch / Manjaro',
        linuxAppimageArm: 'Linux ARM64',
        linuxTarGz: 'Linux x64 (tar.gz)',
      },
      formats: { exeSetup: '.exe (인스톨러)', exePortable: '.exe (포터블)' },
      downloadLink: '다운로드',
      errorTpl: (src, err, link) =>
        `${src} 접근 불가 (${err}). 자동 폴백도 시도했습니다. 그래도 실패하면 위 버튼으로 수동 전환하거나 ${link} 에서 직접 선택하세요.`,
      tipOss: '💡 현재 중국 미러(Aliyun OSS · 화동 2 상하이)입니다. 느리면 GitHub 으로 전환해보세요. 해외 사용자는 GitHub 을 직접 선택하는 것을 권장합니다.',
      tipGithub: '💡 현재 GitHub Releases 입니다. 중국 본토에서 느릴 경우 위의 "🇨🇳 중국 미러" 를 눌러 Aliyun OSS 로 전환하거나, https://github.akams.cn/ 같은 가속 미러로 URL 을 교체하세요.',
    },
    lightbox: { close: '닫기' },
  },

  'pt-BR': {
    hero: {
      dialects: '✨ 17 dialetos SQL + 3 NoSQL',
      chinese: '🇨🇳 Família chinesa de BDs incluída',
      multiAi: '🤖 Assistente IA multi-provedor',
      license: '⚖️ Código aberto Apache 2.0',
    },
    features: PT_FEATURES,
    db: {
      sql: 'SQL',
      nosql: 'NoSQL',
      driver: 'Driver',
      tags: {
        主流: 'Convencional',
        国产信创: 'Bancos chineses',
        'MySQL 协议兼容': 'Compatível com MySQL',
        'PG 协议兼容': 'Compatível com Postgres',
        '列存 OLAP': 'OLAP colunar',
        MPP: 'MPP',
        分布式: 'Distribuído',
        本地文件: 'Arquivo local',
        '云 DW': 'DW na nuvem',
        时序: 'Séries temporais',
        文档: 'Documento',
        'KV / 数据结构': 'KV / estruturas',
        搜索引擎: 'Motor de busca',
        'PG-server 模式': 'Modo PG-server',
      },
      notes: {
        oracleThin: 'Modo thin, suporte ao papel SYSDBA',
        obOracle: 'Tenant Oracle também funciona',
      },
    },
    download: {
      platforms: { macos: 'macOS', windows: 'Windows', linux: 'Linux', unknown: 'Todas as plataformas' },
      currentPlatform: 'Plataforma atual',
      seeAll: 'Ver todos os downloads',
      download: (label) => `Baixar (${label})`,
      cnMirror: '· 🇨🇳 Espelho',
      githubSrc: '· 🌐 GitHub',
      cnTip: 'China continental usa por padrão o espelho Aliyun OSS; você pode trocar para o GitHub na página de download',
      intlTip: 'Por padrão usa GitHub Releases; você pode trocar para o espelho OSS na página de download',
    },
    matrix: {
      loading: 'Carregando…',
      latestVersion: 'Última versão:',
      fallbackPrefix: 'Baixar diretamente de ',
      fallbackSuffix: '',
      ossLabel: 'espelho OSS',
      githubLabel: 'GitHub Releases',
      history: 'Todas as versões →',
      cnMirrorBtn: '🇨🇳 Espelho China',
      cnMirrorTitle: 'Espelho China: Aliyun OSS (Xangai), recomendado para China continental',
      githubBtn: '🌐 GitHub',
      githubBtnTitle: 'GitHub Releases, recomendado fora da China continental',
      th: { platform: 'Plataforma', arch: 'Arq.', format: 'Formato', desc: 'Notas', download: 'Baixar' },
      rowLabels: {
        macArm: 'macOS (Apple Silicon + Rosetta)',
        winInstaller: 'Instalador Windows 64-bit',
        winInstallerArm: 'Instalador Windows ARM64',
        winPortable: 'Windows 64-bit portátil',
        winPortableArm: 'Windows ARM64 portátil',
        linuxAppimage: 'Linux x64',
        linuxDeb: 'Debian / Ubuntu / Kylin / UOS',
        linuxRpm: 'Fedora / openEuler / NeoKylin',
        linuxPacman: 'Arch / Manjaro',
        linuxAppimageArm: 'Linux ARM64',
        linuxTarGz: 'Linux x64 (tar.gz)',
      },
      formats: { exeSetup: '.exe (instalador)', exePortable: '.exe (portátil)' },
      downloadLink: 'Baixar',
      errorTpl: (src, err, link) =>
        `${src} indisponível (${err}); a origem alternativa já foi tentada. Se continuar falhando, use os botões acima para alternar manualmente ou vá a ${link} para escolher um arquivo.`,
      tipOss: '💡 Você está no espelho China (Aliyun OSS · Leste China 2, Xangai). Se estiver lento, tente o GitHub; usuários fora da China continental deveriam escolher GitHub direto.',
      tipGithub: '💡 Você está no GitHub Releases. Se downloads forem lentos da China continental, clique em "🇨🇳 Espelho China" acima para trocar para Aliyun OSS, ou use um acelerador como https://github.akams.cn/.',
    },
    lightbox: { close: 'Fechar' },
  },
}

export function getComponentLabels(lang: string): ComponentLabels {
  return COMPONENT_LABELS[lang] ?? COMPONENT_LABELS['zh-CN']
}

import type { DefaultTheme } from 'vitepress'

/** 用一组标签 + URL 前缀生成完整 themeConfig(nav + sidebar + UI 字符串) */
export function makeThemeConfig(L: LocaleLabels, prefix: string): DefaultTheme.Config {
  return {
    logo: '/favicon.svg',
    nav: [
      { text: L.home, link: `${prefix}/` },
      { text: L.download, link: `${prefix}/download` },
      { text: L.databases, link: `${prefix}/databases` },
      { text: L.docs, link: `${prefix}/docs/getting-started` },
      {
        text: L.links,
        items: [
          { text: L.github, link: 'https://github.com/duhbbx/SkylerX' },
          { text: L.changelog, link: 'https://github.com/duhbbx/SkylerX/releases' },
          { text: L.feedback, link: 'https://github.com/duhbbx/SkylerX/issues' },
        ],
      },
    ],
    sidebar: {
      [`${prefix}/docs/`]: [
        {
          text: L.gettingStarted,
          items: [
            { text: L.quickStart, link: `${prefix}/docs/getting-started` },
            { text: L.installAndUpgrade, link: `${prefix}/docs/install` },
            { text: L.connections, link: `${prefix}/docs/connections` },
          ],
        },
        {
          text: L.queryEditing,
          items: [
            { text: L.sqlEditor, link: `${prefix}/docs/query` },
            { text: L.resultGrid, link: `${prefix}/docs/grid` },
            { text: L.altViews, link: `${prefix}/docs/views` },
          ],
        },
        {
          text: L.schemaData,
          items: [
            { text: L.schemaManagement, link: `${prefix}/docs/schema` },
            { text: L.dataFlow, link: `${prefix}/docs/data-flow` },
            { text: L.dbaMonitoring, link: `${prefix}/docs/dba` },
          ],
        },
        {
          text: L.nosqlDeep,
          items: [{ text: L.mongoRedisEs, link: `${prefix}/docs/nosql` }],
        },
        {
          text: L.aiAssistant,
          items: [{ text: L.aiGuide, link: `${prefix}/docs/ai` }],
        },
        {
          text: L.securityProductivity,
          items: [
            { text: L.securityCompliance, link: `${prefix}/docs/security` },
            { text: L.productivity, link: `${prefix}/docs/productivity` },
          ],
        },
        {
          text: L.advanced,
          items: [
            { text: L.advancedFeatures, link: `${prefix}/docs/advanced` },
            { text: L.troubleshooting, link: `${prefix}/docs/troubleshooting` },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/duhbbx/SkylerX' }],
    footer: {
      message: `<a href="https://github.com/duhbbx/SkylerX/blob/main/LICENSE">Apache License 2.0</a> · ${L.company}`,
      copyright: '© 2026 Wuhan Skyler Network Technology Co., Ltd.',
    },
    outline: { level: [2, 3], label: L.outlineLabel },
    docFooter: { prev: L.prevPage, next: L.nextPage },
    lastUpdatedText: L.lastUpdated,
    darkModeSwitchLabel: L.themeLabel,
    sidebarMenuLabel: L.menuLabel,
    returnToTopLabel: L.returnTop,
    editLink: {
      pattern: 'https://github.com/duhbbx/SkylerX/edit/main/apps/website/:path',
      text: L.editLink,
    },
  }
}
