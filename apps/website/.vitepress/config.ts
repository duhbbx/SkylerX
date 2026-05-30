import { defineConfig } from 'vitepress'
import { EN, ES, FR, JA, KO, PT, ZH, makeThemeConfig } from './i18n'

/**
 * SkylerX 官网配置。
 *
 * - 中文为默认 locale(根路径 /)
 * - 6 个其它语言:/en/ /es/ /fr/ /ja/ /ko/ /pt/
 * - 部署到 https://skylerx.skyler.uno
 *
 * 各语言 markdown 放在对应子目录,nav/sidebar 标签在 .vitepress/i18n.ts 中统一管理。
 */
export default defineConfig({
  title: 'SkylerX',
  description: '开源跨平台数据库管理工具 · 支持 20+ SQL/NoSQL 方言 · AI 加持 · Navicat / DBeaver 替代',
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
          content: '20+ SQL/NoSQL dialects · Chinese 信创 databases · AI assistant · Cross-platform desktop',
        },
      ],
      ['meta', { property: 'og:image', content: 'https://skylerx.skyler.uno/og.png' }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ]
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

  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: makeThemeConfig(ZH, ''),
    },
    en: {
      label: 'English',
      lang: 'en-US',
      themeConfig: makeThemeConfig(EN, '/en'),
    },
    es: {
      label: 'Español',
      lang: 'es-ES',
      themeConfig: makeThemeConfig(ES, '/es'),
    },
    fr: {
      label: 'Français',
      lang: 'fr-FR',
      themeConfig: makeThemeConfig(FR, '/fr'),
    },
    ja: {
      label: '日本語',
      lang: 'ja-JP',
      themeConfig: makeThemeConfig(JA, '/ja'),
    },
    ko: {
      label: '한국어',
      lang: 'ko-KR',
      themeConfig: makeThemeConfig(KO, '/ko'),
    },
    pt: {
      label: 'Português',
      lang: 'pt-BR',
      themeConfig: makeThemeConfig(PT, '/pt'),
    },
  },

  themeConfig: {
    // 顶层 themeConfig 主要给 logo / socialLinks / search 等"全局"项;
    // 各 locale 的 nav / sidebar / footer / docFooter 由 locales[*].themeConfig 覆盖。
    logo: '/favicon.svg',
    socialLinks: [{ icon: 'github', link: 'https://github.com/duhbbx/SkylerX' }],
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
          en: {
            translations: {
              button: { buttonText: 'Search', buttonAriaLabel: 'Search' },
              modal: {
                noResultsText: 'No matches',
                resetButtonTitle: 'Reset',
                footer: { selectText: 'to select', navigateText: 'to navigate', closeText: 'to close' },
              },
            },
          },
          es: {
            translations: {
              button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar' },
              modal: {
                noResultsText: 'Sin resultados',
                resetButtonTitle: 'Reiniciar',
                footer: { selectText: 'seleccionar', navigateText: 'navegar', closeText: 'cerrar' },
              },
            },
          },
          fr: {
            translations: {
              button: { buttonText: 'Rechercher', buttonAriaLabel: 'Rechercher' },
              modal: {
                noResultsText: 'Aucun résultat',
                resetButtonTitle: 'Réinitialiser',
                footer: { selectText: 'sélectionner', navigateText: 'naviguer', closeText: 'fermer' },
              },
            },
          },
          ja: {
            translations: {
              button: { buttonText: '検索', buttonAriaLabel: '検索' },
              modal: {
                noResultsText: '一致する結果がありません',
                resetButtonTitle: 'リセット',
                footer: { selectText: '選択', navigateText: '移動', closeText: '閉じる' },
              },
            },
          },
          ko: {
            translations: {
              button: { buttonText: '검색', buttonAriaLabel: '검색' },
              modal: {
                noResultsText: '검색 결과 없음',
                resetButtonTitle: '초기화',
                footer: { selectText: '선택', navigateText: '이동', closeText: '닫기' },
              },
            },
          },
          pt: {
            translations: {
              button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar' },
              modal: {
                noResultsText: 'Nenhum resultado',
                resetButtonTitle: 'Limpar',
                footer: { selectText: 'selecionar', navigateText: 'navegar', closeText: 'fechar' },
              },
            },
          },
        },
      },
    },
  },
})
