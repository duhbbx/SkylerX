import type { ConnectionEnv } from '@db-tool/shared-types'

/** 环境标记的展示元信息（标签 + 颜色）。 */
export const ENV_META: Record<ConnectionEnv, { label: string; color: string }> = {
  dev: { label: '开发', color: '#4caf50' },
  test: { label: '测试', color: '#e0a020' },
  prod: { label: '生产', color: '#e04050' },
}

export const ENV_OPTIONS: ConnectionEnv[] = ['dev', 'test', 'prod']

/** 从连接配置读取环境标记（存于 extra.env）；非法/缺省返回 undefined。 */
export function connEnv(conn: { extra?: Record<string, unknown> } | undefined): ConnectionEnv | undefined {
  const e = conn?.extra?.env
  return e === 'dev' || e === 'test' || e === 'prod' ? e : undefined
}
