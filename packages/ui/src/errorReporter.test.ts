import { describe, expect, it } from 'vitest'
import { captureCallsite, formatMarkdown, redact, type ErrorReport } from './errorReporter'

describe('redact', () => {
  it('replaces top-level sensitive fields', () => {
    expect(redact({ host: 'localhost', password: 'hunter2' })).toEqual({
      host: 'localhost',
      password: '***',
    })
  })

  it('walks nested objects', () => {
    expect(redact({ ssl: { ca: 'aaa', privateKey: 'bbb' } })).toEqual({
      ssl: { ca: 'aaa', privateKey: '***' },
    })
  })

  it('matches case-insensitively', () => {
    expect(redact({ Password: 'x', AUTHORIZATION: 'y' })).toEqual({
      Password: '***',
      AUTHORIZATION: '***',
    })
  })

  it('walks arrays without redacting their string contents', () => {
    expect(redact({ urls: ['a', 'b'], token: 't' })).toEqual({
      urls: ['a', 'b'],
      token: '***',
    })
  })

  it('caps recursion depth to avoid stack overflow on cyclic refs', () => {
    const cyclic: Record<string, unknown> = { name: 'root' }
    cyclic.self = cyclic
    const out = redact(cyclic) as Record<string, unknown>
    expect(out.name).toBe('root')
    // The cycle terminates: at the depth cap, the self-reference becomes the
    // sentinel string. Asserts the cap actually fired (regression guard).
    expect(JSON.stringify(out)).toContain('[deep object]')
  })

  it('passes through primitives', () => {
    expect(redact(null)).toBeNull()
    expect(redact(42)).toBe(42)
    expect(redact('plain string')).toBe('plain string')
  })

  it('does not accept a user-supplied depth parameter (encapsulated)', () => {
    // depth is now an internal recursion counter, not part of the public API.
    // This is a compile-time check via the type signature; at runtime,
    // passing extra args has no effect.
    // @ts-expect-error — redact takes exactly one parameter
    expect(redact({ password: 'x' }, 100)).toEqual({ password: '***' })
  })
})

describe('captureCallsite', () => {
  it('parses a V8 stack frame with function name', () => {
    const fakeStack = [
      'Error',
      '    at reportError (errorReporter.ts:42:13)',
      '    at copySelectedKey (RedisPane.vue:840:5)',
      '    at HTMLButtonElement.<anonymous> (chunk.js:1:1)',
    ].join('\n')
    expect(captureCallsite(fakeStack)).toEqual({
      function: 'copySelectedKey',
      file: 'RedisPane.vue',
      line: 840,
    })
  })

  it('parses a V8 stack frame for a constructor call (new Foo)', () => {
    const fakeStack = [
      'Error',
      '    at reportError (errorReporter.ts:42:13)',
      '    at new Connection (postgres.ts:99:5)',
    ].join('\n')
    expect(captureCallsite(fakeStack)).toEqual({
      function: 'new Connection',
      file: 'postgres.ts',
      line: 99,
    })
  })

  it('parses an anonymous frame (no function name)', () => {
    const fakeStack = ['Error', '    at reportError (errorReporter.ts:42:13)', '    at NavTree.vue:730:5'].join('\n')
    expect(captureCallsite(fakeStack)).toEqual({
      function: undefined,
      file: 'NavTree.vue',
      line: 730,
    })
  })

  it('returns a sentinel when the stack is empty or unparseable', () => {
    expect(captureCallsite('')).toEqual({ file: 'unknown', function: undefined, line: undefined })
    expect(captureCallsite('just garbage no frames here')).toEqual({
      file: 'unknown',
      function: undefined,
      line: undefined,
    })
  })
})

describe('formatMarkdown', () => {
  it('renders a fully populated report', () => {
    const report: ErrorReport = {
      message: 'connect ECONNREFUSED 127.0.0.1:5432',
      stack: 'Error: connect ECONNREFUSED\n    at Connection.connect (postgres.ts:537:5)',
      callsite: { file: 'NavTree.vue', function: 'onConnDrop', line: 730 },
      tag: 'connection-test',
      args: { host: 'localhost', port: 5432, password: '***' },
      env: {
        appVersion: '0.5.0-rc19',
        platform: 'darwin',
        arch: 'arm64',
        electronVer: '34.2.0',
        nodeVer: '22.10.0',
        chromeVer: '132.0.6834.83',
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
        channel: 'oss-cn',
        osRelease: '24.5.0',
      },
      timestamp: '2026-05-31T01:50:00.000Z',
    }
    const md = formatMarkdown(report)
    expect(md).toContain('## Error')
    expect(md).toContain('connect ECONNREFUSED 127.0.0.1:5432')
    expect(md).toContain('**Callsite**: `NavTree.vue` · `onConnDrop` · `730`')
    expect(md).toContain('**Tag**: `connection-test`')
    expect(md).toContain('"password": "***"')
    expect(md).toContain('SkylerX: **v0.5.0-rc19**')
    expect(md).toContain('(channel: `oss-cn`)')
    expect(md).toContain('OS: macOS 24.5.0 (arm64)')
    expect(md).toContain('Captured at: 2026-05-31T01:50:00.000Z')
  })

  it('omits Tag and Args sections when not provided', () => {
    const md = formatMarkdown({
      message: 'oops',
      stack: undefined,
      callsite: { file: 'unknown', function: undefined, line: undefined },
      tag: undefined,
      args: undefined,
      env: {
        appVersion: '0.5.0-rc19',
        platform: 'linux',
        arch: 'x64',
        electronVer: '34.2.0',
        nodeVer: '22.10.0',
        chromeVer: '132.0.6834.83',
        locale: 'en-US',
        timezone: 'UTC',
        channel: 'github',
        osRelease: '6.5.0',
      },
      timestamp: '2026-05-31T01:50:00.000Z',
    })
    expect(md).not.toContain('**Tag**:')
    expect(md).not.toContain('**Args**')
    expect(md).toContain('OS: Linux 6.5.0 (x64)')
  })
})
