import { describe, expect, it } from 'vitest'
// Import from env-summary directly (not via ./system) so the test stays
// electron-free — ./system pulls in `electron` at top level, which fails to
// load in headless CI where the electron binary isn't extracted on disk.
import { buildEnvSummary } from './env-summary'

describe('buildEnvSummary', () => {
  it('preserves a non-undefined channel without coercing', () => {
    const result = buildEnvSummary({
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
    })
    expect(result.channel).toBe('oss-cn')
    // Spot-check pass-through of a couple other fields
    expect(result.appVersion).toBe('0.5.0-rc19')
    expect(result.osRelease).toBe('24.5.0')
  })

  it('coerces missing channel to "github"', () => {
    const result = buildEnvSummary({
      appVersion: '0.5.0-rc19',
      platform: 'darwin',
      arch: 'arm64',
      electronVer: '34.2.0',
      nodeVer: '22.10.0',
      chromeVer: '132.0.6834.83',
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      channel: undefined,
      osRelease: '24.5.0',
    })
    expect(result.channel).toBe('github')
  })
})
