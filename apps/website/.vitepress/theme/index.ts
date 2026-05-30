import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import DatabaseGrid from '../components/DatabaseGrid.vue'
import DownloadButton from '../components/DownloadButton.vue'
import DownloadMatrix from '../components/DownloadMatrix.vue'
import FeatureGrid from '../components/FeatureGrid.vue'
import HeroExtra from '../components/HeroExtra.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('DatabaseGrid', DatabaseGrid)
    app.component('DownloadButton', DownloadButton)
    app.component('DownloadMatrix', DownloadMatrix)
    app.component('FeatureGrid', FeatureGrid)
    app.component('HeroExtra', HeroExtra)
  },
} satisfies Theme
