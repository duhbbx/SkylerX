import { defineConfig } from 'vitepress'

/**
 * SkylerX 官网配置。
 *
 * - 默认中文,英文镜像放 /en/
 * - 部署到 https://skyler.uno(根域)
 * - 下载源:目前直链 GitHub Releases,后续可加 OSS 镜像
 */
export default defineConfig({
  title: 'SkylerX',
  description: '开源跨平台数据库管理工具 · 支持 20+ SQL/NoSQL 方言 · AI 加持 · Navicat / DBeaver 替代',
  lang: 'zh-CN',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,
  appearance: 'dark',

  head: (() => {
    const base: Array<[string, Record<string, string>]> = [
      ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      ['meta', { name: 'theme-color', content: '#7c6cff' }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:title', content: 'SkylerX — 开源数据库管理工具' }],
      [
        'meta',
        {
          property: 'og:description',
          content: '20+ SQL/NoSQL 方言 · 国产数据库全家桶 · AI 助手 · 跨平台桌面端',
        },
      ],
      ['meta', { property: 'og:image', content: 'https://skyler.uno/og.png' }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ]
    // Umami 自托管:仅当构建时 env UMAMI_WEBSITE_ID 存在才注入 script,
    // 避免占位 UUID 导致 Umami script.js 404。
    // 用法:UMAMI_WEBSITE_ID=xxxxxxxx-xxxx-... pnpm build:website
    if (process.env.UMAMI_WEBSITE_ID) {
      base.push([
        'script',
        {
          defer: '',
          src: 'https://umami.skyler.uno/script.js',
          'data-website-id': process.env.UMAMI_WEBSITE_ID,
        },
      ])
    }
    return base
  })(),

  themeConfig: {
    logo: '/favicon.svg',

    nav: [
      { text: '首页', link: '/' },
      { text: '下载', link: '/download' },
      { text: '支持的数据库', link: '/databases' },
      { text: '文档', link: '/docs/getting-started' },
      {
        text: '链接',
        items: [
          { text: 'GitHub', link: 'https://github.com/duhbbx/SkylerX' },
          { text: '版本日志', link: 'https://github.com/duhbbx/SkylerX/releases' },
          { text: '反馈 issue', link: 'https://github.com/duhbbx/SkylerX/issues' },
        ],
      },
    ],

    sidebar: {
      '/docs/': [
        {
          text: '入门',
          items: [
            { text: '快速开始', link: '/docs/getting-started' },
            { text: '安装与升级', link: '/docs/install' },
            { text: '连接管理', link: '/docs/connections' },
          ],
        },
        {
          text: '查询与编辑',
          items: [
            { text: 'SQL 编辑器', link: '/docs/query' },
            { text: '结果集网格', link: '/docs/grid' },
            { text: '替代视图(图表/透视/地理/时间轴/树)', link: '/docs/views' },
          ],
        },
        {
          text: '结构与数据',
          items: [
            { text: '结构管理(设计器/快照/对比/ER)', link: '/docs/schema' },
            { text: '数据流(导入/导出/备份/迁移)', link: '/docs/data-flow' },
            { text: 'DBA 与监控', link: '/docs/dba' },
          ],
        },
        {
          text: 'NoSQL 深度',
          items: [{ text: 'MongoDB / Redis / Elasticsearch', link: '/docs/nosql' }],
        },
        {
          text: 'AI 助手',
          items: [{ text: 'AI 全通道指南', link: '/docs/ai' }],
        },
        {
          text: '安全与生产力',
          items: [
            { text: '安全与合规(国密/等保/脱敏)', link: '/docs/security' },
            { text: '生产力(命令面板/快捷键/Dashboard/Webhook)', link: '/docs/productivity' },
          ],
        },
        {
          text: '高级',
          items: [
            { text: '高级特性(EXPLAIN/索引/迁移向导/可视化构造器)', link: '/docs/advanced' },
            { text: '排错与兼容性', link: '/docs/troubleshooting' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/duhbbx/SkylerX' }],

    footer: {
      message:
        '<a href="https://github.com/duhbbx/SkylerX/blob/main/LICENSE">Apache License 2.0</a> · 武汉斯凯勒网络科技有限公司',
      copyright: '© 2026 Wuhan Skyler Network Technology Co., Ltd.',
    },

    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdatedText: '最后更新',
    darkModeSwitchLabel: '主题',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',

    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: '搜索文档', buttonAriaLabel: '搜索' },
              modal: {
                noResultsText: '无匹配结果',
                resetButtonTitle: '重置',
                footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
              },
            },
          },
        },
      },
    },

    editLink: {
      pattern: 'https://github.com/duhbbx/SkylerX/edit/main/apps/website/:path',
      text: '在 GitHub 上编辑此页',
    },
  },

  // 后续扩展英文:打开 locales 即可
  // locales: { root: { label: '中文', lang: 'zh-CN' }, en: { label: 'English', lang: 'en' } },
})
