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
