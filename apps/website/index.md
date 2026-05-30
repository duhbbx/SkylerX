---
layout: home
title: SkylerX — 开源数据库管理工具
titleTemplate: 跨平台 · 多方言 · AI 加持

hero:
  name: SkylerX
  text: 一个 AI 加持的<br/>跨平台数据库管理工具
  tagline: 17 SQL + 3 NoSQL 方言 · 国产信创全家桶 · Electron + Vue 3 · Apache 2.0
  image:
    src: /hero-screenshot.png
    alt: SkylerX 查询工作区
  actions:
    - theme: brand
      text: 立即下载
      link: /download
    - theme: alt
      text: 查看文档
      link: /docs/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/duhbbx/SkylerX

features:
  - icon: 🧠
    title: 多家 AI 助手
    details: Anthropic / OpenAI / DeepSeek / Codex / Grok 自由切换;7 个专业 AI Toolbox + 行内补全 + 健康体检
  - icon: 🔌
    title: 20+ 方言
    details: 主流 SQL + 国产信创(达梦/金仓/openGauss/OceanBase/TiDB)+ NoSQL(MongoDB/Redis/ES)
  - icon: 🛡
    title: 生产保护
    details: prod 标记 + 危险 SQL 二次确认 + SQL Linter 规则引擎 + 数据脱敏 + 国密 SM2/3/4
  - icon: 📊
    title: 可视化结果集
    details: 虚拟滚动 + 可编辑 + JSON/BLOB 识别 + 数字列 sparkline + 条件着色
  - icon: 🔍
    title: EXPLAIN 可视化
    details: 预估行 vs 实际行,慢算子高亮,可选 ANALYZE 真跑测
  - icon: 🛠
    title: DBA 工具箱
    details: 服务器活动 / KILL / 慢查询日志解析 / 复制延迟监控 / 索引推荐 / Schema 漂移检测
---

<HeroExtra />

## 为什么选 SkylerX

- **Navicat 收费且不开源**,国内还有续费 / 激活的麻烦
- **DataGrip 订阅贵**,对个人开发者不友好
- **DBeaver 卡且 UI 老**,AI 能力薄
- **国产数据库**(达梦 / KingbaseES / openGauss)在主流工具里支持都不算友好
- 想要一个**真正能用 AI 帮你写 SQL / 解读 EXPLAIN / 体检数据库**的工具

所以 SkylerX 重新写了一个,**开源、免费、跨平台、信创就绪**。

## 主要能力

<FeatureGrid />

## 支持的数据库

涵盖 17 个 SQL + 3 个 NoSQL 方言,**国产数据库与国产信创环境**全家桶:

<DatabaseGrid />

[查看完整数据库矩阵 →](/databases)

## 开始使用

```bash
# 1. 从 GitHub Releases 下载对应平台安装包
#    macOS .dmg / Windows .exe / Linux .AppImage / .deb / .rpm
open https://github.com/duhbbx/SkylerX/releases/latest

# 2. 安装并启动 SkylerX

# 3. 新建连接 → 选方言 → 填 host/port/user/password → 测试 → 保存

# 4. 双击连接 → 浏览导航树 → 双击表名打开数据网格 → 开始查询
```

完整教程见 [快速开始 →](/docs/getting-started)

## 关于 / 商务合作

**武汉斯凯勒网络科技有限公司**(Wuhan Skyler Network Technology Co., Ltd.)— SkylerX 的开发与维护方,同时承接外包开发与项目合作:

- 🗄 **数据库咨询** — 选型 / 设计 / 调优 / 迁移(Oracle / SQL Server → MySQL / PG / 国产数据库)
- 🏢 **Navicat / DataGrip 替代部署** — 企业内私有化版本定制
- 🛡 **信创 / 国产化环境部署** — 麒麟 / 统信 UOS / 龙芯 / 飞腾 等
- 🤖 **AI 集成** — LLM 网关 / RAG / Agent 工作流 / 私有化推理
- 📊 **数据平台** — ETL / 数仓(ClickHouse / Snowflake / DuckDB)
- 🛠 **DevOps & SRE** — CI/CD / 可观测 / 多云混合

联系方式:`duhbbx@gmail.com` · WeChat `tuhoooo`
