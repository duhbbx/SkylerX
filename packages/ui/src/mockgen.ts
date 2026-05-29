/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 测试数据生成（v2，按字段语义生成 + 用户可配置 + 持久化）。
 *
 * 设计：
 *  - SemanticKind 枚举：列的「语义类型」（人名 / 邮箱 / 手机 / 身份证 / 地址 …）
 *  - detectSemantic(name, sqlType)：按列名 + SQL 类型启发式推断 SemanticKind
 *  - GENERATORS：每个 SemanticKind 一个值生成器（中文人名 / 中国手机号 / 18 位身份证 / …）
 *  - applyRegex(pattern, seed)：内置简易正则生成器（覆盖 [a-z]+ \d{N} (a|b|c) 等常用模式）
 *  - generateCell：把 column 配置 + 行号变成 SQL 字面量
 *  - buildMockInserts：批量行 → 多值 INSERT
 *
 * 调用方：MockDataDialog.vue 在用户点「生成」时调；纯函数好测，无 DOM 依赖。
 */
import type { DbDialect } from '@db-tool/shared-types'
import { quoteId } from './ddl'

// ─── 语义类型 ─────────────────────────────────────────────────────────

/**
 * 字段的「语义类型」。auto = 按 SQL type 兜底（旧版行为）。
 * 中文优先；英文版另起 *_en 后缀避免歧义。
 */
export type SemanticKind =
  | 'auto'
  // 人 & 身份
  | 'name_cn'
  | 'name_en'
  | 'username'
  | 'password'
  | 'gender'
  | 'age'
  | 'id_card_cn'
  | 'passport'
  // 基础布尔 / 英文短词（旧 API 兼容）
  | 'boolean'
  | 'word_en'
  // 联系方式
  | 'email'
  | 'phone_cn'
  | 'phone_us'
  // 地址
  | 'address_cn'
  | 'city_cn'
  | 'province_cn'
  | 'postcode_cn'
  // 公司 / 职位
  | 'company_cn'
  | 'job_cn'
  // 网络 / 标识
  | 'url'
  | 'domain'
  | 'ipv4'
  | 'ipv6'
  | 'mac'
  | 'uuid'
  | 'plate_cn'
  | 'bank_card_cn'
  // 文本
  | 'lorem_cn'
  | 'lorem_en'
  | 'color'
  | 'emoji'
  // 数值 / 时间（用 range 配置）
  | 'integer'
  | 'decimal'
  | 'money'
  | 'date'
  | 'datetime'
  | 'time'
  // 自定义
  | 'enum'
  | 'regex'
  | 'fixed'
  | 'null'

/** 用户可配置的列规则；name / type / pk 由 metadata 给出，不在配置里。 */
export interface SemanticConfig {
  kind: SemanticKind
  /** enum / fixed 时的候选值（enum 随机挑 / fixed 用第一个） */
  values?: string[]
  /** regex 时的模式（内置简易引擎，见 applyRegex 文档） */
  regex?: string
  /** 数值字段：min / max / 小数位数 */
  range?: { min: number; max: number; precision?: number }
  /** NULL 概率（0–1），默认 0；主键自动忽略 */
  nullProb?: number
  /** 用户对该列的备注（保存配置时一起持久化） */
  note?: string
}

export interface MockColumn {
  name: string
  type: string
  pk?: boolean
  /** 列的语义配置（缺省 = auto，按 SQL type 生成） */
  semantic?: SemanticConfig
}

// ─── 字典（迷你嵌入，避免拉外部数据） ────────────────────────────────

// 100 个常见姓 + 80 个常见双字名（组合空间 8000+，对 1k 行足够）
const SURNAME_CN = [
  '王','李','张','刘','陈','杨','黄','赵','吴','周','徐','孙','马','朱','胡','郭','何','高','林','罗',
  '郑','梁','谢','宋','唐','许','韩','冯','邓','曹','彭','曾','肖','田','董','袁','潘','蔡','蒋','余',
  '于','杜','叶','程','魏','苏','吕','丁','任','沈','姚','卢','姜','崔','钟','谭','陆','汪','范','金',
  '石','廖','贾','夏','韦','付','方','白','邹','孟','熊','秦','邱','江','尹','薛','闫','段','雷','侯',
  '龙','史','陶','黎','贺','顾','毛','郝','龚','邵','万','钱','严','覃','武','戴','莫','孔','向','汤',
]
const GIVEN_CN = [
  '伟','芳','娜','秀英','敏','静','丽','强','磊','洋','艳','勇','军','杰','涛','明','超','秀兰','霞','平',
  '刚','桂英','颖','建国','建华','建军','志强','红梅','志明','志华','文君','文涛','文博','文杰','嘉欣','嘉怡','嘉豪','子轩','子涵','子墨',
  '宇航','宇轩','梓涵','雨涵','欣怡','欣然','若曦','思琪','思雨','晓东','晓明','晓敏','晓红','志刚','志勇','志斌','建军','学军','学文','春燕',
  '春梅','春兰','秋萍','秋月','冬梅','夏雨','秀梅','秀英','秀华','秀丽','婷婷','悦悦','可可','贝贝','乐乐','阳阳','妍妍','洋洋','龙龙','虎虎',
]
const FIRST_EN = ['Alice','Bob','Carol','David','Emma','Frank','Grace','Henry','Ivy','Jack','Kate','Leo','Mia','Nick','Olivia','Peter','Quinn','Rachel','Sam','Tina']
const LAST_EN = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee']
const PROVINCE_CN = ['北京','上海','广东','江苏','浙江','山东','河南','四川','湖北','湖南','河北','福建','安徽','陕西','辽宁','江西','重庆','广西','云南','贵州','山西','吉林','黑龙江','天津','新疆','内蒙古','甘肃','海南','宁夏','青海','西藏']
const CITY_CN_BY_PROVINCE: Record<string, string[]> = {
  北京: ['朝阳','海淀','西城','东城','丰台','石景山','通州','大兴','顺义','昌平'],
  上海: ['浦东','黄浦','静安','徐汇','长宁','普陀','虹口','杨浦','闵行','宝山'],
  广东: ['广州','深圳','东莞','佛山','珠海','中山','惠州','汕头','江门','茂名'],
  江苏: ['南京','苏州','无锡','常州','南通','扬州','徐州','盐城','镇江','泰州'],
  浙江: ['杭州','宁波','温州','嘉兴','绍兴','金华','台州','湖州','丽水','衢州'],
  湖北: ['武汉','宜昌','襄阳','黄冈','十堰','荆州','孝感','黄石','咸宁','随州'],
}
const ROADS_CN = ['中山路','人民路','解放路','建设大道','和平大道','光谷大道','珞瑜路','武珞路','洪山路','武胜路','江汉路','华中路','学院路','体育路','友谊路','长江路','长安街','南京东路','淮海中路','陆家嘴路']
const COMPANY_SUFFIX_CN = ['有限公司','科技有限公司','网络科技有限公司','信息技术有限公司','贸易有限公司','工程有限公司','文化传播有限公司','咨询有限公司','投资有限公司','集团有限公司']
const COMPANY_PREFIX_CN = ['斯凯勒','华信','明远','汇通','创联','智联','宏达','飞翔','启明','蓝天','腾飞','晟达','广宇','环球','安信','锐意','新元','德隆','华盛','金辉']
const JOBS_CN = ['软件工程师','前端工程师','后端工程师','测试工程师','运维工程师','数据分析师','产品经理','项目经理','UI 设计师','架构师','技术总监','人事专员','财务主管','销售经理','市场总监','客户经理','行政助理']
const LOREM_CN_WORDS = ['这是','一段','测试','内容','用于','演示','数据','生成','功能','请勿','直接','用于','生产环境','SkylerX','支持','多种','数据库','类型','非常','方便','开发','调试','使用','体验','流畅']
const LOREM_EN_WORDS = ['lorem','ipsum','dolor','sit','amet','consectetur','adipiscing','elit','sed','do','eiusmod','tempor','incididunt','ut','labore','et','dolore','magna','aliqua','enim']
const COLORS = ['#FF5733','#33C1FF','#75FF33','#FFC133','#FF33A8','#33FFD1','#A833FF','#FF8C33','#33FF8C','#B833FF']
const EMOJIS = ['😀','😎','🚀','💯','🎉','🌟','🔥','✨','💡','🎯','📊','🛠','🎨','🌈','⚡']

// ─── 工具 ───────────────────────────────────────────────────────────

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
function randDate(): Date {
  return new Date(Date.now() - Math.floor(Math.random() * 3.15e10)) // 近一年
}
function pad(n: number, w: number): string {
  return String(n).padStart(w, '0')
}
function uuid(): string {
  const c = globalThis.crypto
  return c?.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** 中国大陆 18 位身份证（前 17 位随机，校验位按 GB11643-1999 算）。 */
function idCardCn(): string {
  // 6 位地区码 + 8 位生日 + 3 位顺序 + 1 位校验
  const region = pick(['110101','110102','310101','440101','420100','510100','330100','320100','370100','220100'])
  const year = randInt(1960, 2005)
  const month = randInt(1, 12)
  const day = randInt(1, 28)
  const seq = pad(randInt(0, 999), 3)
  const body = `${region}${year}${pad(month, 2)}${pad(day, 2)}${seq}`
  const W = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]
  const M = '10X98765432'
  let sum = 0
  for (let i = 0; i < 17; i++) sum += (body.charCodeAt(i) - 48) * (W[i] as number)
  return body + M[sum % 11]
}

/** 中国手机号：3 位段号（13/14/15/16/17/18/19）+ 8 位随机数字 */
function phoneCn(): string {
  const seg = pick(['138','139','135','136','158','159','188','187','176','155','156','177','199','166','170','171','178'])
  return seg + String(randInt(0, 99999999)).padStart(8, '0')
}
/** 美式电话 (NNN) NNN-NNNN */
function phoneUs(): string {
  return `(${randInt(200, 999)}) ${randInt(200, 999)}-${pad(randInt(0, 9999), 4)}`
}
/** 银行卡 16 位（Luhn 校验通过） */
function bankCardCn(): string {
  const prefix = pick(['622848','622202','622700','622588','621700','622666'])
  const body = prefix + String(randInt(0, 999999999)).padStart(9, '0')
  // Luhn 校验位
  let sum = 0
  for (let i = body.length - 1; i >= 0; i--) {
    let d = body.charCodeAt(i) - 48
    if ((body.length - i) % 2 === 0) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return body + ((10 - (sum % 10)) % 10)
}
/** 中国邮编 6 位 */
function postcodeCn(): string {
  return pad(randInt(100000, 999999), 6)
}
/** 车牌：省 + 字母 + 5 位字母数字 */
function plateCn(): string {
  const p = pick(['京','沪','粤','苏','浙','鄂','川','鲁','豫','闽'])
  const letter = String.fromCharCode(65 + randInt(0, 25))
  let rest = ''
  for (let i = 0; i < 5; i++) {
    rest += pick('0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'.split(''))
  }
  return `${p}${letter}·${rest}`
}

// 简易正则生成器（覆盖常用模式，复杂模式后续如需要再换 randexp 包）
const REGEX_TOKEN_RE = /\\d|\\w|\\s|\[[^\]]+\]|\([^()]+\)|\{(\d+)(?:,(\d+))?\}|\+|\*|\?|./g

/**
 * 内置简易正则生成器。支持：
 *  - 字符类：[abc] / [a-z] / [A-Z] / [0-9] / [a-zA-Z0-9]
 *  - 转义：\d \w \s（生成 0-9 / [A-Za-z0-9_] / 空格）
 *  - 量词：{n} / {n,m} / + (1–6 次) / * (0–6 次) / ? (0/1 次)
 *  - 交替：(a|bc|d) 任挑一个
 *  - 字面量：任何其他单字符按原样输出
 *
 * 复杂模式（lookahead/anchors/back-references）不支持；用 enum 或自定义生成器代替。
 */
export function applyRegex(pattern: string): string {
  const tokens: string[] = []
  let m: RegExpExecArray | null
  REGEX_TOKEN_RE.lastIndex = 0
  // biome-ignore lint/suspicious/noAssignInExpressions: regex tokenizer
  while ((m = REGEX_TOKEN_RE.exec(pattern)) !== null) tokens.push(m[0])

  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i] as string
    let charset: string[] | null = null
    let literal: string | null = null

    if (tk === '\\d') charset = '0123456789'.split('')
    else if (tk === '\\w') charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'.split('')
    else if (tk === '\\s') charset = [' ']
    else if (tk.startsWith('[') && tk.endsWith(']')) {
      const inner = tk.slice(1, -1)
      const set = new Set<string>()
      for (let j = 0; j < inner.length; j++) {
        if (inner[j + 1] === '-' && j + 2 < inner.length) {
          const start = inner.charCodeAt(j)
          const end = inner.charCodeAt(j + 2)
          for (let c = start; c <= end; c++) set.add(String.fromCharCode(c))
          j += 2
        } else {
          set.add(inner[j] as string)
        }
      }
      charset = [...set]
    } else if (tk.startsWith('(') && tk.endsWith(')')) {
      const choices = tk.slice(1, -1).split('|')
      literal = applyRegex(pick(choices))
    } else {
      literal = tk
    }

    // 看下一个 token 是不是量词
    const next = tokens[i + 1]
    let n = 1
    if (next === '+') { n = randInt(1, 6); i++ }
    else if (next === '*') { n = randInt(0, 6); i++ }
    else if (next === '?') { n = randInt(0, 1); i++ }
    else if (next && /^\{\d+(?:,\d+)?\}$/.test(next)) {
      const qm = /^\{(\d+)(?:,(\d+))?\}$/.exec(next) as RegExpExecArray
      const lo = Number(qm[1])
      const hi = qm[2] ? Number(qm[2]) : lo
      n = randInt(lo, hi)
      i++
    }

    for (let k = 0; k < n; k++) {
      out.push(charset ? (pick(charset) as string) : (literal ?? ''))
    }
  }
  return out.join('')
}

// ─── 生成器：每个 SemanticKind 对应一个 () => string ─────────────────

type Gen = (rowIdx: number, col: MockColumn) => string | number | null

const GENERATORS: Partial<Record<SemanticKind, Gen>> = {
  boolean: () => (Math.random() < 0.5 ? 'TRUE' : 'FALSE'),
  word_en: () => `${pick(WORDS)}_${randInt(0, 999)}`,
  name_cn: () => pick(SURNAME_CN) + pick(GIVEN_CN),
  name_en: () => `${pick(FIRST_EN)} ${pick(LAST_EN)}`,
  username: (i) => `user_${(i + 1).toString().padStart(4, '0')}`,
  password: () => Math.random().toString(36).slice(2, 14),
  gender: () => pick(['M', 'F']),
  age: (_, c) => randInt(c.semantic?.range?.min ?? 18, c.semantic?.range?.max ?? 65),
  id_card_cn: () => idCardCn(),
  passport: () => `P${pad(randInt(0, 99999999), 8)}`,
  email: (i) => `user${i + 1}_${Math.random().toString(36).slice(2, 6)}@example.com`,
  phone_cn: () => phoneCn(),
  phone_us: () => phoneUs(),
  address_cn: () => {
    const prov = pick(PROVINCE_CN)
    const city = CITY_CN_BY_PROVINCE[prov] ? pick(CITY_CN_BY_PROVINCE[prov]) : pick(ROADS_CN)
    return `${prov}省${city}${pick(ROADS_CN)}${randInt(1, 999)}号`
  },
  city_cn: () => {
    const prov = pick(PROVINCE_CN)
    return CITY_CN_BY_PROVINCE[prov] ? pick(CITY_CN_BY_PROVINCE[prov]) : prov
  },
  province_cn: () => pick(PROVINCE_CN),
  postcode_cn: () => postcodeCn(),
  company_cn: () => `${pick(COMPANY_PREFIX_CN)}${pick(['', '智能', '网络', '科技', '数字'])}${pick(COMPANY_SUFFIX_CN)}`,
  job_cn: () => pick(JOBS_CN),
  url: () => `https://example.com/${Math.random().toString(36).slice(2, 8)}`,
  domain: () => `${Math.random().toString(36).slice(2, 8)}.com`,
  ipv4: () => `${randInt(1, 254)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`,
  ipv6: () => Array.from({ length: 8 }, () => randInt(0, 0xffff).toString(16)).join(':'),
  mac: () =>
    Array.from({ length: 6 }, () => randInt(0, 255).toString(16).padStart(2, '0')).join(':'),
  uuid: () => uuid(),
  plate_cn: () => plateCn(),
  bank_card_cn: () => bankCardCn(),
  lorem_cn: () => Array.from({ length: randInt(3, 8) }, () => pick(LOREM_CN_WORDS)).join(''),
  lorem_en: () => Array.from({ length: randInt(3, 10) }, () => pick(LOREM_EN_WORDS)).join(' '),
  color: () => pick(COLORS),
  emoji: () => pick(EMOJIS),
  integer: (_, c) => randInt(c.semantic?.range?.min ?? 0, c.semantic?.range?.max ?? 1000),
  decimal: (_, c) => {
    const r = c.semantic?.range ?? { min: 0, max: 1000, precision: 2 }
    return (Math.random() * (r.max - r.min) + r.min).toFixed(r.precision ?? 2)
  },
  money: (_, c) => {
    const r = c.semantic?.range ?? { min: 0, max: 10000, precision: 2 }
    return (Math.random() * (r.max - r.min) + r.min).toFixed(r.precision ?? 2)
  },
  date: () => randDate().toISOString().slice(0, 10),
  datetime: () => randDate().toISOString().slice(0, 19).replace('T', ' '),
  time: () => `${pad(randInt(0, 23), 2)}:${pad(randInt(0, 59), 2)}:${pad(randInt(0, 59), 2)}`,
  enum: (_, c) => (c.semantic?.values?.length ? (pick(c.semantic.values) as string) : ''),
  fixed: (_, c) => c.semantic?.values?.[0] ?? '',
  regex: (_, c) => (c.semantic?.regex ? applyRegex(c.semantic.regex) : ''),
  null: () => null,
}

// ─── 自动推断 ────────────────────────────────────────────────────────

const NAME_PATTERNS: { re: RegExp; kind: SemanticKind }[] = [
  { re: /(^|_)(id_card|idcard|身份证)/i, kind: 'id_card_cn' },
  { re: /(^|_)(passport|护照)/i, kind: 'passport' },
  { re: /(^|_)(phone|tel|mobile|手机|电话)/i, kind: 'phone_cn' },
  { re: /(^|_)(email|mail|邮箱)/i, kind: 'email' },
  { re: /(^|_)(url|website|link|网址)/i, kind: 'url' },
  { re: /(^|_)(domain|域名)/i, kind: 'domain' },
  { re: /(^|_)(ip|ip_addr|ip_address)$/i, kind: 'ipv4' },
  { re: /(^|_)(mac|mac_addr)$/i, kind: 'mac' },
  { re: /(^|_)(uuid|guid)$/i, kind: 'uuid' },
  { re: /(^|_)(plate|车牌)/i, kind: 'plate_cn' },
  { re: /(^|_)(bank_card|card_no|银行卡|卡号)/i, kind: 'bank_card_cn' },
  { re: /(^|_)(zip|postcode|post_code|邮编)/i, kind: 'postcode_cn' },
  { re: /(^|_)(name|姓名)$/i, kind: 'name_cn' },
  { re: /(^|_)(first_name|last_name|fullname)/i, kind: 'name_en' },
  { re: /(^|_)(username|user_name|account|账号|用户名)/i, kind: 'username' },
  { re: /(^|_)(password|pwd|密码)/i, kind: 'password' },
  { re: /(^|_)(gender|sex|性别)/i, kind: 'gender' },
  { re: /(^|_)(age|年龄)/i, kind: 'age' },
  { re: /(^|_)(company|公司)/i, kind: 'company_cn' },
  { re: /(^|_)(job|position|title|职位)/i, kind: 'job_cn' },
  { re: /(^|_)(address|addr|地址)/i, kind: 'address_cn' },
  { re: /(^|_)(city|城市)/i, kind: 'city_cn' },
  { re: /(^|_)(province|state|省份)/i, kind: 'province_cn' },
  { re: /(^|_)(content|description|desc|remark|note|备注|描述)/i, kind: 'lorem_cn' },
  { re: /(^|_)(color|颜色)/i, kind: 'color' },
  { re: /(^|_)(price|amount|money|cost|fee|金额|价格)/i, kind: 'money' },
]

const TYPE_FALLBACK: { re: RegExp; kind: SemanticKind }[] = [
  { re: /uuid|uniqueidentifier/i, kind: 'uuid' },
  { re: /datetime|timestamp/i, kind: 'datetime' },
  { re: /\bdate\b/i, kind: 'date' },
  { re: /\btime\b/i, kind: 'time' },
  { re: /bool/i, kind: 'boolean' },
  { re: /serial|int(eger)?|bigint|smallint|tinyint/i, kind: 'integer' },
  { re: /decimal|numeric|float|double|real|money/i, kind: 'decimal' },
  // 字符串类兜底用英文短词，跟旧 API 行为一致（兼容现有测试）
  { re: /char|text|string|nvarchar/i, kind: 'word_en' },
]

/** 由列名 + SQL 类型推断 SemanticKind；找不到回 'auto'。 */
export function detectSemantic(name: string, sqlType: string): SemanticKind {
  for (const r of NAME_PATTERNS) if (r.re.test(name)) return r.kind
  for (const r of TYPE_FALLBACK) if (r.re.test(sqlType)) return r.kind
  return 'auto'
}

// ─── 单元 / 整表 ───────────────────────────────────────────────────────

/** 生成单个 cell（已带 SQL 引号 / 字面量转义）。i = 行序号。 */
export function mockValue(typeOrCol: string | MockColumn, i: number, pk = false): string {
  // 旧 API（type 字符串）兼容：直接走 SQL type fallback
  if (typeof typeOrCol === 'string') {
    return mockValueByConfig({ name: '', type: typeOrCol, pk }, i)
  }
  return mockValueByConfig(typeOrCol, i)
}

function mockValueByConfig(col: MockColumn, i: number): string {
  // 主键整数自增
  if (col.pk && /(^|\b)(int|serial|bigint|smallint|number|numeric)/i.test(col.type)) {
    return String(i + 1)
  }
  // NULL 概率
  const np = col.semantic?.nullProb ?? 0
  if (np > 0 && Math.random() < np) return 'NULL'

  const kind = col.semantic?.kind ?? 'auto'
  if (kind === 'null') return 'NULL'
  if (kind !== 'auto' && GENERATORS[kind]) {
    const v = (GENERATORS[kind] as Gen)(i, col)
    if (v === null) return 'NULL'
    return formatLiteral(v, kind)
  }
  // auto：按 SQL type 走 fallback
  const fallback = TYPE_FALLBACK.find((r) => r.re.test(col.type))?.kind ?? 'word_en'
  if (fallback && GENERATORS[fallback]) {
    const v = (GENERATORS[fallback] as Gen)(i, col)
    if (v === null) return 'NULL'
    return formatLiteral(v, fallback)
  }
  // 完全兜底
  return `'${randStr()}'`
}

const WORDS = ['alpha','bravo','delta','echo','kilo','lima','nova','zulu','orion','vega']
function randStr(): string {
  return `${pick(WORDS)}_${randInt(0, 999)}`
}

/** 把生成的值按 kind 转成 SQL 字面量。数字 / 布尔 / NULL 不加引号；其余按字符串包单引号 + 转义。 */
function formatLiteral(v: string | number, kind: SemanticKind): string {
  // 数值 + 布尔 → 不加引号
  if (
    kind === 'integer' ||
    kind === 'age' ||
    kind === 'decimal' ||
    kind === 'money' ||
    kind === 'boolean'
  ) {
    return String(v)
  }
  // 字符串类 → 引号 + 转义
  const s = String(v).replace(/'/g, "''")
  return `'${s}'`
}

/** 给单列生成预览样本（不带 SQL 引号，供 UI 显示「示例：xxx」用） */
export function previewSample(col: MockColumn): string {
  const kind = col.semantic?.kind ?? 'auto'
  if (kind === 'null') return 'NULL'
  if (kind === 'auto') {
    const f = TYPE_FALLBACK.find((r) => r.re.test(col.type))?.kind ?? 'word_en'
    const v = GENERATORS[f]?.(0, col)
    return String(v ?? '')
  }
  const v = GENERATORS[kind]?.(0, col)
  return String(v ?? '')
}

/** 生成 count 行 INSERT（按 chunk 折行避免单条过长）。 */
export function buildMockInserts(
  dialect: DbDialect,
  tableRef: string,
  cols: MockColumn[],
  count: number,
  chunk = 100,
): string {
  const usable = cols.filter((c) => c.name && c.semantic?.kind !== 'null') // null 列直接不插
  if (!usable.length || count < 1) return ''
  const colList = usable.map((c) => quoteId(dialect, c.name)).join(', ')
  const out: string[] = []
  for (let start = 0; start < count; start += chunk) {
    const rows: string[] = []
    for (let i = start; i < Math.min(start + chunk, count); i++) {
      rows.push(`(${usable.map((c) => mockValueByConfig(c, i)).join(', ')})`)
    }
    out.push(`INSERT INTO ${tableRef} (${colList}) VALUES\n  ${rows.join(',\n  ')};`)
  }
  return out.join('\n\n')
}

// ─── 所有 SemanticKind 元数据（供 UI 下拉用） ──────────────────────

export interface SemanticKindMeta {
  kind: SemanticKind
  /** 分组（UI 折叠用） */
  group: '基础' | '人' | '联系' | '地址' | '网络' | '商务' | '文本' | '数值时间' | '自定义'
  /** 简称（i18n key；不在词典里就直接显示） */
  labelKey: string
}

export const SEMANTIC_KINDS: SemanticKindMeta[] = [
  { kind: 'auto', group: '基础', labelKey: '自动（按 SQL 类型）' },
  { kind: 'null', group: '基础', labelKey: 'NULL' },
  { kind: 'boolean', group: '基础', labelKey: '布尔 TRUE/FALSE' },
  { kind: 'word_en', group: '基础', labelKey: '英文短词' },
  { kind: 'name_cn', group: '人', labelKey: '中文姓名' },
  { kind: 'name_en', group: '人', labelKey: '英文姓名' },
  { kind: 'username', group: '人', labelKey: '用户名' },
  { kind: 'password', group: '人', labelKey: '密码（随机）' },
  { kind: 'gender', group: '人', labelKey: '性别 (M/F)' },
  { kind: 'age', group: '人', labelKey: '年龄' },
  { kind: 'id_card_cn', group: '人', labelKey: '身份证号（中国）' },
  { kind: 'passport', group: '人', labelKey: '护照号' },
  { kind: 'email', group: '联系', labelKey: '邮箱' },
  { kind: 'phone_cn', group: '联系', labelKey: '手机号（中国）' },
  { kind: 'phone_us', group: '联系', labelKey: '电话（美式）' },
  { kind: 'address_cn', group: '地址', labelKey: '地址（中国）' },
  { kind: 'city_cn', group: '地址', labelKey: '城市（中国）' },
  { kind: 'province_cn', group: '地址', labelKey: '省份（中国）' },
  { kind: 'postcode_cn', group: '地址', labelKey: '邮编（中国）' },
  { kind: 'url', group: '网络', labelKey: 'URL' },
  { kind: 'domain', group: '网络', labelKey: '域名' },
  { kind: 'ipv4', group: '网络', labelKey: 'IPv4' },
  { kind: 'ipv6', group: '网络', labelKey: 'IPv6' },
  { kind: 'mac', group: '网络', labelKey: 'MAC 地址' },
  { kind: 'uuid', group: '网络', labelKey: 'UUID' },
  { kind: 'plate_cn', group: '商务', labelKey: '车牌号（中国）' },
  { kind: 'bank_card_cn', group: '商务', labelKey: '银行卡号' },
  { kind: 'company_cn', group: '商务', labelKey: '公司名（中国）' },
  { kind: 'job_cn', group: '商务', labelKey: '职位（中国）' },
  { kind: 'lorem_cn', group: '文本', labelKey: '中文段落' },
  { kind: 'lorem_en', group: '文本', labelKey: '英文段落' },
  { kind: 'color', group: '文本', labelKey: '颜色（#HEX）' },
  { kind: 'emoji', group: '文本', labelKey: 'emoji' },
  { kind: 'integer', group: '数值时间', labelKey: '整数（范围）' },
  { kind: 'decimal', group: '数值时间', labelKey: '小数（范围）' },
  { kind: 'money', group: '数值时间', labelKey: '金额（小数）' },
  { kind: 'date', group: '数值时间', labelKey: '日期' },
  { kind: 'datetime', group: '数值时间', labelKey: '日期时间' },
  { kind: 'time', group: '数值时间', labelKey: '时间' },
  { kind: 'enum', group: '自定义', labelKey: '枚举（指定候选）' },
  { kind: 'fixed', group: '自定义', labelKey: '固定值' },
  { kind: 'regex', group: '自定义', labelKey: '正则模板' },
]
