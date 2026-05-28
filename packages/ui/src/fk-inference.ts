/**
 * 外键关系自动推断（D5 基础设施）。
 *
 * 输入一组表的简化 schema（列名 + 大类型 + 是否 PK），按命名约定打分推断可能的 FK：
 *   - `user_id` → `users(id)`
 *   - `parent_id` → 本表 `id`（自引用）
 *   - `created_by` / `updated_by` / `owner_id` → `users(id)`（常用约定）
 *   - `assigned_to_user_id` → `users(id)`（复合命名，取最后一段 `_<x>_id`）
 *
 * 纯函数；不查 information_schema，也不发 SQL。UI 层可拿结果排序展示。
 */

export interface ColumnHint {
  name: string
  /** 简化的类型分类，避免方言差异 */
  type: 'int' | 'bigint' | 'string' | 'uuid' | 'other'
  nullable?: boolean
  /** 该列是否本表 PK */
  primaryKey?: boolean
}

export interface TableHint {
  name: string
  columns: ColumnHint[]
}

export interface InferredFk {
  fromTable: string
  fromCol: string
  toTable: string
  /** 目标列；通常就是 'id' 或目标表的 PK */
  toCol: string
  /** 0-1 的置信度，方便 UI 排序 / 只展示高置信 */
  confidence: number
  /** 推断依据，给用户看 */
  reason: string
}

/** 常用约定列名 → 目标视作 users 表 */
const USERS_CONVENTION_COLS = new Set(['created_by', 'updated_by', 'owner_id'])

/** 简易复数化：person→persons（保守，不做不规则复数），category→categories，box→boxes */
function pluralize(base: string): string {
  if (!base) return base
  const lower = base.toLowerCase()
  if (lower.endsWith('y') && !/[aeiou]y$/.test(lower)) return `${base.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${base}es`
  return `${base}s`
}

/** 把 camelCase 折成 snake_case，方便统一处理 */
function toSnake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

/**
 * 从列名抽取候选 base。
 * 规则：
 *   - `<base>_id` / `<base>_uuid` / `<base>Id` → base = `<base>`
 *   - 复合形如 `assigned_to_user_id` → base = `user`（取最后一个 `_<x>_id` 段）
 * 返回 null 表示该列名不匹配任何后缀模式。
 */
function extractBase(rawName: string): string | null {
  const snake = toSnake(rawName)
  // 复合 _<x>_id：取最后一个非 id 段
  if (snake.endsWith('_id') || snake.endsWith('_uuid')) {
    const suffix = snake.endsWith('_uuid') ? '_uuid' : '_id'
    const head = snake.slice(0, -suffix.length)
    if (!head) return null
    // 取最后一个下划线段（assigned_to_user → user）
    const segs = head.split('_')
    const last = segs[segs.length - 1]
    return last || null
  }
  return null
}

/** 找到一张表的 PK 列（只取第一个，复合 PK 这里不处理） */
function findPk(table: TableHint): ColumnHint | undefined {
  return table.columns.find((c) => c.primaryKey)
}

/** 类型兼容性：相同类别即兼容；'other' 一律视为不兼容 */
function typesCompatible(a: ColumnHint['type'], b: ColumnHint['type']): boolean {
  if (a === 'other' || b === 'other') return false
  return a === b
}

/** 候选目标表：base 原样 + 简易复数 */
function candidateTableNames(base: string): string[] {
  const plural = pluralize(base)
  return plural === base ? [base] : [base, plural]
}

/** 在表集合里按名字查找（大小写不敏感） */
function findTable(tables: TableHint[], name: string): TableHint | undefined {
  const lower = name.toLowerCase()
  return tables.find((t) => t.name.toLowerCase() === lower)
}

interface Candidate {
  toTable: TableHint
  toCol: ColumnHint
  score: number
  reasons: string[]
}

/** 给一个 (源列, 目标表) 组合算分。null 表示目标表没有 PK，跳过。 */
function scoreCandidate(
  fromTable: TableHint,
  fromCol: ColumnHint,
  toTable: TableHint,
  baseScore: number,
  baseReason: string,
  extraBonus = 0,
  extraReason?: string,
): Candidate | null {
  const pk = findPk(toTable)
  // 目标表没 PK 信息时，假定 'id' 列；找不到则跳过
  const toCol = pk ?? toTable.columns.find((c) => c.name.toLowerCase() === 'id')
  if (!toCol) return null

  const reasons: string[] = [baseReason]
  let score = baseScore

  // 规则 2：目标表存在（能进到这里就说明存在）
  score += 0.3
  reasons.push(`目标表 ${toTable.name} 存在`)

  // 规则 3：类型兼容
  if (typesCompatible(fromCol.type, toCol.type)) {
    score += 0.15
    reasons.push(`类型兼容(${fromCol.type})`)
  } else {
    reasons.push(`类型不一致(${fromCol.type}→${toCol.type})`)
  }

  // 规则 4：自引用
  if (toTable.name.toLowerCase() === fromTable.name.toLowerCase()) {
    const snake = toSnake(fromCol.name)
    if (snake.startsWith('parent_') || snake === 'parent_id' || snake === 'parent_uuid') {
      score += 0.05
      reasons.push('自引用(parent_*)')
    }
  }

  if (extraBonus !== 0 && extraReason) {
    score += extraBonus
    reasons.push(extraReason)
  }

  return { toTable, toCol, score, reasons }
}

export function inferForeignKeys(tables: TableHint[]): InferredFk[] {
  const out: InferredFk[] = []

  for (const table of tables) {
    for (const col of table.columns) {
      // 规则 0：PK 列不作为 FK 源
      if (col.primaryKey) continue

      const candidates: Candidate[] = []
      const base = extractBase(col.name)
      const snakeName = toSnake(col.name)

      // 规则 1 + 自引用判定
      if (base) {
        const baseReason = `列名后缀匹配(base=${base})`
        const names = candidateTableNames(base)
        // 1a：尝试外部表
        for (const n of names) {
          const tgt = findTable(tables, n)
          if (tgt) {
            const c = scoreCandidate(table, col, tgt, 0.5, baseReason)
            if (c) candidates.push(c)
          }
        }
        // 1b：自引用（base 解析失败时，例如 parent_id → base=parent 没这张表）
        const selfSnake = snakeName
        if (
          (selfSnake.startsWith('parent_') || selfSnake === 'parent_id') &&
          !candidates.some((c) => c.toTable.name.toLowerCase() === table.name.toLowerCase())
        ) {
          const c = scoreCandidate(table, col, table, 0.5, baseReason)
          if (c) candidates.push(c)
        }
      }

      // 规则 5：常用约定 → users
      if (USERS_CONVENTION_COLS.has(snakeName)) {
        const users = findTable(tables, 'users') ?? findTable(tables, 'user')
        if (users) {
          // 避免和规则 1 产生的同表候选重复（owner_id 会两条都触发）
          const already = candidates.find(
            (c) => c.toTable.name.toLowerCase() === users.name.toLowerCase(),
          )
          if (already) {
            already.score += 0.1
            already.reasons.push(`常用约定(${snakeName}→users)`)
          } else {
            const c = scoreCandidate(
              table,
              col,
              users,
              0.5,
              `常用约定列名 ${snakeName}`,
              0.1,
              `常用约定(${snakeName}→users)`,
            )
            if (c) candidates.push(c)
          }
        }
      }

      // 选每个 fromCol 下的最高分候选（同一列推多个目标会让 UI 噪音过大）
      if (candidates.length === 0) continue
      candidates.sort((a, b) => b.score - a.score)
      const best = candidates[0]
      const confidence = Math.min(1, best.score)
      if (confidence < 0.3) continue

      out.push({
        fromTable: table.name,
        fromCol: col.name,
        toTable: best.toTable.name,
        toCol: best.toCol.name,
        confidence: Number(confidence.toFixed(4)),
        reason: best.reasons.join('; '),
      })
    }
  }

  out.sort((a, b) => b.confidence - a.confidence)
  return out
}
