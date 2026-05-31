# Auto-Update — manual QA

Covers: in-app update check, download, install, GitHub / OSS-CN channel switching.

> Run when changing: `apps/desktop/src/main/updater.ts`, `apps/desktop/src/main/ipc/updates*`, `electron-builder.yml`, `scripts/sync-version.mjs`.

## Setup

- Branch / commit:
- OS:
- Currently installed version: <!-- About → version -->
- Target: a release version newer than installed

## Prerequisites for testing

To test auto-update, you need:
- An installed app at version N (older)
- A release published at version N+1

You can fake this by:
1. Building locally with `apps/desktop/package.json` set to `0.0.1`
2. Pointing updater to a test server that says latest = `0.0.2`

Or just test on a real release where you know an update exists (e.g. rcN → rcN+1).

## Channel selection

- [ ] Settings → "Update channel" — dropdown shows `GitHub` and `OSS-CN`
- [ ] Default for `Asia/Shanghai|Chongqing|Urumqi|Harbin` timezone: OSS-CN
- [ ] Default elsewhere: GitHub
- [ ] Manual switch persists across restart
- [ ] Evidence: screenshot of settings + persistence after restart

## Check for updates (no update available)

- [ ] Already on latest → click "Check for updates" → toast "You're up to date"
- [ ] Network down → red toast with **specific** error (host + status), not silent
- [ ] Evidence:

## Check for updates (update available)

- [ ] Older version installed → click "Check" → modal appears with new version + changelog
- [ ] "Download" button → progress bar with bytes / percent / speed
- [ ] During download, cancel button works → no partial install
- [ ] Evidence:

## Download + install

- [ ] Download completes → "Install and restart" button
- [ ] Click → app quits → installer / DMG runs → new version launches
- [ ] After relaunch, About → new version number
- [ ] Settings preserved (connections, AI keys, language)
- [ ] Evidence: screenshot of About before and after

## Per-OS specifics

### macOS
- [ ] DMG channel: zip artifact downloaded (required for electron-updater)
- [ ] Code signature verified (or warning if unsigned in dev)
- [ ] Gatekeeper does not block restart
- [ ] Evidence:

### Windows
- [ ] NSIS installer downloaded
- [ ] User Account Control (UAC) prompt appears if installer needs admin
- [ ] Both installer + portable channels respected
- [ ] Evidence:

### Linux
- [ ] AppImage / deb / rpm — for AppImage, electron-updater handles in-place replacement
- [ ] For deb / rpm — app shows "manual update required, see release page"
- [ ] Evidence:

## Channel switch behavior

- [ ] On GitHub channel, click Check → uses GitHub Releases API
  - [ ] Verify request URL is github.com (DevTools / Network)
- [ ] Switch to OSS-CN → click Check → uses Aliyun OSS endpoint
  - [ ] Verify request URL is `skylerx-build` bucket
- [ ] Switch back to GitHub mid-download → next check uses GitHub
- [ ] Evidence: paste request URLs

## Network failure scenarios

- [ ] GitHub channel + GitHub blocked (e.g. China without VPN) → red toast with **specific suggestion**: "switch to OSS-CN channel"
- [ ] OSS-CN channel + Aliyun unreachable → red toast with suggestion to switch to GitHub
- [ ] Both fail → user can manually download from release page (link offered)
- [ ] Evidence:

## Mid-session update

- [ ] App running, query in progress → updater notifies of new version
- [ ] User dismisses notification → query unaffected
- [ ] User clicks "Install now" → modal warns "queries will be cancelled"
- [ ] Confirm → app quits cleanly (no orphan processes)
- [ ] Evidence:

## Update logs panel

- [ ] About dialog → "Update logs" section → shows recent updater events
- [ ] Logs include: check / download / install / channel-switch with timestamps
- [ ] Errors highlighted red, with status code if HTTP
- [ ] Copy logs to clipboard button works (for bug reports)
- [ ] Evidence: screenshot

## Pre-release vs stable

- [ ] Stable channel: latest stable only (no -rc / -beta in candidate list)
- [ ] Pre-release channel: includes -rc / -beta
- [ ] App marks itself as on pre-release in About dialog when running -rcN
- [ ] Evidence:

## Force-kill safety during download

- [ ] Start downloading 50MB update → `pkill -9 Electron` mid-download
- [ ] Restart app → partial file detected, either resumed or discarded with toast
- [ ] No silent corruption (next "Install" must not run a partial DMG)
- [ ] Evidence:

## Known limitations

- macOS auto-update requires the app to be in `/Applications` (signed builds); running from a DMG mount point won't update
- Linux deb / rpm channels don't have true in-place update — UI tells user to download new package manually
- First-launch auto-update check happens after 30s delay (not immediate) — by design, not a bug
