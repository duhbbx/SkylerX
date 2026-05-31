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

/** 该方言 schema 概念说明,null = 不支持。 */
const supportInfo = computed<string | null>(() => {
  switch (props.conn.dialect) {
    case DbDialect.PostgreSQL:
    case DbDialect.KingbaseES:
    case DbDialect.OpenGauss:
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
    // Schema = User; 必须有密码
    const pwd = ownerOrPassword.value.trim() || 'CHANGE_ME_123'
    // Oracle 用户名:
    //  - 合法 unquoted 标识符(只含字母/数字/_/$/#,字母开头)→ 不加引号,Oracle 自动转大写
    //    避免「用双引号导致的小写名,后续 ALTER USER xxx 找不到」之类的坑
    //  - 含特殊字符 / 中文 / 想保留小写 → 用户自己在 SQL 预览里加双引号
    //  - 密码同理:不加引号让 Oracle 按身份验证默认处理(纯文字密码常态)
    const safeIdent = (s: string): string => (/^[A-Za-z][A-Za-z0-9_$#]*$/.test(s) ? s : quoteId(s))
    const u = safeIdent(n)
    const p = safeIdent(pwd)
    // 默认表空间 + QUOTA UNLIMITED 防止 ORA-01950(新用户 USERS 上 quota=0,
    // 一插入就报"insufficient quota on tablespace USERS")。
    out.push(
      `CREATE USER ${u} IDENTIFIED BY ${p} DEFAULT TABLESPACE USERS TEMPORARY TABLESPACE TEMP QUOTA UNLIMITED ON USERS`,
    )
    // 开发场景下"用户=schema"的默认授权:
    //  - CONNECT/RESOURCE:登录 + 基础对象(table/index/sequence)
    //  - UNLIMITED TABLESPACE:任意表空间无配额限制(简化 12c+ 多表空间场景)
    //  - 显式 DDL 权限:Oracle 12c+ RESOURCE 不再含 CREATE VIEW / SEQUENCE 等,补齐开发常用
    //  - 不给 SELECT ANY TABLE / DBA / SYSDBA,保持"只能玩自己 schema"
    //  用户可在 SQL 预览里裁掉不需要的。
    out.push(
      `GRANT CONNECT, RESOURCE, UNLIMITED TABLESPACE,
            CREATE VIEW, CREATE SYNONYM, CREATE SEQUENCE,
            CREATE PROCEDURE, CREATE TRIGGER, CREATE TYPE,
            CREATE MATERIALIZED VIEW, CREATE DATABASE LINK
       TO ${u}`,
    )
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

const ownerLabel = computed(() => (supportInfo.value === 'oracle' ? '密码' : '所有者 (可选)'))
const ownerHint = computed(() =>
  supportInfo.value === 'oracle'
    ? 'Oracle/DM 的 schema = user,需要为用户设置初始密码'
    : '留空则归当前会话用户',
)
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

      <div class="row">
        <label class="lbl">{{ ownerLabel }}</label>
        <input
          v-model="ownerOrPassword"
          class="ip"
          :type="supportInfo === 'oracle' ? 'password' : 'text'"
          :placeholder="supportInfo === 'oracle' ? '初始密码,留空将使用 CHANGE_ME_123' : '用户名,留空 = 当前用户'"
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
