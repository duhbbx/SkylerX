<script setup lang="ts">
/**
 * 首页"主要功能"九宫格.
 * 标题刻意短,正文 1 行写卖点,避免堆字.
 */
interface Feature {
  icon: string
  title: string
  desc: string
}

const features: Feature[] = [
  {
    icon: '🧠',
    title: 'AI 助手',
    desc: 'Anthropic / OpenAI / DeepSeek / Codex / Grok 多家选,内置 7 个专业 Toolbox + 行内补全',
  },
  {
    icon: '🔌',
    title: '20+ 方言',
    desc: '主流 SQL + 国产信创(达梦/金仓/openGauss/OceanBase/TiDB)+ NoSQL(Mongo/Redis/ES)',
  },
  {
    icon: '✏️',
    title: 'Monaco 编辑器',
    desc: 'SQL 高亮 + 自动补全 + 格式化 + 参数化查询 + 片段库;⌘+Enter 即跑',
  },
  {
    icon: '📊',
    title: '可视化结果集',
    desc: '虚拟滚动 + 可编辑 + JSON/BLOB 识别 + 数字列 sparkline + 条件着色',
  },
  {
    icon: '🛡',
    title: '生产保护',
    desc: 'prod 标记 + 危险 SQL 二次确认 + SQL Linter + 数据脱敏 / 契约',
  },
  {
    icon: '🔍',
    title: 'EXPLAIN 可视化',
    desc: '预估行 vs 实际行,慢算子高亮,可选 ANALYZE 真跑测',
  },
  {
    icon: '🧬',
    title: '结构对比 / 漂移',
    desc: '两连接对比 → 自动生成对齐 SQL;Schema 快照 + 演化历史',
  },
  {
    icon: '🛠',
    title: 'DBA 工具箱',
    desc: '服务器活动 / KILL / 慢查询日志解析 / 复制延迟监控 / 索引推荐',
  },
  {
    icon: '🇨🇳',
    title: '信创就绪',
    desc: '达梦 / 金仓 / openGauss / OceanBase / TiDB / 国密 SM2/SM3/SM4 + 等保合规面板',
  },
]
</script>

<template>
  <div class="fg-grid">
    <div v-for="f in features" :key="f.title" class="fg-card">
      <div class="fg-icon">{{ f.icon }}</div>
      <div class="fg-title">{{ f.title }}</div>
      <div class="fg-desc">{{ f.desc }}</div>
    </div>
  </div>
</template>

<style scoped>
.fg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin: 1.6rem 0;
}
.fg-card {
  padding: 18px 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  transition: transform 0.18s, border-color 0.18s, box-shadow 0.18s;
}
.fg-card:hover {
  transform: translateY(-3px);
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 10px 24px rgba(124, 108, 255, 0.18);
}
.fg-icon {
  font-size: 1.6rem;
  margin-bottom: 6px;
}
.fg-title {
  font-weight: 700;
  font-size: 1.05rem;
  margin-bottom: 6px;
}
.fg-desc {
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
  line-height: 1.55;
}
</style>
