import { ipcMain } from 'electron'

/**
 * AI 请求 IPC：渲染层把 fetch options 发过来，主进程用 Node 的 fetch 发请求并把结果回传。
 * 这样可以绕过浏览器 CORS（DeepSeek / OpenAI / Grok 等不像 Anthropic 那样开了
 * `anthropic-dangerous-direct-browser-access`，渲染层直发会被 CORS 预检卡住 → "Failed to fetch"）。
 *
 * 渲染层调用：window.api.ai.fetch({ url, method, headers, body }) → { ok, status, body, error }
 */

export const AI_IPC = {
  fetch: 'ai:fetch',
} as const

export interface AiFetchRequest {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  /** 字符串 body；调用方负责 JSON.stringify */
  body?: string
  /** 毫秒超时，缺省 60s */
  timeoutMs?: number
}

export interface AiFetchResponse {
  ok: boolean
  status: number
  /** 服务端响应 body（字符串，调用方按需 JSON.parse） */
  body: string
  /** 网络/超时等致 fetch 直接抛错时填充 */
  error?: string
}

export function registerAiIpc(): void {
  ipcMain.handle(AI_IPC.fetch, async (_e, req: AiFetchRequest): Promise<AiFetchResponse> => {
    const controller = new AbortController()
    const timeoutMs = req.timeoutMs ?? 60_000
    const to = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(req.url, {
        method: req.method ?? 'POST',
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      })
      const body = await res.text()
      return { ok: res.ok, status: res.status, body }
    } catch (e) {
      return {
        ok: false,
        status: 0,
        body: '',
        error: e instanceof Error ? e.message : String(e),
      }
    } finally {
      clearTimeout(to)
    }
  })
}
