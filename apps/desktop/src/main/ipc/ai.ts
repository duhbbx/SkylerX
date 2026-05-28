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

/** 取消注册表：renderer 可通过 ai:cancel 让正在飞的请求中止 */
const inflight = new Map<string, AbortController>()

export function registerAiIpc(): void {
  ipcMain.handle(
    AI_IPC.fetch,
    async (_e, req: AiFetchRequest & { reqId?: string }): Promise<AiFetchResponse> => {
      const id = req.reqId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const controller = new AbortController()
      inflight.set(id, controller)
      const timeoutMs = req.timeoutMs ?? 60_000
      const to = setTimeout(() => controller.abort(), timeoutMs)
      const started = Date.now()
      console.log(
        `[ai:fetch] → ${req.method ?? 'POST'} ${req.url} (id=${id}, timeout=${timeoutMs}ms)`,
      )
      try {
        const res = await fetch(req.url, {
          method: req.method ?? 'POST',
          headers: req.headers,
          body: req.body,
          signal: controller.signal,
        })
        const body = await res.text()
        console.log(
          `[ai:fetch] ← ${res.status} ${Date.now() - started}ms (id=${id}, ${body.length}B)`,
        )
        return { ok: res.ok, status: res.status, body }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.log(`[ai:fetch] ✗ ${msg} ${Date.now() - started}ms (id=${id})`)
        return { ok: false, status: 0, body: '', error: msg }
      } finally {
        clearTimeout(to)
        inflight.delete(id)
      }
    },
  )

  ipcMain.handle('ai:cancel', (_e, id: string): boolean => {
    const c = inflight.get(id)
    if (!c) return false
    c.abort()
    inflight.delete(id)
    return true
  })
}
