/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { InjectionKey } from 'vue'
import type { ObjectKind, SqlTemplateKind } from '../ddl'
import type { TreeNode } from './treeNode'

/**
 * 树控制器：NavTree 创建并 provide，TreeItem（任意深度）inject 后直接调用。
 *
 * 取代「逐层 emit 冒泡」——树节点的交互/动作全部经此分发，递归组件零事件转发。
 * 动作原语（openConnection/runSql/...）由 NavTree 实现并桥接到上层 App。
 */
export interface TreeController {
  /** 拉取并填充某节点的子节点（懒加载） */
  loadChildren(node: TreeNode, connId: string): Promise<void>
  /** 单击：选中节点（高亮） */
  select(node: TreeNode, connId: string): void
  /** 该节点是否为当前选中节点 */
  isSelected(node: TreeNode, connId: string): boolean
  /** Ctrl/⌘ 点击：把对象节点加入/移出批量选择集（仅可删除的对象类型） */
  toggleMulti(node: TreeNode, connId: string): void
  /** Ctrl/⌘ 点击连接节点：连接级多选 (跟 toggleMulti 互斥, 各自的批量操作不同) */
  toggleMultiConn(connId: string): void
  /** 该节点是否在批量选择集中 */
  isMultiSelected(node: TreeNode, connId: string): boolean
  /** 该连接是否在连接级多选集中 */
  isMultiSelectedConn(connId: string): boolean
  /** Shift+click 范围选择 — 从最后一次单击锚点到当前节点的可见连续区间加入选择 */
  rangeSelect(node: TreeNode, connId: string): void
  /** Shift+click 范围选择 — 连接节点版 */
  rangeSelectConn(connId: string): void
  /** 清空批量选择集 (包括连接级) */
  clearMulti(): void
  /** 双击：打开节点（连接→打开连接；表/视图→查询前 200 行；其余由调用方展开） */
  openNode(node: TreeNode, connId: string): void
  /** 在光标处弹出该节点的右键菜单 */
  openContextMenu(x: number, y: number, node: TreeNode, connId: string): void

  // ── 动作原语（供 tree-actions 中的动作调用）──
  /** 聚焦该连接已有查询页，没有则开一个 */
  openConnection(connId: string): void
  /** 为该连接新开一个查询页；node 用于预选其所在库/schema 作为查询上下文 */
  newQuery(node: TreeNode, connId: string): void
  /** 在该节点所属库/schema 下新建对象（表/视图/函数/存储过程） */
  createObject(kind: ObjectKind, node: TreeNode, connId: string): void
  /** 删除对象（表/视图/函数/存储过程/库/schema），需二次确认 */
  dropObject(node: TreeNode, connId: string): void
  /** 查看表/视图结构（只读列信息页） */
  viewStructure(node: TreeNode, connId: string): void
  /** 查询前 N 行（按方言生成正确的限行 SQL 并执行） */
  previewTable(node: TreeNode, connId: string): void
  /** 设计表：在表设计器中以「修改表」(alter) 模式打开 */
  designTable(node: TreeNode, connId: string): void
  /** 查看表统计信息（行数 / 数据 / 索引占用） */
  tableStats(node: TreeNode, connId: string): void
  /** 生成测试数据：按列类型造多行 INSERT 填入查询页 */
  generateMockData(node: TreeNode, connId: string): void
  /** 查看表的外键依赖关系（引用/被引用） */
  viewDependencies(node: TreeNode, connId: string): void
  /** 复制建表语句（CREATE TABLE DDL）到剪贴板 */
  copyDdl(node: TreeNode, connId: string): void
  /** 收藏 / 取消收藏该表/视图（全局收藏夹） */
  toggleFavorite(node: TreeNode, connId: string): void
  /** 复制视图/函数/存储过程/触发器的 DDL 到剪贴板 */
  copyObjectDdl(node: TreeNode, connId: string): void
  /** 清空表：DELETE FROM x（事务安全、可回滚；触发触发器） */
  emptyTable(node: TreeNode, connId: string): void
  /** 截断表：TRUNCATE TABLE x（极快、重置自增；DDL 不可回滚） */
  truncateTable(node: TreeNode, connId: string): void
  /** 重命名表：弹窗输入新名 → 生成对应方言 ALTER/RENAME */
  renameTable(node: TreeNode, connId: string): void
  /** 复制表：仅结构 / 结构+数据；目标名走弹窗，DDL 在草稿查询页打开 */
  copyTable(node: TreeNode, connId: string, withData: boolean): void
  /** 切换连接的生产环境标记（extra.env: prod ↔ undefined） */
  toggleProdMark(connId: string): void
  /** 用模板在草稿查询页里打开「新建序列 / 事件」之类的 SQL，给用户编辑后执行（不走结构化设计器） */
  createTemplateDraft(kind: 'sequence' | 'event', node: TreeNode, connId: string): void
  /** 生成库/schema 的数据字典（Markdown 文件） */
  dataDict(node: TreeNode, connId: string): void
  /** 生成库/schema 的数据字典（HTML 文件，可打印 PDF） */
  dataDictHtml(node: TreeNode, connId: string): void
  /** 编辑视图/函数/存储过程：载入定义后以 DDL 编辑器打开 */
  editObject(node: TreeNode, connId: string): void
  /** 查看触发器/序列定义：取定义填入查询页（可改后手动执行） */
  viewDefinition(node: TreeNode, connId: string): void
  /** 生成 SQL 模板（SELECT/INSERT/UPDATE/DELETE）填入查询页 */
  generateSql(kind: SqlTemplateKind, node: TreeNode, connId: string): void
  /** 打开该库/schema 的 ER 图 */
  openErd(node: TreeNode, connId: string): void
  /** 导入数据：打开 CSV 导入对话框（导入到该表） */
  importData(node: TreeNode, connId: string): void
  /** 导出该表为 SQL 文件（结构 + 数据） */
  exportSql(node: TreeNode, connId: string): void
  /** 导出整库/schema 为 SQL 文件（所有表 结构 + 数据） */
  exportSchemaSql(node: TreeNode, connId: string): void
  /** 数据传输：把该表数据复制到另一连接的表 */
  transferData(node: TreeNode, connId: string): void
  editConnection(connId: string): void
  newConnection(): void
  deleteConnection(connId: string): void
  /** 复制连接:基于现有 connId 克隆一份新 ID 的配置,名字追加"(副本)",落库后刷新树 */
  duplicateConnection(connId: string): void
  runSql(connId: string, sql: string): void
  refreshNode(node: TreeNode, connId: string): void
  copyText(text: string): void
  /** A3+B5+B6+B9+B10 数据检查器：列采样 / 整表剖析 / 约束扫描 / 类型优化 / 维护 */
  inspectTable(node: TreeNode, connId: string): void
  /** B3+B4+B8 数据修整：重复行 / NULL 补全 / 软删恢复 */
  fixupTable(node: TreeNode, connId: string): void
  /** G2 AI 写表/列注释 */
  aiCommentTable(node: TreeNode, connId: string): void
  /** G1 AI 数据库体检（连接级） */
  aiHealthCheck(connId: string): void
  /** C5 索引推荐器（连接级） */
  indexRecommender(connId: string): void
  /** Redis 专属:打开 RedisPane 并选中该 key */
  openRedisKey(connId: string, dbIndex: number, key: string): void
  /** Redis 专属:删除 key(DEL),删除后刷新父节点(类型组) */
  deleteRedisKey(connId: string, dbIndex: number, key: string, parent: TreeNode): void
  /** Redis 专属:清空指定逻辑库 dbN(FLUSHDB) */
  flushRedisDb(connId: string, dbIndex: number, dbNode: TreeNode): void
  /** Redis 专属:清空整个实例所有 16 个库(FLUSHALL) */
  flushRedisAll(connId: string, connNode: TreeNode): void
  /** Redis 专属:在 db 下新建 key(string/hash/list/set/zset,可选 TTL) */
  newRedisKey(connId: string, dbIndex: number, parent: TreeNode): void
  /** 新建数据库(SQL 方言) */
  newDatabase(connId: string, parent: TreeNode): void
  /** 新建 Schema(支持 schema 的方言:PG 系 / Oracle / MSSQL / Snowflake) */
  newSchema(connId: string, parent: TreeNode): void
  /** OB/TiDB:打开集群拓扑面板 */
  openClusterTopology(connId: string): void
  /** PG 系:打开扩展/复制/复制槽面板 */
  openPgAdvanced(connId: string, database?: string): void
  /** ClickHouse:打开分区/Mutation/副本/TTL 面板 */
  openClickHouseAdvanced(connId: string, database?: string): void
  /** Doris/StarRocks:打开分区管理 */
  openMppPartition(connId: string, database?: string, table?: string): void
  /** MySQL/MariaDB:打开 binlog/主从/变量 面板 */
  openMysqlAdvanced(connId: string): void
  /** PII 扫描器 */
  openPiiScanner(connId: string, database?: string, schema?: string): void
  /** 脱敏视图生成 */
  openMaskingView(connId: string, database?: string, schema?: string, table?: string): void
  /** AI 慢 SQL 优化 + 错误根因 */
  openAiInsights(
    connId: string,
    prefillSql?: string,
    prefillError?: string,
    tab?: 'slow' | 'error',
  ): void
  /** AI 反向工程 schema(从 sample 推断) */
  openAiSchemaReverse(connId: string, database?: string): void
  /** AI 建表助手(对话式) */
  openAiSchemaArchitect(connId: string, database?: string): void
  /** #24: 当前连接是否启用了 "可见库/Schema 过滤" — 启用时 TreeItem 会画指示器,
   *  返回的 Set 用来在 displayChildren 里过滤 Connection 节点直挂的子节点. */
  connVisibleFilter(connId: string): Set<string> | null
  /** #24: 配置过滤时 snapshot 的顶层总数 — 用于 chip 的分母. 即便连接未展开
   *  也能立即显示 "N/M", 而不是只有 N. 没配过过滤时返回 null. */
  connVisibleTotal(connId: string): number | null
  /** #24 v2: 某连接下某库的可见 schema 白名单. null = 该库无过滤(全显);
   *  Set = 仅这些 schema 可见; 空 Set = 该库下全隐. */
  connVisibleSchemas(connId: string, database: string): Set<string> | null
  /** #24: 打开 "配置可见库/Schema" 对话框. */
  configureNavFilter(connId: string): void
  /** #A: 当前搜索是否激活 (非空 query). TreeItem 据此决定是否套搜索过滤,
   *  以及搜索时是否强制展开已加载分支让命中可见. */
  searchActive(): boolean
  /** #A: 节点是否通过搜索 — 自身名字命中或任一已加载后代命中. */
  nodeMatchesSearch(node: TreeNode): boolean
  /** #D: 打开 "进程 / 会话列表" 对话框 (process list + kill). */
  openProcessList(connId: string): void
}

export const TreeControllerKey: InjectionKey<TreeController> = Symbol('tree-controller')
