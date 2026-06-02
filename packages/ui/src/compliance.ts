/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 等保 2.0 三级——数据库层合规检查规则集。
 *
 * 只覆盖能从数据库连接直接验证的项目（密码策略、远程登录、SSL、审计日志、超级用户数…），
 * 不包括需要操作系统/网络层取证的部分（如防火墙、堡垒机、磁盘加密）。
 *
 * 设计原则：
 *  - 每条规则是「一段 SELECT/SHOW + 一段判定逻辑」，独立可执行；
 *  - 规则永远不抛错——外部 catch 统一兜底为 `unknown`，方便批量并行执行；
 *  - 只读，不改库；
 *  - 当前仅 MySQL 系（含 MariaDB / OceanBase）与 PostgreSQL 系（含 KingbaseES / OpenGauss）有具体规则，
 *    其它方言走占位条目，提示用户走人工审查。
 */
import { type ConnectionConfig, DbDialect } from '@db-tool/shared-types'

/**
 * 检查结果严重程度。
 *  - pass    合规
 *  - warn    不合规但风险可控（如审计未启、SSL 关闭）
 *  - fail    严重违规（如 root 远程开放、空密码用户）
 *  - unknown 无法判断（如商业版才有的特性、查询失败、权限不足）
 */
export type Severity = 'pass' | 'warn' | 'fail' | 'unknown'

/** 检查项执行结果。 */
export interface ComplianceResult {
  severity: Severity
  /** 简短一句话结论（给运维看的） */
  message?: string
  /** 原始证据：变量值 / 关键行；导出报告时附在结论后 */
  evidence?: string
}

/** SQL 执行器签名（注入 client.connections.execute 的薄包装）。 */
export type SqlExec = (sql: string) => Promise<Array<Record<string, unknown>>>

/** 单条合规检查项。 */
export interface ComplianceCheck {
  /** 全局唯一稳定 ID，例如 `mysql.auth.root-remote`。 */
  id: string
  /** 等保大类：「身份鉴别」「访问控制」「安全审计」「入侵防范」「数据完整性」 */
  category: string
  /** 中文标题 */
  title: string
  /** 一段说明：为什么这条要查、查的是什么 */
  description: string
  /** 实际跑检查的函数；接收连接配置 + SQL 执行器。返回 ComplianceResult。 */
  run: (conn: ConnectionConfig, exec: SqlExec) => Promise<ComplianceResult>
}

// ── 通用小工具 ─────────────────────────────────────────────────────

/** SHOW VARIABLES 结果常见两列：Variable_name + Value（mysql 全大写也兼容） */
function pickVar(rows: Array<Record<string, unknown>>, name: string): string | undefined {
  for (const r of rows) {
    const key = String(r.Variable_name ?? r.variable_name ?? '').toLowerCase()
    if (key === name.toLowerCase()) return String(r.Value ?? r.value ?? '')
  }
  return undefined
}

/** PG `SHOW xxx` 单行单列结果取值。 */
function pickPgSetting(rows: Array<Record<string, unknown>>): string {
  const r = rows[0]
  if (!r) return ''
  const v = Object.values(r)[0]
  return v == null ? '' : String(v)
}

// ── MySQL 系规则 ───────────────────────────────────────────────────

const MYSQL_CHECKS: ComplianceCheck[] = [
  {
    id: 'mysql.auth.password-policy',
    category: '身份鉴别',
    title: '强制使用强密码策略',
    description: '检查 validate_password 插件是否启用，且 policy ≥ MEDIUM、长度 ≥ 8。',
    run: async (_c, exec) => {
      const rows = await exec("SHOW VARIABLES LIKE 'validate_password%'")
      if (!rows.length) {
        return {
          severity: 'warn',
          message: 'validate_password 插件未安装，密码强度不受 DB 层约束',
        }
      }
      const policy = (
        pickVar(rows, 'validate_password.policy') ??
        pickVar(rows, 'validate_password_policy') ??
        ''
      ).toUpperCase()
      const length = Number(
        pickVar(rows, 'validate_password.length') ?? pickVar(rows, 'validate_password_length') ?? 0,
      )
      const polOk = policy === 'MEDIUM' || policy === 'STRONG'
      const lenOk = length >= 8
      if (polOk && lenOk) {
        return {
          severity: 'pass',
          message: `policy=${policy}, length=${length}`,
          evidence: `policy=${policy} length=${length}`,
        }
      }
      return {
        severity: 'warn',
        message: `policy=${policy || '?'} length=${length || '?'}（等保三级建议 MEDIUM 且 ≥ 8）`,
        evidence: `policy=${policy} length=${length}`,
      }
    },
  },
  {
    id: 'mysql.audit.enabled',
    category: '安全审计',
    title: '审计日志已启用',
    description: '检查 audit_log 系列变量（企业版/percona/MariaDB server_audit 插件）',
    run: async (_c, exec) => {
      const rows = await exec("SHOW VARIABLES LIKE 'audit_log_%'")
      if (rows.length === 0) {
        // 试 MariaDB server_audit
        const mar = await exec("SHOW VARIABLES LIKE 'server_audit%'").catch(() => [])
        if (mar.length === 0) {
          return {
            severity: 'unknown',
            message: '未发现审计插件（企业版/插件特性，请人工确认是否已部署外部审计）',
          }
        }
        const logging = pickVar(mar, 'server_audit_logging')
        return logging?.toUpperCase() === 'ON'
          ? {
              severity: 'pass',
              message: 'MariaDB server_audit 已开启',
              evidence: `logging=${logging}`,
            }
          : { severity: 'warn', message: 'MariaDB server_audit 已安装但未启用' }
      }
      const policy = pickVar(rows, 'audit_log_policy')
      const file = pickVar(rows, 'audit_log_file')
      return {
        severity: policy && policy.toUpperCase() !== 'NONE' ? 'pass' : 'warn',
        message: `audit_log_policy=${policy ?? '?'}`,
        evidence: `policy=${policy} file=${file}`,
      }
    },
  },
  {
    id: 'mysql.auth.root-remote',
    category: '访问控制',
    title: 'root 不允许远程登录',
    description: '检查 mysql.user 中 root 的 host：% 或非 localhost 视为开放远程。',
    run: async (_c, exec) => {
      const rows = await exec("SELECT user, host FROM mysql.user WHERE user='root'")
      const remote = rows.filter((r) => {
        const h = String(r.host ?? r.Host ?? '').toLowerCase()
        return h === '%' || (h !== 'localhost' && h !== '127.0.0.1' && h !== '::1' && h !== '')
      })
      if (remote.length === 0) {
        return { severity: 'pass', message: 'root 仅限本机登录' }
      }
      return {
        severity: 'fail',
        message: `root 可远程登录：${remote.map((r) => `host=${r.host ?? r.Host}`).join(', ')}`,
        evidence: JSON.stringify(remote),
      }
    },
  },
  {
    id: 'mysql.auth.anonymous',
    category: '访问控制',
    title: '不存在匿名用户',
    description: 'mysql.user 中 user="" 的条目应清理。',
    run: async (_c, exec) => {
      const rows = await exec("SELECT user, host FROM mysql.user WHERE user=''")
      if (rows.length === 0) return { severity: 'pass', message: '无匿名用户' }
      return {
        severity: 'fail',
        message: `存在 ${rows.length} 条匿名用户`,
        evidence: JSON.stringify(rows),
      }
    },
  },
  {
    id: 'mysql.transport.ssl',
    category: '数据完整性',
    title: '强制 SSL 传输',
    description: 'require_secure_transport=ON 时客户端必须经 SSL 连接。',
    run: async (_c, exec) => {
      const rows = await exec("SHOW VARIABLES LIKE 'require_secure_transport'")
      const v = pickVar(rows, 'require_secure_transport')
      if (v?.toUpperCase() === 'ON') return { severity: 'pass', message: '已强制 SSL' }
      return {
        severity: 'warn',
        message: 'require_secure_transport=OFF，客户端可走明文',
        evidence: `value=${v}`,
      }
    },
  },
  {
    id: 'mysql.audit.slowlog',
    category: '安全审计',
    title: '慢查询日志开启',
    description: '辅助审计与性能追踪。',
    run: async (_c, exec) => {
      const rows = await exec("SHOW VARIABLES LIKE 'slow_query_log'")
      const v = pickVar(rows, 'slow_query_log')
      return v?.toUpperCase() === 'ON'
        ? { severity: 'pass', message: '慢查询日志已启用' }
        : {
            severity: 'warn',
            message: 'slow_query_log=OFF（建议开启用于审计辅助）',
            evidence: `value=${v}`,
          }
    },
  },
  {
    id: 'mysql.integrity.binlog',
    category: '数据完整性',
    title: 'binlog 已启用',
    description: 'log_bin=ON 是数据可恢复与主从同步的前提。',
    run: async (_c, exec) => {
      const rows = await exec("SHOW VARIABLES LIKE 'log_bin'")
      const v = pickVar(rows, 'log_bin')
      return v?.toUpperCase() === 'ON'
        ? { severity: 'pass', message: 'binlog 已启用' }
        : {
            severity: 'warn',
            message: 'log_bin=OFF（无法做时间点恢复 / 主从复制）',
            evidence: `value=${v}`,
          }
    },
  },
]

// ── PostgreSQL 系规则 ──────────────────────────────────────────────

const PG_CHECKS: ComplianceCheck[] = [
  {
    id: 'pg.auth.password-encryption',
    category: '身份鉴别',
    title: '密码加密算法使用 SCRAM-SHA-256',
    description: 'password_encryption=md5 已被国密/等保视为弱算法。',
    run: async (_c, exec) => {
      const rows = await exec('SHOW password_encryption')
      const v = pickPgSetting(rows).toLowerCase()
      if (v === 'scram-sha-256') return { severity: 'pass', message: 'scram-sha-256' }
      return {
        severity: 'warn',
        message: `password_encryption=${v}（建议 scram-sha-256）`,
        evidence: `value=${v}`,
      }
    },
  },
  {
    id: 'pg.audit.pgaudit',
    category: '安全审计',
    title: '已安装 pgaudit 审计扩展',
    description: '通过 pg_extension 视图确认 pgaudit 是否已 CREATE EXTENSION。',
    run: async (_c, exec) => {
      const rows = await exec("SELECT extname FROM pg_extension WHERE extname='pgaudit'")
      if (rows.length > 0) return { severity: 'pass', message: 'pgaudit 已安装' }
      return {
        severity: 'warn',
        message: 'pgaudit 未安装；纯 log_statement 不满足等保三级审计粒度',
      }
    },
  },
  {
    id: 'pg.transport.ssl',
    category: '数据完整性',
    title: 'SSL 已启用',
    description: 'ssl=on 时 server 才会接受 TLS 连接（配合 pg_hba 强制）。',
    run: async (_c, exec) => {
      const rows = await exec('SHOW ssl')
      const v = pickPgSetting(rows).toLowerCase()
      return v === 'on'
        ? { severity: 'pass', message: 'ssl=on' }
        : { severity: 'warn', message: `ssl=${v}`, evidence: `value=${v}` }
    },
  },
  {
    id: 'pg.access.superuser-count',
    category: '访问控制',
    title: '超级用户数量受控（≤ 2）',
    description: '超级用户越多审计追责越难；建议 1 个内置 + 1 个备用。',
    run: async (_c, exec) => {
      const rows = await exec('SELECT rolname FROM pg_roles WHERE rolsuper')
      const names = rows.map((r) => String(r.rolname ?? r.ROLNAME ?? ''))
      if (names.length <= 2) {
        return { severity: 'pass', message: `${names.length} 个：${names.join(', ')}` }
      }
      return {
        severity: 'warn',
        message: `${names.length} 个超级用户：${names.join(', ')}`,
        evidence: names.join(','),
      }
    },
  },
  {
    id: 'pg.audit.log-statement',
    category: '安全审计',
    title: 'log_statement 已配置',
    description: '记录至少 ddl / mod 级语句，等保要求"覆盖所有重要操作"。',
    run: async (_c, exec) => {
      const rows = await exec('SHOW log_statement')
      const v = pickPgSetting(rows).toLowerCase()
      if (v === 'none' || v === '') {
        return { severity: 'warn', message: 'log_statement=none，未记录任何语句' }
      }
      return { severity: 'pass', message: `log_statement=${v}`, evidence: `value=${v}` }
    },
  },
  {
    id: 'pg.auth.empty-password',
    category: '身份鉴别',
    title: '不存在空密码的可登录用户',
    description: 'pg_authid.rolpassword IS NULL 且 rolcanlogin = true 即空口令风险。',
    run: async (_c, exec) => {
      // pg_authid 一般需要超级用户权限；若读不到则视为 unknown
      const rows = await exec(
        'SELECT rolname FROM pg_authid WHERE rolpassword IS NULL AND rolcanlogin',
      ).catch((e) => {
        throw new Error(
          `无法访问 pg_authid（需超级用户权限）：${e instanceof Error ? e.message : String(e)}`,
        )
      })
      if (rows.length === 0) return { severity: 'pass', message: '无空密码登录用户' }
      const names = rows.map((r) => String(r.rolname ?? r.ROLNAME ?? '')).join(', ')
      return {
        severity: 'fail',
        message: `存在 ${rows.length} 个空密码用户：${names}`,
        evidence: names,
      }
    },
  },
]

// ── 不支持方言占位 ──────────────────────────────────────────────────

const UNSUPPORTED: ComplianceCheck = {
  id: 'unsupported',
  category: '-',
  title: '当前方言暂未提供合规检查',
  description: '该方言尚未实现等保检查规则；请按运维手册做人工审查。',
  run: async () => ({ severity: 'unknown', message: '请人工确认' }),
}

/** 把方言归到 MySQL 系 / PG 系 / 其它三类。 */
function fam(d: DbDialect): 'mysql' | 'pg' | 'other' {
  if (
    d === DbDialect.MySQL ||
    d === DbDialect.MariaDB ||
    d === DbDialect.OceanBase ||
    d === DbDialect.TiDB
  )
    return 'mysql'
  if (
    d === DbDialect.PostgreSQL ||
    d === DbDialect.KingbaseES ||
    d === DbDialect.OpenGauss ||
    d === DbDialect.Vastbase ||
    d === DbDialect.Greenplum ||
    d === DbDialect.CockroachDB
  )
    return 'pg'
  return 'other'
}

/** 根据方言返回适用的检查项列表。 */
export function checksFor(dialect: DbDialect): ComplianceCheck[] {
  switch (fam(dialect)) {
    case 'mysql':
      return MYSQL_CHECKS
    case 'pg':
      return PG_CHECKS
    default:
      return [UNSUPPORTED]
  }
}

// ── 报告导出 ────────────────────────────────────────────────────────

/** Severity 到中文 + emoji 的展示串（导出报告 / UI 渲染共用） */
export const SEVERITY_LABEL: Record<Severity, string> = {
  pass: '✅ 通过',
  warn: '⚠️ 告警',
  fail: '❌ 不合规',
  unknown: '— 未知',
}

/**
 * 把一次检查的全部结果渲染成 Markdown 报告（适合归档 / 下发给客户）。
 */
export function renderReport(
  conn: ConnectionConfig,
  checks: ComplianceCheck[],
  results: Map<string, ComplianceResult>,
): string {
  const ts = new Date().toISOString()
  const lines: string[] = []
  lines.push('# 等保合规检查报告')
  lines.push('')
  lines.push(`- 连接：**${conn.name}** (${conn.dialect})`)
  lines.push(`- 主机：${conn.host}:${conn.port}`)
  lines.push(`- 生成时间：${ts}`)
  lines.push('')
  // 按 category 分组
  const byCat = new Map<string, ComplianceCheck[]>()
  for (const c of checks) {
    const list = byCat.get(c.category) ?? []
    list.push(c)
    byCat.set(c.category, list)
  }
  // 汇总
  let pass = 0
  let warn = 0
  let fail = 0
  let unknown = 0
  for (const c of checks) {
    const r = results.get(c.id)
    if (!r) {
      unknown++
      continue
    }
    if (r.severity === 'pass') pass++
    else if (r.severity === 'warn') warn++
    else if (r.severity === 'fail') fail++
    else unknown++
  }
  lines.push(`**汇总：** ✅ ${pass} · ⚠️ ${warn} · ❌ ${fail} · — ${unknown}`)
  lines.push('')
  for (const [cat, items] of byCat) {
    lines.push(`## ${cat}`)
    lines.push('')
    for (const c of items) {
      const r = results.get(c.id)
      const lbl = r ? SEVERITY_LABEL[r.severity] : SEVERITY_LABEL.unknown
      lines.push(`### ${lbl} ${c.title}`)
      lines.push('')
      lines.push(`> ${c.description}`)
      lines.push('')
      if (r?.message) lines.push(`- 结论：${r.message}`)
      if (r?.evidence) lines.push(`- 证据：\`${r.evidence}\``)
      lines.push('')
    }
  }
  return lines.join('\n')
}
