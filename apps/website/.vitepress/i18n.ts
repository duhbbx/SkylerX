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
