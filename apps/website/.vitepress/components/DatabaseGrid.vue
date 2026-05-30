<script setup lang="ts">
/**
 * 支持的数据库矩阵.
 * 数据来自 README"Supported databases"节,加一些维度方便对比:
 *  - kind:sql / nosql
 *  - tag:协议兼容 / 国产信创 / 列存 / 时序 / 云 DW / 本地文件
 *  - driver:npm 包名(惰性 import)
 */
interface DbEntry {
  name: string
  kind: 'sql' | 'nosql'
  tags: string[]
  driver: string
  notes?: string
}

const entries: DbEntry[] = [
  { name: 'MySQL', kind: 'sql', tags: ['主流'], driver: 'mysql2' },
  { name: 'MariaDB', kind: 'sql', tags: ['MySQL 协议兼容'], driver: 'mysql2' },
  { name: 'PostgreSQL', kind: 'sql', tags: ['主流'], driver: 'pg' },
  {
    name: 'Oracle',
    kind: 'sql',
    tags: ['主流'],
    driver: 'oracledb',
    notes: 'thin 模式,SYSDBA 角色支持',
  },
  { name: 'SQL Server', kind: 'sql', tags: ['主流'], driver: 'mssql' },
  { name: '达梦 DM', kind: 'sql', tags: ['国产信创'], driver: 'dmdb' },
  { name: '人大金仓 Kingbase', kind: 'sql', tags: ['国产信创', 'PG 协议兼容'], driver: 'pg' },
  { name: 'openGauss', kind: 'sql', tags: ['国产信创', 'PG 协议兼容'], driver: 'pg' },
  {
    name: 'OceanBase',
    kind: 'sql',
    tags: ['国产信创', 'MySQL 协议兼容'],
    driver: 'mysql2',
    notes: 'Oracle 租户也可连',
  },
  { name: 'TiDB', kind: 'sql', tags: ['国产信创', 'MySQL 协议兼容'], driver: 'mysql2' },
  { name: 'Apache Doris', kind: 'sql', tags: ['列存 OLAP', 'MySQL 协议兼容'], driver: 'mysql2' },
  { name: 'StarRocks', kind: 'sql', tags: ['列存 OLAP', 'MySQL 协议兼容'], driver: 'mysql2' },
  { name: 'CockroachDB', kind: 'sql', tags: ['分布式', 'PG 协议兼容'], driver: 'pg' },
  { name: 'Greenplum', kind: 'sql', tags: ['MPP', 'PG 协议兼容'], driver: 'pg' },
  { name: 'H2', kind: 'sql', tags: ['PG-server 模式'], driver: 'pg' },
  { name: 'Amazon Redshift', kind: 'sql', tags: ['云 DW', 'PG 协议兼容'], driver: 'pg' },
  { name: 'Snowflake', kind: 'sql', tags: ['云 DW'], driver: 'snowflake-sdk' },
  { name: 'ClickHouse', kind: 'sql', tags: ['列存 OLAP'], driver: '@clickhouse/client' },
  { name: 'SQLite', kind: 'sql', tags: ['本地文件'], driver: 'better-sqlite3' },
  { name: 'DuckDB', kind: 'sql', tags: ['本地文件', '列存 OLAP'], driver: '@duckdb/node-api' },
  { name: 'TDengine 涛思', kind: 'sql', tags: ['国产信创', '时序'], driver: '@tdengine/websocket' },
  { name: 'MongoDB', kind: 'nosql', tags: ['文档'], driver: 'mongodb' },
  { name: 'Redis', kind: 'nosql', tags: ['KV / 数据结构'], driver: 'ioredis' },
  { name: 'Elasticsearch', kind: 'nosql', tags: ['搜索引擎'], driver: '@elastic/elasticsearch' },
]

const tagColors: Record<string, string> = {
  主流: 'g',
  国产信创: 'r',
  'MySQL 协议兼容': 'b',
  'PG 协议兼容': 'b',
  '列存 OLAP': 'p',
  MPP: 'p',
  分布式: 'y',
  本地文件: 'k',
  '云 DW': 'c',
  时序: 'o',
  文档: 'g',
  'KV / 数据结构': 'g',
  搜索引擎: 'g',
  'PG-server 模式': 'b',
}

defineProps<{ compact?: boolean }>()
</script>

<template>
  <div class="db-grid">
    <div
      v-for="e in entries"
      :key="e.name"
      class="db-card"
      :class="{ nosql: e.kind === 'nosql', compact }"
    >
      <div class="db-name">
        {{ e.name }}
        <span class="db-kind" :class="e.kind">{{ e.kind === 'sql' ? 'SQL' : 'NoSQL' }}</span>
      </div>
      <div v-if="!compact && e.tags.length" class="db-tags">
        <span
          v-for="t in e.tags"
          :key="t"
          class="db-tag"
          :class="`c-${tagColors[t] ?? 'g'}`"
        >{{ t }}</span>
      </div>
      <div v-if="!compact" class="db-driver">驱动 <code>{{ e.driver }}</code></div>
      <div v-if="!compact && e.notes" class="db-notes">{{ e.notes }}</div>
    </div>
  </div>
</template>

<style scoped>
.db-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin: 1.6rem 0;
}
.db-card {
  padding: 14px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.db-card:hover {
  transform: translateY(-2px);
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 6px 18px rgba(124, 108, 255, 0.18);
}
.db-card.compact {
  padding: 8px 12px;
  border-radius: 8px;
}
.db-name {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
  font-size: 0.98rem;
}
.db-kind {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(124, 108, 255, 0.18);
  color: var(--vp-c-brand-1);
}
.db-kind.nosql {
  background: rgba(65, 209, 255, 0.18);
  color: #1ea6cc;
}
.db-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 10px;
}
.db-tag {
  font-size: 0.7rem;
  padding: 2px 7px;
  border-radius: 999px;
}
.c-g { background: rgba(76, 175, 80, 0.16); color: #2e8b3a; }
.c-r { background: rgba(255, 99, 99, 0.16); color: #cc4444; }
.c-b { background: rgba(99, 165, 255, 0.16); color: #2e6fc6; }
.c-p { background: rgba(124, 108, 255, 0.18); color: var(--vp-c-brand-1); }
.c-y { background: rgba(255, 193, 7, 0.18); color: #b88a00; }
.c-k { background: rgba(120, 120, 120, 0.16); color: #555; }
.c-c { background: rgba(65, 209, 255, 0.18); color: #1ea6cc; }
.c-o { background: rgba(255, 152, 0, 0.18); color: #c47b00; }

.db-driver {
  margin-top: 10px;
  font-size: 0.78rem;
  color: var(--vp-c-text-2);
}
.db-driver code {
  font-size: 0.75rem;
  padding: 1px 6px;
}
.db-notes {
  margin-top: 6px;
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
  font-style: italic;
}
.dark .c-g { color: #84d18d; }
.dark .c-r { color: #ff8e8e; }
.dark .c-b { color: #8bb6ff; }
.dark .c-y { color: #ffd266; }
.dark .c-k { color: #aaa; }
.dark .c-c { color: #7fdcff; }
.dark .c-o { color: #ffb56b; }
</style>
