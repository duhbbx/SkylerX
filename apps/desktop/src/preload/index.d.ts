import type { DesktopApi } from './index'

declare global {
  interface Window {
    api: DesktopApi
  }
}

export {}
