---
title: 下载 SkylerX
description: 全平台安装包(macOS / Windows / Linux),x64 + arm64 多架构
---

# 下载 SkylerX

<DownloadButton />

::: tip 下载源自动选择
中国大陆 / 港澳访问会自动用 **阿里云 OSS 镜像**(上海节点)直链,速度比 GitHub 快很多;海外用户走 **GitHub Releases**。下方矩阵顶部可以随时手动切换并记住选择。
:::

<DownloadMatrix />

## 系统要求

| 平台 | 最低版本 | 推荐 |
|---|---|---|
| **macOS** | 10.13(High Sierra) | 12+(Monterey 及以上)|
| **Windows** | 10 | 11 |
| **Linux** | glibc 2.28+(Ubuntu 20.04 / Debian 11 / CentOS 8 等同期) | Ubuntu 22.04+ |

**架构**:x64(Intel / AMD) 和 arm64(Apple Silicon / ARM 服务器 / Surface Pro X) 双架构支持。

## 国产信创环境

适配以下国产操作系统(用 `.deb` / `.rpm` / `.AppImage`):

| 系统 | 推荐格式 |
|---|---|
| **银河麒麟** / **中标麒麟** | `.rpm` |
| **统信 UOS** | `.deb` |
| **Ubuntu Kylin** / **优麒麟** | `.deb` |
| **openEuler** | `.rpm` |
| **Deepin** | `.deb` |
| **红旗 Linux** | `.rpm` |
| **龙芯 LoongArch** | 暂未官方编译,可联系企业咨询自行编译 |

## 升级

SkylerX **内置自动更新**(基于 electron-updater)。打开应用后自动检测新版,提示用户下载安装。

如需禁用,在 `Settings → 更新` 中关闭"自动检查更新"。

## 历史版本

[在 GitHub Releases 查看所有版本 →](https://github.com/duhbbx/SkylerX/releases)

## 校验安装包

每个 Release 附 `SHA256SUMS.txt`,下载后校验:

```bash
# macOS / Linux
shasum -a 256 SkylerX-0.5.0-arm64.dmg
# 或对比 Releases 页面 SHA256SUMS.txt 里的值

# Windows PowerShell
Get-FileHash SkylerX-0.5.0-x64-setup.exe -Algorithm SHA256
```

## 遇到问题?

- **国内 GitHub 慢**:本页默认会自动切到阿里云 OSS 镜像(顶部切换器);或用 `https://github.akams.cn/` 等加速镜像替换 GitHub URL 前缀
- **OSS 镜像也慢 / 下载中断**:点顶部"🌐 GitHub" 切回原源,或直接访问 <https://skylerx-build.oss-cn-shanghai.aliyuncs.com/releases/latest/> 用下载工具(IDM / Aria2 等)续传
- **安装失败**:见 [排错文档 →](/docs/troubleshooting)
- **macOS 提示"无法验证开发者"**:右键应用 → 打开 → 确认打开;或在`系统设置 → 隐私与安全`点"仍要打开"

## 许可证

[Apache License 2.0](https://github.com/duhbbx/SkylerX/blob/main/LICENSE) — 桌面端完全开源,商业使用免费。
