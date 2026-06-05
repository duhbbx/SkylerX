/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest'
import { askAiChatStream, canEmbed, extractSql, fmtOracleType } from './ai'
import { settings } from './settings'

describe('extractSql', () => {
  it('pulls the first ```sql fenced block', () => {
    const md = 'sure:\n```sql\nSELECT 1;\n```\nthen done'
    expect(extractSql(md)).toBe('SELECT 1;')
  })
  it('falls back to any fenced block when no sql tag', () => {
    expect(extractSql('```\nSELECT * FROM t;\n```')).toBe('SELECT * FROM t;')
  })
  it('returns the trimmed input when no fence', () => {
    expect(extractSql('  SELECT now();  ')).toBe('SELECT now();')
  })
})

describe('canEmbed', () => {
  it('reflects the dedicated embedding config, not the chat provider', () => {
    settings.aiEmbeddingApiKey = ''
    settings.aiEmbeddingBaseUrl = ''
    expect(canEmbed()).toBe(false)
    settings.aiEmbeddingApiKey = 'sk-x'
    expect(canEmbed()).toBe(false) // 缺 baseUrl
    settings.aiEmbeddingBaseUrl = 'https://api.openai.com'
    expect(canEmbed()).toBe(true) // key + baseUrl 齐 → 可向量/混合检索
  })
})

describe('askAiChatStream', () => {
  // 模拟主进程 bridge：按给定 chunk 顺序回调 onChunk，再 resolve
  function mockBridge(chunks: string[]): void {
    ;(globalThis as unknown as { api: unknown }).api = {
      ai: {
        stream: async (
          _req: unknown,
          onChunk: (p: { chunk: string }) => void,
        ): Promise<{ ok: boolean; status: number }> => {
          for (const c of chunks) onChunk({ chunk: c })
          return { ok: true, status: 200 }
        },
      },
    }
  }
  afterEach(() => {
    delete (globalThis as unknown as { api?: unknown }).api
  })

  it('accumulates OpenAI-compat deltas across a frame split mid-chunk', async () => {
    settings.aiProvider = 'openai'
    settings.aiProviders.openai.baseUrl = 'https://api.openai.com'
    settings.aiProviders.openai.apiKey = 'sk-x'
    // 第 2、3 个 chunk 把一个 `\n\n` 帧边界劈成两半，考验跨 chunk 累积
    mockBridge([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
      '\ndata: {"choices":[{"delta":{"content":"!"}}]}\n\n',
      'data: [DONE]\n\n',
    ])
    const tokens: string[] = []
    const out = await askAiChatStream({ messages: [{ role: 'user', content: 'hi' }] }, (d) =>
      tokens.push(d),
    )
    expect(out).toBe('Hello!')
    expect(tokens).toEqual(['Hel', 'lo', '!'])
  })

  it('parses Anthropic content_block_delta events (ignores non-text events)', async () => {
    settings.aiProvider = 'anthropic'
    settings.aiProviders.anthropic.baseUrl = 'https://api.anthropic.com'
    settings.aiProviders.anthropic.apiKey = 'sk-ant'
    mockBridge([
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"AB"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"CD"}}\n\n',
    ])
    const out = await askAiChatStream({ messages: [{ role: 'user', content: 'hi' }] }, () => {})
    expect(out).toBe('ABCD')
  })

  it('local provider (ollama) streams with no API key', async () => {
    settings.aiProvider = 'ollama'
    settings.aiProviders.ollama.baseUrl = 'http://localhost:11434'
    settings.aiProviders.ollama.apiKey = ''
    mockBridge(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', 'data: [DONE]\n\n'])
    const out = await askAiChatStream({ messages: [{ role: 'user', content: 'x' }] }, () => {})
    expect(out).toBe('hi')
  })
})

describe('fmtOracleType', () => {
  it('char/raw types carry length', () => {
    expect(fmtOracleType('VARCHAR2', 50, null, null)).toBe('VARCHAR2(50)')
    expect(fmtOracleType('CHAR', 1, null, null)).toBe('CHAR(1)')
    expect(fmtOracleType('NVARCHAR2', 20, null, null)).toBe('NVARCHAR2(20)')
    expect(fmtOracleType('RAW', 16, null, null)).toBe('RAW(16)')
  })
  it('NUMBER carries precision and scale', () => {
    expect(fmtOracleType('NUMBER', null, 10, 2)).toBe('NUMBER(10,2)')
    expect(fmtOracleType('NUMBER', null, 10, 0)).toBe('NUMBER(10)')
    expect(fmtOracleType('NUMBER', null, 10, null)).toBe('NUMBER(10)')
  })
  it('NUMBER without precision stays bare', () => {
    expect(fmtOracleType('NUMBER', null, null, null)).toBe('NUMBER')
  })
  it('other types pass through unchanged', () => {
    expect(fmtOracleType('DATE', null, null, null)).toBe('DATE')
    expect(fmtOracleType('CLOB', 4000, null, null)).toBe('CLOB')
    expect(fmtOracleType('TIMESTAMP(6)', null, null, 6)).toBe('TIMESTAMP(6)')
  })
})
