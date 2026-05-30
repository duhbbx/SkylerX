# SkylerX 官网（@db-tool/website）

VitePress 站点,部署到 `https://skyler.uno`。

## 本地开发

```bash
pnpm install                 # 装依赖(根目录运行,monorepo)
pnpm dev:website             # 启动 vitepress dev server,默认 5173 端口

# 单独跑也行
pnpm -F @db-tool/website dev
```

打开 `http://localhost:5173`。

## 构建

```bash
pnpm build:website           # 输出到 apps/website/.vitepress/dist
pnpm preview:website         # 本地预览构建产物
```

## 类型检查

```bash
pnpm -F @db-tool/website typecheck
```

## 部署 — Cloudflare Pages(推荐)

1. Cloudflare Dashboard → Pages → 创建项目 → 连接 GitHub
2. 选 `duhbbx/SkylerX` 仓库
3. 构建设置:
   - **Framework preset**: `VitePress`
   - **Build command**: `pnpm install && pnpm build:website`
   - **Build output directory**: `apps/website/.vitepress/dist`
   - **Root directory**: 留空(monorepo 根)
   - **Node version**: 22(在 `Settings → Environment variables` 加 `NODE_VERSION=22`)
4. 绑定域名 `skyler.uno` 到该 Pages 项目
5. 每次 push main 自动触发构建 + 部署

## 部署 — 其它方案

- **Vercel**: Framework 选 `Other`,build command 同上,output `apps/website/.vitepress/dist`
- **Netlify**: 同上
- **GitHub Pages**: 用本仓库自带 workflow,见 `.github/workflows/website.yml`
- **Aliyun OSS**(国内加速): 把构建产物 sync 到 OSS bucket;详见 [设计文档](#) 的 Phase 2

## 内容来源

- 首页文案:`INTRO.md` + `README.md`
- 数据库矩阵:`apps/website/.vitepress/components/DatabaseGrid.vue`(硬编码,跟 README 保持一致;有新方言两边都改)
- 截图:`docs/screenshots/*.png`(项目根的截图目录,这里通过 `public/` 软链或拷贝)
- 文档:`apps/website/docs/*.md`

## 后续 Phase

详见根目录设计文档:

- Phase 2:国内加速(Aliyun OSS 镜像 + DNS 智能解析)
- Phase 3:中英双语
- Phase 4:博客 + 企业咨询表单
- Phase 5:更动态的截图 / 教程视频
