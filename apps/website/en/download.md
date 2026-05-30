---
title: Download SkylerX
description: Installers for every platform (macOS / Windows / Linux), x64 + arm64
---

# Download SkylerX

<DownloadButton />

::: tip Mirror auto-selection
From mainland China / Hong Kong / Macau the page automatically picks the **Aliyun OSS mirror** (Shanghai region) — much faster than GitHub. Overseas users go through **GitHub Releases**. The switcher at the top of the matrix below lets you flip mirrors and remembers your choice.
:::

<DownloadMatrix />

## System requirements

| Platform | Minimum | Recommended |
|---|---|---|
| **macOS** | 10.13 (High Sierra) | 12+ (Monterey or newer) |
| **Windows** | 10 | 11 |
| **Linux** | glibc 2.28+ (Ubuntu 20.04 / Debian 11 / CentOS 8 era) | Ubuntu 22.04+ |

**Architectures**: x64 (Intel / AMD) and arm64 (Apple Silicon / ARM servers / Surface Pro X).

## Chinese-vendor compliance environments

The following Chinese operating systems are supported (use `.deb` / `.rpm` / `.AppImage`):

| OS | Recommended format |
|---|---|
| **Kylin** / **NeoKylin** | `.rpm` |
| **UnionTech UOS** | `.deb` |
| **Ubuntu Kylin** | `.deb` |
| **openEuler** | `.rpm` |
| **Deepin** | `.deb` |
| **Red Flag Linux** | `.rpm` |
| **Loongson LoongArch** | No official build yet — contact us for an enterprise build |

## Upgrading

SkylerX ships **built-in auto-update** (electron-updater). The app checks for new versions on launch and prompts you to download.

To disable, uncheck "Automatic update check" under `Settings → Updates`.

::: warning Windows users — upgrading from v0.5.0-rc1 / rc2 to rc3+ requires one manual step
The older updater in rc1/rc2 strictly verified `publisherName`. v0.5.0-rc3 temporarily removed signature verification (pending SignPath Foundation approval), so auto-update raises `not signed by the application owner`.

**One-time manual step**: download the rc3+ setup.exe or portable.exe for your platform from the matrix below and install over the top (your config is preserved). After that, auto-update works again.

Once SignPath Foundation approves the project, EV signing + strict verification will be restored and no manual step will be needed.
:::

## Older releases

[Browse all versions on GitHub Releases →](https://github.com/duhbbx/SkylerX/releases)

## Code signing

Windows installers are digitally signed via **[SignPath Foundation](https://signpath.org/)** — a nonprofit that provides free code signing for open-source projects.

> Code signing for this project is provided by the [SignPath Foundation](https://signpath.org/), free of charge.

This means:
- Windows users won't see SmartScreen "unknown publisher" warnings
- The installer's authenticity can be verified through standard certificate chain checks
- `electron-updater` enforces publisher name matching on every update

The Foundation issues an EV (Extended Validation) code-signing certificate to qualifying open-source projects. SkylerX is grateful for their support of the open-source community.

## Verifying installers

Each release ships with `SHA256SUMS.txt`. After downloading, verify with:

```bash
# macOS / Linux
shasum -a 256 SkylerX-0.5.0-arm64.dmg
# Then compare against the value in SHA256SUMS.txt on the Releases page

# Windows PowerShell
Get-FileHash SkylerX-0.5.0-x64-setup.exe -Algorithm SHA256
```

## Trouble downloading?

- **Slow GitHub access in China**: the page auto-switches to the Aliyun OSS mirror (top switcher); or use an accelerator like `https://github.akams.cn/` as a URL prefix
- **OSS mirror also slow / download cuts out**: click "🌐 GitHub" at the top to switch back to the original source, or visit <https://skylerx-build.oss-cn-shanghai.aliyuncs.com/releases/latest/> directly and use IDM / Aria2 etc. for resumable download
- **Install fails**: see [Troubleshooting →](/en/docs/troubleshooting)
- **macOS says "developer cannot be verified"**: right-click the app → Open → confirm; or go to `System Settings → Privacy & Security` and click "Open Anyway"

## License

[Apache License 2.0](https://github.com/duhbbx/SkylerX/blob/main/LICENSE) — the desktop client is fully open source, free for commercial use.
