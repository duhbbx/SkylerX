import type { InjectionKey } from 'vue'
import type { ObjectKind } from '../ddl'
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
  /** 双击：打开节点（连接→打开连接；表/视图→查询前 200 行；其余由调用方展开） */
  openNode(node: TreeNode, connId: string): void
  /** 在光标处弹出该节点的右键菜单 */
  openContextMenu(x: number, y: number, node: TreeNode, connId: string): void

  // ── 动作原语（供 tree-actions 中的动作调用）──
  /** 聚焦该连接已有查询页，没有则开一个 */
  openConnection(connId: string): void
  /** 总是为该连接新开一个查询页（支持一个连接多开） */
  newQuery(connId: string): void
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
  /** 编辑视图/函数/存储过程：载入定义后以 DDL 编辑器打开 */
  editObject(node: TreeNode, connId: string): void
  /** 查看触发器/序列定义：取定义填入查询页（可改后手动执行） */
  viewDefinition(node: TreeNode, connId: string): void
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
  runSql(connId: string, sql: string): void
  refreshNode(node: TreeNode, connId: string): void
  copyText(text: string): void
}

export const TreeControllerKey: InjectionKey<TreeController> = Symbol('tree-controller')
