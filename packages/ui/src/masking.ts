/**
 * 数据脱敏（#13）：按列名模式匹配 → 遮罩值。
 *
 * 不动数据库里的数据，只在前端渲染时遮罩；导出时另行决定走原文 / 脱敏。
 *
 * 列名匹配的依据：常见列名（中英文）+ 用户自定义正则。匹配到的规则决定怎么遮罩：
 *  - phone：保留前 3 + 后 4，中间 ****（138****1234）
 *  - email：保留首字符 + @ 之后域名（a***@example.com）
 *  - idCard：保留前 6 + 后 4（110105******1234）
 *  - bankCard：保留前 4 + 后 4
 *  - name：保留姓 + 第二字 *（张*三 → 张**）
 *  - address：保留前 6 字 + ***
 *  - default：> 8 字符时保留前 2 + 后 2，中间 ****
 *
 * 用户可在设置里：
 *   - 关掉整个脱敏（开关）
 *   - 启用预设规则集（默认全开）
 *   - 加自定义规则：`{ name: '订单号', columnPattern: '^order_no$', kind: 'default' }`
 */

export type MaskKind = 'phone' | 'email' | 'idCard' | 'bankCard' | 'name' | 'address' | 'default'

export interface MaskRule {
  /** 规则名（设置里展示用） */
  name: string
  /** 列名正则（i 模式）；命中即应用本规则 */
  columnPattern: string
  /** 用哪种遮罩算法 */
  kind: MaskKind
  /** 是否启用 */
  enabled: boolean
}

/** 内置规则集：覆盖常见敏感字段；用户可在设置里删 / 改 / 加 */
export const DEFAULT_MASK_RULES: MaskRule[] = [
  { name: '手机号', columnPattern: '(phone|mobile|tel|手机|电话)', kind: 'phone', enabled: true },
  { name: '邮箱', columnPattern: '(email|mail|邮箱)', kind: 'email', enabled: true },
  { name: '身份证', columnPattern: '(id_?card|身份证|idno)', kind: 'idCard', enabled: true },
  {
    name: '银行卡',
    columnPattern: '(bank_?card|card_?no|账号|账户)',
    kind: 'bankCard',
    enabled: true,
  },
  {
    name: '姓名',
    columnPattern: '(real_?name|user_?name|full_?name|姓名)',
    kind: 'name',
    enabled: false,
  },
  { name: '地址', columnPattern: '(address|addr|地址)', kind: 'address', enabled: false },
  {
    name: '密码',
    columnPattern: '(password|passwd|secret|pwd|token|api_?key|密码)',
    kind: 'default',
    enabled: true,
  },
]

/** 给定列名 + 一组规则，返回命中的规则；命中多条取第一条 enabled 的 */
export function ruleFor(columnName: string, rules: MaskRule[]): MaskRule | null {
  for (const r of rules) {
    if (!r.enabled) continue
    try {
      if (new RegExp(r.columnPattern, 'i').test(columnName)) return r
    } catch {
      /* 无效正则跳过 */
    }
  }
  return null
}

/** 应用遮罩算法到字符串值；null/非字符串原样返回 */
export function applyMask(value: unknown, kind: MaskKind): unknown {
  if (value == null) return value
  const s = String(value)
  if (!s) return value
  switch (kind) {
    case 'phone': {
      if (s.length < 7) return mask4(s)
      return s.slice(0, 3) + '****' + s.slice(-4)
    }
    case 'email': {
      const at = s.indexOf('@')
      if (at <= 0) return mask4(s)
      const local = s.slice(0, at)
      const domain = s.slice(at)
      return local[0] + '***' + domain
    }
    case 'idCard': {
      if (s.length < 10) return mask4(s)
      return s.slice(0, 6) + '*'.repeat(Math.max(4, s.length - 10)) + s.slice(-4)
    }
    case 'bankCard': {
      if (s.length < 9) return mask4(s)
      return s.slice(0, 4) + ' **** **** ' + s.slice(-4)
    }
    case 'name': {
      if (s.length <= 2) return s[0] + '*'
      return s[0] + '*'.repeat(s.length - 1)
    }
    case 'address': {
      if (s.length <= 6) return s
      return s.slice(0, 6) + '***'
    }
    default:
      return mask4(s)
  }
}

function mask4(s: string): string {
  if (s.length <= 4) return '*'.repeat(s.length)
  if (s.length <= 8) return s[0] + '*'.repeat(s.length - 2) + s.slice(-1)
  return s.slice(0, 2) + '*'.repeat(s.length - 4) + s.slice(-2)
}
