# SkylerX — Claude Code 项目约束

This file is auto-loaded by Claude Code when working inside this repository.
内容简洁，只写跨任务、跨会话仍然成立的硬性约束。一次性的偏好用 user-level memory。

## Git 工作流

- 日常开发在 `dev` 分支。
- 要打 tag 时：`git checkout main && git merge dev --ff-only && git push && git tag v… && git push --tags && git checkout dev`。
- `main` 只接收 `dev` 的 fast-forward merge，不直接 commit。
- Commit message 不附加 `Co-Authored-By: Claude …` 行。

## GitHub issue 处理

1. **不要主动 close issue。** close 由 owner 决定;Claude 只在 issue 下评论修复结果，让 owner 验证后自己关。
2. **评论一律用英文。** 项目面向中英文双语用户 + GitHub 通用语言，英文评论可读性最广。
3. **评论格式（推荐）**：
   - 一句话指出根因
   - 引用具体 commit hash（用反引号）：`7b01362`
   - 引导用户验证："Please verify on **v0.5.0-rcXX** or later."
   - 末尾加 `Refs #N`（GitHub 会在 issue 时间线显示交叉引用，但**不**触发自动 close）
4. **Commit message 关联 issue：** 用 `Refs #N`，**不要**用 `Closes #N` / `Fixes #N` / `Resolves #N`（这些关键词会让 GitHub 在 commit 进 main 时自动 close issue，跟约束 1 冲突）。
5. **无法立刻修复时**也要评论：写一句"investigating"或要 user 补充复现信息（OS / 数据库版本 / 操作步骤），不要让 issue 沉默。

## 发布

- Tag 格式：`v<semver>` (e.g. `v0.5.0-rc17`)；prerelease 用 `-rc` / `-beta` / `-alpha` 后缀，electron-updater channel 推断依赖这个。
- CI release-notes job 用 DeepSeek（`scripts/generate-release-notes.sh`）自动生成中英双语 release body。配置见 `DEEPSEEK_API_KEY` GitHub secret。
- mac.target 必须同时有 `dmg` 和 `zip`（electron-updater macOS 更新协议要 zip 条目；详见 `apps/desktop/electron-builder.yml` 注释）。

## 本机环境（继承自 user memory，写在这里是为了 CI 外的开发者也能看到）

- node-gyp 用 `python3.9`；默认 3.14 无 distutils 装不动 better-sqlite3 等。
- 本机有 Privoxy 拦 localhost：`curl --noproxy '*'` 才能访问 localhost。
- `skyler.uno` 系列服务器（101.132.20.134）是共享机：**不要** `ufw`，**不要**改现有 nginx；SOLÉ 部署在 `sole.skyler.uno`，SkylerX 文档站在 `skylerx.skyler.uno`。

## CI 加速 / 国内镜像

- OSS bucket: `skylerx-build`（华东 2 上海），CI 同步 release artifacts 到这里给国内用户用。
- 桌面端 `updater.ts` 在 `Asia/Shanghai|Chongqing|Urumqi|Harbin` 时区首启动默认 OSS channel；GitHub 通道遇网络错误会主动建议切镜像。
