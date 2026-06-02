<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 新建 Schema 弹窗。
 *
 * Schema 概念按方言:
 * - pg 系(PG/Kingbase/openGauss/Greenplum/CockroachDB/Redshift): CREATE SCHEMA "n"
 * - SQL Server: CREATE SCHEMA [n]
 * - Snowflake: CREATE SCHEMA "n"
 * - Oracle/DM: schema = user,CREATE USER n IDENTIFIED BY ... (需要 password,给个简版)
 * - MySQL 系 / SQLite / DuckDB / ClickHouse / TDengine: 没有 Schema 概念,不显示
 * - NoSQL: 不显示
 */
import { type ConnectionConfig, DbDialect } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import { reportError } from '../errorReporter'
import Modal from './Modal.vue'
import SqlEditor from './SqlEditor.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
  /** 父库 — PG 系 Schema 属于库,先 USE database 再执行 CREATE SCHEMA */
  database?: string
}>()

const emit = defineEmits<{
  close: []
  created: [name: string]
}>()

const client = useDataClient()

const name = ref('')
const ownerOrPassword = ref('')
const comment = ref('')
const submitting = ref(false)
/**
 * Oracle/DM 模式: 是否要 "顺便创建独立用户" (用户报告:不一定每个 schema 都要建新用户,
 * 我可能就是想在当前用户下加一个 schema 容器). 默认 false — 只发一句 CREATE SCHEMA,
 * 让 DB 默认行为接管(DM 下当前用户的子 schema; Oracle 下则会失败要求 AUTHORIZATION).
 * 勾上 = 完整 CREATE USER + GRANT (但不再硬编码 USERS 表空间).
 */
const createDedicatedUser = ref(false)

/** 该方言 schema 概念说明,null = 不支持。 */
const supportInfo = computed<string | null>(() => {
  switch (props.conn.dialect) {
    case DbDialect.PostgreSQL:
    case DbDialect.KingbaseES:
    case DbDialect.OpenGauss:
    case DbDialect.Vastbase:
    case DbDialect.MogDB:
    case DbDialect.HighGo:
    case DbDialect.Greenplum:
    case DbDialect.CockroachDB:
    case DbDialect.Redshift:
      return 'pg'
    case DbDialect.SqlServer:
      return 'sqlserver'
    case DbDialect.Snowflake:
      return 'snowflake'
    case DbDialect.Oracle:
    case DbDialect.DM:
      return 'oracle' // Schema = User
    default:
      return null
  }
})

function quoteId(n: string): string {
  switch (props.conn.dialect) {
    case DbDialect.SqlServer:
      return `[${n.replace(/]/g, ']]')}]`
    default:
      return `"${n.replace(/"/g, '""')}"`
  }
}

function quoteStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

const sqlStatements = computed<string[]>(() => {
  const n = name.value.trim()
  if (!n) return []
  const out: string[] = []
  const info = supportInfo.value
  if (info === 'pg') {
    let sql = `CREATE SCHEMA ${quoteId(n)}`
    if (ownerOrPassword.value.trim())
      sql += ` AUTHORIZATION ${quoteId(ownerOrPassword.value.trim())}`
    out.push(sql)
    if (comment.value.trim())
      out.push(`COMMENT ON SCHEMA ${quoteId(n)} IS ${quoteStr(comment.value.trim())}`)
  } else if (info === 'sqlserver') {
    let sql = `CREATE SCHEMA ${quoteId(n)}`
    if (ownerOrPassword.value.trim())
      sql += ` AUTHORIZATION ${quoteId(ownerOrPassword.value.trim())}`
    out.push(sql)
  } else if (info === 'snowflake') {
    let sql = `CREATE SCHEMA ${quoteId(n)}`
    if (comment.value.trim()) sql += ` COMMENT = ${quoteStr(comment.value.trim())}`
    out.push(sql)
  } else if (info === 'oracle') {
    // Oracle/DM 路径有两种语义,看 createDedicatedUser:
    //  - false (默认): 只发 CREATE SCHEMA. DM 接受这个并把 schema 挂在当前连接用户下;
    //    Oracle 则需要 AUTHORIZATION existing_user, 此时把 ownerOrPassword 当作"已存在
    //    的用户名"传入. 不创建新用户, 不碰表空间.
    //  - true: 完整路径 — 建新用户 + GRANT 开发常用权限. 不再硬编码
    //    DEFAULT TABLESPACE USERS / TEMPORARY TABLESPACE TEMP — DM 默认表空间是 MAIN/TEMP,
    //    很多 Oracle 部署也没有名叫 USERS 的表空间, 强写会触发 "表空间 USERS 不存在".
    //    交给 DB 默认 (Oracle: DEFAULT TABLESPACE 由 DBA 配; DM: MAIN). 用户需要自定义可在
    //    SQL 预览里手工加, 而不是被默认值卡住.
    const safeIdent = (s: string): string => (/^[A-Za-z][A-Za-z0-9_$#]*$/.test(s) ? s : quoteId(s))
    const u = safeIdent(n)
    if (!createDedicatedUser.value) {
      let sql = `CREATE SCHEMA ${u}`
      const auth = ownerOrPassword.value.trim()
      if (auth) sql += ` AUTHORIZATION ${safeIdent(auth)}`
      out.push(sql)
    } else {
      const pwd = ownerOrPassword.value.trim() || 'CHANGE_ME_123'
      const p = safeIdent(pwd)
      out.push(`CREATE USER ${u} IDENTIFIED BY ${p}`)
      out.push(
        `GRANT CONNECT, RESOURCE, UNLIMITED TABLESPACE,
              CREATE VIEW, CREATE SYNONYM, CREATE SEQUENCE,
              CREATE PROCEDURE, CREATE TRIGGER, CREATE TYPE,
              CREATE MATERIALIZED VIEW, CREATE DATABASE LINK
         TO ${u}`,
      )
    }
  }
  return out
})

const sqlText = ref('')
watch(sqlStatements, (sts) => {
  sqlText.value = sts.map((s) => `${s};`).join('\n\n')
})

const canSubmit = computed(() => !!name.value.trim() && !!supportInfo.value && !submitting.value)

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const stmts = sqlText.value
      .split(/;\s*\n/)
      .map((s) => s.trim().replace(/;$/, ''))
      .filter(Boolean)
    for (const s of stmts) {
      // PG 系 schema 创建在父库下,execute 时带 database 上下文
      const ctx = props.database ? { database: props.database } : {}
      await client.connections.execute(props.conn.id, s, [], ctx)
    }
    toast.success(`已创建 schema: ${name.value.trim()}`)
    emit('created', name.value.trim())
    emit('close')
  } catch (e) {
    // TODO(v2): restore askAi: { sql, error, connId, connName, dialect } context once reportError
    // supports passing structured AI-debug payloads beyond the error object. Refs #13
    reportError(e, { tag: 'new-schema' })
  } finally {
    submitting.value = false
  }
}

watch(
  () => props.open,
  (op) => {
    if (op) {
      name.value = ''
      ownerOrPassword.value = ''
      comment.value = ''
      sqlText.value = ''
    }
  },
)

const ownerLabel = computed(() => {
  if (supportInfo.value !== 'oracle') return '所有者 (可选)'
  return createDedicatedUser.value ? '初始密码' : '已有用户名 (可选)'
})
const ownerHint = computed(() => {
  if (supportInfo.value !== 'oracle') return '留空则归当前会话用户'
  return createDedicatedUser.value
    ? 'Oracle/DM 把这个用户的 schema 创建出来,密码用于后续 OB 登录该 schema'
    : '不创建新用户。留空 = 在当前连接用户下建 schema (DM 支持);填入已有用户名 = AUTHORIZATION 给那个用户 (Oracle 需要)'
})
</script>

<template>
  <Modal v-if="open" :title="`新建 Schema  ·  ${database ?? conn.name}`" width="medium" @close="emit('close')">
    <div v-if="!supportInfo" class="unsupported">
      <div class="us-title">⚠ 该方言无 Schema 概念</div>
      <div class="us-body">{{ conn.dialect }} 不支持独立的 Schema 命名空间。</div>
    </div>

    <div v-else class="form">
      <div class="row">
        <label class="lbl">名称 *</label>
        <input v-model="name" class="ip" placeholder="例如 public / app_v2" autofocus />
      </div>

      <!-- Oracle/DM 专属: 是否顺便建独立用户. 关闭(默认) = 只建 schema 容器,
           开启 = 完整 CREATE USER + GRANT 套餐 -->
      <div v-if="supportInfo === 'oracle'" class="row check-row">
        <label class="check-lbl">
          <input v-model="createDedicatedUser" type="checkbox" />
          <span>顺便创建独立用户 (CREATE USER + GRANT)</span>
        </label>
        <div class="meta">不勾 = 只发一句 CREATE SCHEMA, 不动用户系统 / 表空间</div>
      </div>

      <div class="row">
        <label class="lbl">{{ ownerLabel }}</label>
        <input
          v-model="ownerOrPassword"
          class="ip"
          :type="supportInfo === 'oracle' && createDedicatedUser ? 'password' : 'text'"
          :placeholder="supportInfo === 'oracle'
            ? (createDedicatedUser ? '初始密码,留空将使用 CHANGE_ME_123' : '已有用户名,留空 = 当前用户')
            : '用户名,留空 = 当前用户'"
        />
        <div class="meta">{{ ownerHint }}</div>
      </div>

      <div v-if="supportInfo === 'pg' || supportInfo === 'snowflake'" class="row">
        <label class="lbl">注释</label>
        <input v-model="comment" class="ip" placeholder="可选" />
      </div>

      <div class="row">
        <label class="lbl">SQL 预览 (可编辑)</label>
        <div class="sql-wrap">
          <SqlEditor v-model="sqlText" />
        </div>
      </div>
    </div>

    <template #footer>
      <button class="btn-ghost" :disabled="submitting" @click="emit('close')">取消</button>
      <button v-if="supportInfo" class="btn-primary" :disabled="!canSubmit" @click="submit">
        {{ submitting ? '创建中…' : '执行' }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lbl {
  font-size: 12px;
  color: var(--muted);
  font-weight: 600;
}
.ip,
.ta {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  padding: 6px 10px;
  font-size: 13px;
  font-family: var(--font-mono);
}
.ta.sql {
  resize: vertical;
  min-height: 100px;
  white-space: pre;
}
.sql-wrap {
  height: 180px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.meta {
  font-size: 11px;
  color: var(--muted);
}
.check-row .check-lbl {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;
  color: var(--text);
}
.unsupported {
  padding: 16px;
  background: rgba(224, 64, 80, 0.06);
  border: 1px solid rgba(224, 64, 80, 0.3);
  border-radius: 6px;
}
.us-title {
  color: #e04050;
  font-weight: 600;
  margin-bottom: 6px;
}
.us-body {
  font-size: 12px;
  color: var(--text);
}
.btn-ghost,
.btn-primary {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--border);
}
.btn-ghost {
  background: transparent;
  color: var(--muted);
}
.btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
