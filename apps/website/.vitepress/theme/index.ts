import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import DatabaseGrid from '../components/DatabaseGrid.vue'
import DownloadButton from '../components/DownloadButton.vue'
import DownloadMatrix from '../components/DownloadMatrix.vue'
import FeatureGrid from '../components/FeatureGrid.vue'
import HeroExtra from '../components/HeroExtra.vue'
import Lightbox from '../components/Lightbox.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  // 全局挂 Lightbox(layout-bottom 槽全站只渲染一次)
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'layout-bottom': () => h(Lightbox),
    })
  },
  enhanceApp({ app }) {
    app.component('DatabaseGrid', DatabaseGrid)
    app.component('DownloadButton', DownloadButton)
    app.component('DownloadMatrix', DownloadMatrix)
    app.component('FeatureGrid', FeatureGrid)
    app.component('HeroExtra', HeroExtra)
  },
} satisfies Theme
