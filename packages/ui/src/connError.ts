/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 判定一条错误信息是否为「连接级」错误（连不上 / 认证失败），
 * 用于在查询/展开失败时自动弹出连接编辑框让用户改配置。
 * 排除"驱动未实现/未安装"这类改配置也修不了的错误。
 */
export function isConnectionError(message: string): boolean {
  if (/驱动未实现|驱动未安装|not implemented/i.test(message)) return false
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ECONNRESET|getaddrinfo|Access denied|authentication|password|Connection (lost|terminated|refused)|connect\s|无法连接|拒绝连接/i.test(
    message,
  )
}

/**
 * 连接错误分类：把各种底层错误（Node errno / 驱动文案 / 中文提示）
 * 收敛到固定枚举，方便 UI 给出有针对性的排查步骤。
 */
export type ConnErrorKind =
  | 'port-unreachable' // ECONNREFUSED, EHOSTUNREACH, ECONNRESET
  | 'host-unknown' // ENOTFOUND, getaddrinfo
  | 'timeout' // ETIMEDOUT, "Connection timeout"
  | 'auth-failed' // "Access denied", "password authentication failed", "Login failed"
  | 'ssl-fail' // "SSL", "TLS", "self signed certificate"
  | 'driver-missing' // "未安装", "Cannot find module", "尚未注册方言"
  | 'permission-denied' // EACCES
  | 'database-not-found' // "Unknown database", "database does not exist"
  | 'other'

export interface CategorizedError {
  kind: ConnErrorKind
  /** 给用户看的友好标题（i18n key，UI 渲染时翻译） */
  title: string
  /** 排查步骤（i18n key 数组，UI 渲染时翻译） */
  stepKeys: string[]
  /** 原始错误（折叠 in details） */
  raw: string
}

/** 每个 kind 对应的排查步骤 i18n key（3-5 条）。 */
const STEPS: Record<ConnErrorKind, string[]> = {
  'port-unreachable': [
    'errSteps.checkPortListen',
    'errSteps.checkFirewall',
    'errSteps.checkDbHostBind',
    'errSteps.checkPortNumber',
  ],
  'host-unknown': [
    'errSteps.checkHostSpelling',
    'errSteps.checkDns',
    'errSteps.checkHostsFile',
    'errSteps.checkVpn',
  ],
  timeout: [
    'errSteps.checkNetworkReachable',
    'errSteps.checkServerLoad',
    'errSteps.checkSshTunnel',
    'errSteps.increaseTimeout',
  ],
  'auth-failed': [
    'errSteps.checkPassword',
    'errSteps.checkUserGrants',
    'errSteps.checkAuthPlugin',
    'errSteps.checkHostWhitelist',
  ],
  'ssl-fail': [
    'errSteps.checkSslToggle',
    'errSteps.checkSslCert',
    'errSteps.disableRejectUnauthorized',
    'errSteps.checkSslVersion',
  ],
  'driver-missing': [
    'errSteps.installDriver',
    'errSteps.checkDialectSupported',
    'errSteps.restartApp',
  ],
  'permission-denied': [
    'errSteps.checkOsPermission',
    'errSteps.checkFileOwnership',
    'errSteps.checkSelinux',
  ],
  'database-not-found': [
    'errSteps.checkDatabaseName',
    'errSteps.createDatabase',
    'errSteps.checkCurrentSchema',
  ],
  other: ['errSteps.checkRawMessage', 'errSteps.checkServerLogs', 'errSteps.checkDocs'],
}

/** kind → 标题 i18n key */
const TITLE_KEYS: Record<ConnErrorKind, string> = {
  'port-unreachable': 'errSteps.title.port-unreachable',
  'host-unknown': 'errSteps.title.host-unknown',
  timeout: 'errSteps.title.timeout',
  'auth-failed': 'errSteps.title.auth-failed',
  'ssl-fail': 'errSteps.title.ssl-fail',
  'driver-missing': 'errSteps.title.driver-missing',
  'permission-denied': 'errSteps.title.permission-denied',
  'database-not-found': 'errSteps.title.database-not-found',
  other: 'errSteps.title.other',
}

/**
 * 用正则把原始错误归类到 ConnErrorKind。
 * 顺序敏感：先匹配更具体的（auth/ssl/driver/db-not-found），后匹配通用网络错误，
 * 因为「Access denied for user ...」可能也包含 "denied" 但属于认证而非权限。
 */
export function categorizeConnectionError(msg: string): CategorizedError {
  const m = msg || ''
  let kind: ConnErrorKind
  if (/驱动未实现|驱动未安装|尚未注册|未安装方言|Cannot find module|未安装/i.test(m)) {
    kind = 'driver-missing'
  } else if (
    /access denied|password authentication failed|Login failed|invalid username|invalid password|authentication failed|认证失败/i.test(
      m,
    )
  ) {
    kind = 'auth-failed'
  } else if (/SSL|TLS|self.?signed|certificate|证书/i.test(m)) {
    kind = 'ssl-fail'
  } else if (/unknown database|database .* does not exist|数据库.*不存在/i.test(m)) {
    kind = 'database-not-found'
  } else if (/ECONNREFUSED|ENOTCONN|connection refused|EHOSTUNREACH|ECONNRESET|拒绝连接/i.test(m)) {
    kind = 'port-unreachable'
  } else if (/ENOTFOUND|getaddrinfo|主机名|host not found/i.test(m)) {
    kind = 'host-unknown'
  } else if (/ETIMEDOUT|timeout|超时/i.test(m)) {
    kind = 'timeout'
  } else if (/EACCES|permission denied|权限不足/i.test(m)) {
    kind = 'permission-denied'
  } else {
    kind = 'other'
  }
  return {
    kind,
    title: TITLE_KEYS[kind],
    stepKeys: STEPS[kind],
    raw: m,
  }
}

/**
 * 从底层驱动错误里尽力提取数据库错误码,供「问 AI」弹框带给 AI 用作精准定位。
 *
 * 现实情况:多数错误经过 Electron IPC 后已经被序列化成 `new Error(msg)`,
 * errno/code/number 这些原生字段会丢失,只剩 message。所以这里:
 * 1) 先尝试读对象上的常见字段(MySQL errno / PG SQLSTATE / MSSQL number);
 * 2) 兜底从 message 里 regex 抓 ORA-xxxxx、SQLSTATE 五位码等文本特征。
 *
 * 拿不到就返回 undefined,不强求 —— Workspace 那边会把 errorCode 拼到 error
 * 文本前面,有就更好,没有也不影响主流程。
 */
export function extractDbErrorCode(err: unknown): string | undefined {
  if (err == null) return undefined
  // 1) 对象字段 —— IPC 后大概率丢失,但本地直抛或主进程同一上下文里能拿到
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    // MySQL / MariaDB / TiDB / Doris / OceanBase
    if (typeof e.errno === 'number') return `MySQL ${e.errno}`
    // PostgreSQL / CockroachDB / Kingbase: code 是 SQLSTATE 5 位(数字+字母混合)
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return `PG ${e.code}`
    // SQL Server / Sybase
    if (typeof e.number === 'number') return `MSSQL ${e.number}`
  }
  // 2) message 兜底 —— IPC 序列化后唯一靠谱来源
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : typeof err === 'object'
          ? String((err as { message?: unknown }).message ?? '')
          : String(err)
  // Oracle / DM: ORA-12345
  const ora = msg.match(/\bORA-\d{4,5}\b/)
  if (ora) return ora[0]
  // 文本里直接含 "SQLSTATE: 23505" 之类
  const sqlstate = msg.match(/\bSQLSTATE[:=]?\s*([0-9A-Z]{5})\b/)
  if (sqlstate) return `PG ${sqlstate[1]}`
  // MySQL 文本里常见 "ER_DUP_ENTRY" 或 "Error 1062" / "errno: 1062"
  const mysqlErrno = msg.match(/\b(?:errno|Error)\s*[:=]?\s*(\d{3,5})\b/i)
  if (mysqlErrno) return `MySQL ${mysqlErrno[1]}`
  return undefined
}
