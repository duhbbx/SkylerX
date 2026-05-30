# Install & Upgrade

## macOS

Download the `.dmg` → double-click to mount → drag SkylerX to Applications → eject the disk.

First launch may say "developer cannot be verified":
1. Right-click SkylerX → Open → confirm "Open"
2. Or go to `System Settings → Privacy & Security → Open Anyway`

### Apple Silicon vs Intel

The download page detects your CPU and recommends arm64 when applicable. The x64 build still works on M-series Macs through Rosetta, but the arm64 native build is faster and uses less memory.

## Windows

Download the `.exe` installer → double-click → click through.

**SmartScreen prompt**: click "More info → Run anyway".

### x64 vs arm64

x64 runs on every Windows machine; arm64 targets Surface Pro X / Snapdragon laptops to avoid the power overhead of x64 emulation.

## Linux

### AppImage (no install, good for one-off use)

```bash
chmod +x SkylerX-0.5.0-x64.AppImage
./SkylerX-0.5.0-x64.AppImage
```

### .deb (Debian / Ubuntu / UnionTech UOS / Ubuntu Kylin / Deepin)

```bash
sudo dpkg -i SkylerX-0.5.0-amd64.deb
# If dependencies are missing:
sudo apt-get install -f
```

### .rpm (Fedora / openEuler / Kylin / Red Flag / NeoKylin)

```bash
sudo rpm -ivh SkylerX-0.5.0-x86_64.rpm
# Or with dnf
sudo dnf install ./SkylerX-0.5.0-x86_64.rpm
```

### .pacman (Arch Linux / Manjaro)

```bash
sudo pacman -U SkylerX-0.5.0-x86_64.pacman
```

### .tar.gz (other distros)

```bash
tar -xzf SkylerX-0.5.0-x64.tar.gz
cd SkylerX-0.5.0
./skylerx
# Optional: create a desktop shortcut
```

## Auto-update

SkylerX bundles `electron-updater` and checks for updates on launch:

1. Downloads silently in the background
2. Prompts "Restart to finish update" when ready
3. User clicks to apply the new version

**To disable**: `Settings → Updates → uncheck "Automatic update check"`, or launch with `SKYLERX_DISABLE_AUTOUPDATE=1`.

## Where local data lives

SkylerX's local config store (SQLite) lives in the OS standard user-data directory:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/@db-tool/desktop/db-tool.db` |
| Windows | `%APPDATA%\@db-tool\desktop\db-tool.db` |
| Linux | `~/.config/@db-tool/desktop/db-tool.db` |

It holds:
- Connection configs (passwords encrypted via OS keychain)
- SQL query history
- SQL snippets
- Favorites
- AI memory
- User preferences

**Backup tip**: periodically copy the whole `@db-tool/desktop` directory to OneDrive / iCloud / NAS.

## Uninstall

### macOS
Drag SkylerX to the Trash → optionally clean up `~/Library/Application Support/@db-tool/`

### Windows
Control Panel → Programs & Features → SkylerX → Uninstall → optionally clean up `%APPDATA%\@db-tool\`

### Linux
```bash
sudo apt remove skylerx        # if installed via .deb
sudo rpm -e skylerx            # if installed via .rpm
rm -f ~/.config/@db-tool       # config (optional)
```

## Upgrading

In-app auto-update → restart. Or download the new installer and install over the top. **Local config is preserved**, releases are forward-compatible.

## Chinese-vendor environments

Supported Chinese operating systems:

- **Kylin / NeoKylin**: prefer `.rpm`
- **UnionTech UOS**: prefer `.deb`
- **Ubuntu Kylin**: prefer `.deb`
- **openEuler**: prefer `.rpm`
- **Deepin**: prefer `.deb`

**Loongson LoongArch / Phytium**: no official build yet — for enterprise needs reach out via [Business inquiries](mailto:duhbbx@gmail.com) for a custom build.
