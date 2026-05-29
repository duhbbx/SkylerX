<script setup lang="ts">
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * 新建数据库弹窗。按方言生成 CREATE DATABASE SQL,允许用户预览/编辑后执行。
 *
 * 各方言差异:
 * - mysql 系(MySQL/MariaDB/OceanBase/TiDB/Doris/StarRocks):
 *     CREATE DATABASE `n` [DEFAULT CHARACTER SET ...] [DEFAULT COLLATE ...]
 *     COMMENT 不在 CREATE DB 里(MySQL),Doris/StarRocks 也按通用语法
 * - pg 系(PostgreSQL/Kingbase/openGauss/Greenplum/CockroachDB/Redshift):
 *     CREATE DATABASE "n" [ENCODING '...']
 *     COMMENT ON DATABASE "n" IS '...' (独立一条)
 * - SQL Server / ClickHouse / Snowflake / TDengine: 各有自己写法
 * - Oracle/DM: 创建"数据库"语义不同(实例级),提示用户走 DBA 工具
 * - SQLite/DuckDB/H2: 文件型,不支持
 */
import { type ConnectionConfig, DbDialect } from '@db-tool/shared-types'
import { computed, ref, watch } from 'vue'
import { useDataClient } from '../data-client'
import { toast } from '../dialog'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  conn: ConnectionConfig
}>()

const emit = defineEmits<{
  close: []
  /** 创建成功:外层据此刷新连接节点 */
  created: [name: string]
}>()

const client = useDataClient()

const name = ref('')
const charset = ref('')
const collation = ref('')
const comment = ref('')
const showAdvanced = ref(false)
const submitting = ref(false)

/** 该方言是否完全不支持(文件型或实例级)。 */
const unsupportedReason = computed<string | null>(() => {
  switch (props.conn.dialect) {
    case DbDialect.SQLite:
      return 'SQLite 是文件型数据库,"数据库"即文件本身,在 SkylerX 里通过新建连接指定文件路径来"创建"。'
    case DbDialect.DuckDB:
      return 'DuckDB 是文件型数据库,通过新建连接指定文件路径来"创建"。'
    case DbDialect.H2:
      return 'H2 (PG 兼容模式) 数据库由 H2 启动参数决定,无法通过 SQL 即时创建新库。'
    case DbDialect.Oracle:
    case DbDialect.DM:
      return `${props.conn.dialect === DbDialect.Oracle ? 'Oracle' : '达梦 (DM)'}的"数据库"是实例级,需要 DBA + 数据文件配置。建议用 DBCA 等运维工具创建实例;在 SkylerX 内通常应该新建 schema(用户)代替。`
    case DbDialect.Elasticsearch:
    case DbDialect.Redis:
    case DbDialect.MongoDB:
      return 'NoSQL 方言通过 executeCommand 通道创建对应单元(Mongo collection / ES index / Redis 自动 db0-15),不走 CREATE DATABASE。'
    default:
      return null
  }
})

/** Charset 选项(按方言推荐)。 */
const charsetOptions = computed<string[]>(() => {
  switch (props.conn.dialect) {
    case DbDialect.MySQL:
    case DbDialect.MariaDB:
    case DbDialect.OceanBase:
    case DbDialect.TiDB:
    case DbDialect.Doris:
    case DbDialect.StarRocks:
      return ['utf8mb4', 'utf8', 'latin1', 'gbk']
    case DbDialect.PostgreSQL:
    case DbDialect.KingbaseES:
    case DbDialect.OpenGauss:
    case DbDialect.Greenplum:
    case DbDialect.CockroachDB:
    case DbDialect.Redshift:
      return ['UTF8', 'SQL_ASCII', 'LATIN1', 'GBK']
    default:
      return []
  }
})

/** Collation 选项(按 charset 简化)。 */
const collationOptions = computed<string[]>(() => {
  if (
    [
      DbDialect.MySQL,
      DbDialect.MariaDB,
      DbDialect.OceanBase,
      DbDialect.TiDB,
      DbDialect.Doris,
      DbDialect.StarRocks,
    ].includes(props.conn.dialect)
  ) {
    // 常用前几个,完整列表很长不全列
    return ['utf8mb4_general_ci', 'utf8mb4_unicode_ci', 'utf8mb4_0900_ai_ci', 'utf8mb4_bin']
  }
  return []
})

/** Quote 标识符(各方言惯用引号)。 */
function quoteId(n: string): string {
  switch (props.conn.dialect) {
    case DbDialect.MySQL:
    case DbDialect.MariaDB:
    case DbDialect.OceanBase:
    case DbDialect.TiDB:
    case DbDialect.Doris:
    case DbDialect.StarRocks:
    case DbDialect.ClickHouse:
      return `\`${n.replace(/`/g, '``')}\``
    case DbDialect.SqlServer:
      return `[${n.replace(/]/g, ']]')}]`
    default:
      // pg 系 + snowflake + tdengine 用双引号(tdengine 实际不要引号但带也兼容)
      return `"${n.replace(/"/g, '""')}"`
  }
}

function quoteStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/** 生成 CREATE DATABASE 语句序列(可能多条,如 PG 的 COMMENT ON 独立)。 */
const sqlStatements = computed<string[]>(() => {
  const n = name.value.trim()
  if (!n) return []
  const id = quoteId(n)
  const cs = charset.value.trim()
  const co = collation.value.trim()
  const cm = comment.value.trim()
  const out: string[] = []
  switch (props.conn.dialect) {
    case DbDialect.MySQL:
    case DbDialect.MariaDB:
    case DbDialect.OceanBase:
    case DbDialect.TiDB:
    case DbDialect.Doris:
    case DbDialect.StarRocks: {
      let sql = `CREATE DATABASE ${id}`
      if (cs) sql += ` DEFAULT CHARACTER SET ${cs}`
      if (co) sql += ` DEFAULT COLLATE ${co}`
      out.push(sql)
      // Note: MySQL 不支持在 CREATE DATABASE 里 COMMENT,Doris/StarRocks 用 PROPERTIES,简化暂不带
      break
    }
    case DbDialect.PostgreSQL:
    case DbDialect.KingbaseES:
    case DbDialect.OpenGauss:
    case DbDialect.Greenplum:
    case DbDialect.CockroachDB:
    case DbDialect.Redshift: {
      let sql = `CREATE DATABASE ${id}`
      if (cs) sql += ` ENCODING ${quoteStr(cs)}`
      out.push(sql)
      if (cm) out.push(`COMMENT ON DATABASE ${id} IS ${quoteStr(cm)}`)
      break
    }
    case DbDialect.SqlServer:
      out.push(`CREATE DATABASE ${id}`)
      break
    case DbDialect.ClickHouse: {
      let sql = `CREATE DATABASE ${id}`
      if (cm) sql += ` COMMENT ${quoteStr(cm)}`
      out.push(sql)
      break
    }
    case DbDialect.Snowflake: {
      let sql = `CREATE DATABASE ${id}`
      if (cm) sql += ` COMMENT = ${quoteStr(cm)}`
      out.push(sql)
      break
    }
    case DbDialect.TDengine:
      out.push(`CREATE DATABASE ${quoteId(n).replace(/^"|"$/g, '')}`) // tdengine 不要引号
      break
    default:
      // 不会落到这里 — unsupportedReason 提前拦
      out.push(`CREATE DATABASE ${id}`)
  }
  return out
})

/** 用户可编辑的 SQL 文本(`;\n\n` 连接多条),双向同步。 */
const sqlText = ref('')
watch(sqlStatements, (sts) => {
  sqlText.value = sts.map((s) => `${s};`).join('\n\n')
})

const canSubmit = computed(
  () => !!name.value.trim() && !unsupportedReason.value && !submitting.value,
)

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    // 拆 SQL 用 ; + 换行作为分隔(简单方案,够用)
    const stmts = sqlText.value
      .split(/;\s*\n/)
      .map((s) => s.trim().replace(/;$/, ''))
      .filter(Boolean)
    for (const s of stmts) {
      await client.connections.execute(props.conn.id, s, [], {})
    }
    toast.success(`已创建数据库: ${name.value.trim()}`)
    emit('created', name.value.trim())
    emit('close')
  } catch (e) {
    toast.error(`创建失败: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    submitting.value = false
  }
}

watch(
  () => props.open,
  (op) => {
    if (op) {
      name.value = ''
      charset.value = ''
      collation.value = ''
      comment.value = ''
      showAdvanced.value = false
      sqlText.value = ''
    }
  },
)
</script>

<template>
  <Modal v-if="open" :title="`新建数据库  ·  ${conn.name || conn.dialect}`" width="medium" @close="emit('close')">
    <div v-if="unsupportedReason" class="unsupported">
      <div class="us-title">⚠ 该方言不支持此操作</div>
      <div class="us-body">{{ unsupportedReason }}</div>
    </div>

    <div v-else class="form">
      <div class="row">
        <label class="lbl">名称 *</label>
        <input v-model="name" class="ip" placeholder="例如 my_app" autofocus />
      </div>

      <button class="advanced-toggle" @click="showAdvanced = !showAdvanced">
        {{ showAdvanced ? '▾' : '▸' }} 高级选项 (字符集 / 排序 / 注释)
      </button>

      <template v-if="showAdvanced">
        <div v-if="charsetOptions.length" class="row">
          <label class="lbl">字符集</label>
          <div class="select-row">
            <select v-model="charset" class="ip">
              <option value="">— 默认 —</option>
              <option v-for="c in charsetOptions" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
        </div>

        <div v-if="collationOptions.length" class="row">
          <label class="lbl">排序规则</label>
          <select v-model="collation" class="ip">
            <option value="">— 默认 —</option>
            <option v-for="c in collationOptions" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>

        <div class="row">
          <label class="lbl">注释</label>
          <input v-model="comment" class="ip" placeholder="可选,描述用途" />
          <div class="meta">注:MySQL 系不支持库注释,会被忽略</div>
        </div>
      </template>

      <div class="row">
        <label class="lbl">SQL 预览 (可编辑)</label>
        <textarea v-model="sqlText" class="ta sql" spellcheck="false" rows="6" />
      </div>
    </div>

    <template #footer>
      <button class="btn-ghost" :disabled="submitting" @click="emit('close')">取消</button>
      <button v-if="!unsupportedReason" class="btn-primary" :disabled="!canSubmit" @click="submit">
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
  font-family: ui-monospace, monospace;
}
.ta.sql {
  resize: vertical;
  min-height: 100px;
  white-space: pre;
}
.select-row {
  display: flex;
  gap: 8px;
}
.meta {
  font-size: 11px;
  color: var(--muted);
}
.advanced-toggle {
  background: transparent;
  border: none;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  align-self: flex-start;
  padding: 2px 0;
}
.advanced-toggle:hover {
  color: var(--accent);
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
  line-height: 1.5;
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
