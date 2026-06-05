/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { type BrowserWindow, Menu, type MenuItemConstructorOptions, shell } from 'electron'

/**
 * 应用菜单（参考 DataGrip / Navicat 的「文件 / 编辑 / 视图 / 工具 / 窗口 / 帮助」7 项布局）。
 *
 * 自定义菜单项不直接执行业务逻辑（主进程拿不到渲染层 Vue 状态），
 * 而是统一 `webContents.send('menu:command', '<key>')` 到渲染层；
 * 渲染层的 Workspace 用 `window.api.menu.onCommand(key => ...)` 订阅后按 key 路由。
 *
 * 系统级 role（undo/redo/zoom/fullscreen 等）由 Electron 直接处理，无需自定义。
 */
export function setupMenu(mainWindow?: BrowserWindow): void {
  const isMac = process.platform === 'darwin'

  /** 通知渲染层执行某个菜单命令 */
  const send = (key: string) => () => {
    mainWindow?.webContents.send('menu:command', key)
  }

  const template: MenuItemConstructorOptions[] = [
    // ── macOS 专属应用菜单 ──
    ...(isMac
      ? [
          {
            label: 'SkylerX',
            submenu: [
              { label: '关于 SkylerX', click: send('about') },
              { type: 'separator' as const },
              { label: '设置…', accelerator: 'CmdOrCtrl+,', click: send('settings') },
              { label: '检查更新…', click: send('check-update') },
              { type: 'separator' as const },
              { role: 'services' as const, label: '服务' },
              { type: 'separator' as const },
              { role: 'hide' as const, label: '隐藏 SkylerX' },
              { role: 'hideOthers' as const, label: '隐藏其他' },
              { role: 'unhide' as const, label: '全部显示' },
              { type: 'separator' as const },
              { role: 'quit' as const, label: '退出 SkylerX' },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),

    // ── 文件 ──
    {
      label: '文件',
      submenu: [
        { label: '新建连接', accelerator: 'CmdOrCtrl+N', click: send('new-conn') },
        { label: '新建查询', accelerator: 'CmdOrCtrl+T', click: send('new-query') },
        { type: 'separator' },
        { label: '打开 SQL 文件…', accelerator: 'CmdOrCtrl+O', click: send('open-sql') },
        { type: 'separator' },
        { label: '导入连接配置…', click: send('import-conns') },
        { label: '导出连接配置…', click: send('export-conns') },
        { type: 'separator' },
        { label: '备份 / 还原…', click: send('backup-restore') },
        { type: 'separator' },
        { label: '关闭标签页', accelerator: 'CmdOrCtrl+W', click: send('close-tab') },
        {
          label: '重开关闭的标签页',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: send('reopen-tab'),
        },
        ...(isMac
          ? []
          : ([
              { type: 'separator' as const },
              { label: '设置…', accelerator: 'CmdOrCtrl+,', click: send('settings') },
              { type: 'separator' as const },
              { role: 'quit' as const, label: '退出' },
            ] as MenuItemConstructorOptions[])),
      ],
    },

    // ── 编辑（系统级 role 撑大半）──
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        { label: '查找', accelerator: 'CmdOrCtrl+F', click: send('find') },
        { label: '替换', accelerator: 'CmdOrCtrl+H', click: send('replace') },
        { label: '格式化 SQL', accelerator: 'CmdOrCtrl+Shift+F', click: send('format-sql') },
      ],
    },

    // ── 视图 ──
    {
      label: '视图',
      submenu: [
        { label: '命令面板', accelerator: 'CmdOrCtrl+K', click: send('palette') },
        { label: '对象搜索', accelerator: 'CmdOrCtrl+Shift+O', click: send('object-search') },
        { type: 'separator' },
        {
          label: '切换 AI 聊天面板',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: send('toggle-ai-chat'),
        },
        { label: '收藏夹', click: send('favorites') },
        { label: '操作日志', click: send('op-log') },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: '切换开发者工具' },
      ],
    },

    // ── 数据库（DBA / 运维）──
    {
      label: '数据库',
      submenu: [
        { label: '服务器活动…', click: send('activity') },
        { label: '服务器监控…', click: send('monitor') },
        { label: '定时任务…', click: send('jobs') },
        { label: '用户权限…', click: send('privileges') },
        { type: 'separator' },
        { label: '备份 / 还原…', click: send('backup-restore') },
        { label: '数据传输…', click: send('data-transfer') },
        { type: 'separator' },
        { label: 'Dashboard…', click: send('dashboard') },
        { label: '跨表全文搜索…', click: send('search-value') },
        { label: '数据契约…', click: send('contracts') },
      ],
    },

    // ── 迁移 / 对比 ──
    {
      label: '迁移 / 对比',
      submenu: [
        { label: '结构对比…', click: send('schema-diff') },
        { label: '数据对比…', click: send('data-diff') },
        { label: 'Schema 快照…', click: send('snapshots') },
        { type: 'separator' },
        { label: 'ER 关系图…', click: send('er-diagram') },
        { label: '迁移评估…', click: send('mig-assess') },
      ],
    },

    // ── 智能 / SQL 工具 ──
    {
      label: 'AI',
      submenu: [
        { label: 'AI 助手…', click: send('ai-assistant') },
        { label: 'AI 工具箱…', click: send('ai-toolbox') },
        { label: 'AI 知识库 RAG…', click: send('rag') },
        { type: 'separator' },
        { label: 'SQL 翻译…', click: send('translate') },
        { label: 'Notebook…', click: send('notebook') },
        { label: '查询结果对比…', click: send('result-diff') },
        { label: 'SQL 血缘图…', click: send('sql-lineage') },
        { label: '自定义 Lint 规则…', click: send('lint-rules') },
      ],
    },

    // ── 窗口 ──
    {
      label: '窗口',
      submenu: [
        { label: '新窗口', accelerator: 'CmdOrCtrl+Shift+N', click: send('new-window') },
        { type: 'separator' },
        { role: 'minimize', label: '最小化' },
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        ...(isMac ? [{ role: 'front' as const, label: '前置全部窗口' }] : []),
      ],
    },

    // ── 帮助 ──
    {
      label: '帮助',
      role: 'help',
      submenu: [
        { label: '关于 SkylerX', click: send('about') },
        { label: '快捷键参考…', click: send('shortcuts') },
        { type: 'separator' },
        {
          label: 'GitHub 仓库',
          click: () => void shell.openExternal('https://github.com/duhbbx/SkylerX'),
        },
        {
          label: '反馈问题',
          click: () => void shell.openExternal('https://github.com/duhbbx/SkylerX/issues'),
        },
        { type: 'separator' },
        { label: '检查更新…', click: send('check-update') },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
