# 安装与升级

## macOS

下载 `.dmg` → 双击挂载 → 把 SkylerX 拖到 Applications → 弹出磁盘。

首次启动可能提示"无法验证开发者":
1. 右键 SkylerX → 打开 → 弹框选"打开"
2. 或 `系统设置 → 隐私与安全 → 仍要打开`

### Apple Silicon vs Intel

下载页会自动检测推荐 arm64 版本。若你的 Mac 装了 Rosetta 也可用 x64 版,但 arm64 原生更快、内存占用更低。

## Windows

下载 `.exe` 安装向导 → 双击运行 → 一路 Next。

**SmartScreen 提示**:点"更多信息 → 仍要运行"。

### x64 vs arm64

x64 兼容所有 Windows 机器;arm64 给 Surface Pro X / 高通骁龙笔记本用,可避免 x64 模拟带来的耗电。

## Linux

### AppImage(免安装,适合临时使用)

```bash
chmod +x SkylerX-0.5.0-x64.AppImage
./SkylerX-0.5.0-x64.AppImage
```

### .deb(Debian / Ubuntu / 统信 UOS / 优麒麟 / Deepin)

```bash
sudo dpkg -i SkylerX-0.5.0-amd64.deb
# 若有依赖问题:
sudo apt-get install -f
```

### .rpm(Fedora / openEuler / 银河麒麟 / 红旗 / 中标麒麟)

```bash
sudo rpm -ivh SkylerX-0.5.0-x86_64.rpm
# 或用 dnf
sudo dnf install ./SkylerX-0.5.0-x86_64.rpm
```

### .pacman(Arch Linux / Manjaro)

```bash
sudo pacman -U SkylerX-0.5.0-x86_64.pacman
```

### .tar.gz(其它发行版)

```bash
tar -xzf SkylerX-0.5.0-x64.tar.gz
cd SkylerX-0.5.0
./skylerx
# 可选:创建桌面快捷方式
```

## 自动更新

SkylerX 自带 `electron-updater`,启动后会自动检查新版:

1. 后台静默下载
2. 下载完成提示"重启应用以完成更新"
3. 用户点击即应用新版本

**关闭自动更新**:`Settings → 更新 → 取消"自动检查更新"` 或环境变量 `SKYLERX_DISABLE_AUTOUPDATE=1` 启动。

## 数据存放位置

SkylerX 的本地配置库(SQLite)存放在 OS 标准用户数据目录:

| 平台 | 路径 |
|---|---|
| macOS | `~/Library/Application Support/@db-tool/desktop/db-tool.db` |
| Windows | `%APPDATA%\@db-tool\desktop\db-tool.db` |
| Linux | `~/.config/@db-tool/desktop/db-tool.db` |

里面存:
- 连接配置(密码经 OS 钥匙串加密)
- SQL 查询历史
- SQL 片段库
- 收藏夹
- AI 记忆
- 用户偏好设置

**备份建议**:定期把整个 `@db-tool/desktop` 目录复制到 OneDrive / iCloud / NAS。

## 卸载

### macOS
拖 SkylerX 到废纸篓 → 可选清理 `~/Library/Application Support/@db-tool/`

### Windows
控制面板 → 程序与功能 → SkylerX → 卸载 → 可选清理 `%APPDATA%\@db-tool\`

### Linux
```bash
sudo apt remove skylerx        # .deb 装的
sudo rpm -e skylerx            # .rpm 装的
rm -f ~/.config/@db-tool       # 配置(可选)
```

## 升级

App 内自动更新 → 重启即可。也可以手动下载新版安装包覆盖安装。**配置库不会丢**,跨版本兼容。

## 国产信创环境

适配以下国产操作系统:

- **银河麒麟 / 中标麒麟**:推荐 `.rpm`
- **统信 UOS**:推荐 `.deb`
- **Ubuntu Kylin 优麒麟**:推荐 `.deb`
- **openEuler**:推荐 `.rpm`
- **Deepin**:推荐 `.deb`

**龙芯 LoongArch / 飞腾**:暂未提供官方编译,如有需求请[企业合作](mailto:duhbbx@gmail.com),可定制编译。
