# macOS 签名 + 公证（Developer ID 直接分发）

SkylerX 走 GitHub/OSS **直接分发**（非 App Store），需要 **Developer ID Application 签名 + Apple 公证**，
这样用户下载后不用 `xattr -cr`。打包/CI 已全部接好（`apps/desktop/electron-builder.yml` 的
`hardenedRuntime`/`entitlements`/`identity: null` 兜底；`.github/workflows/build-desktop.yml` 在
5 个 secret 齐全时覆盖 identity + 开公证）。**只需配齐 5 个 GitHub Secret，打 tag 即自动签名+公证。**

## 需要的 5 个 GitHub Secret

| Secret 名 | 含义 |
|---|---|
| `APPLE_CSC_LINK` | Developer ID 证书 `.p12` 的 base64 |
| `APPLE_CSC_KEY_PASSWORD` | 导出 `.p12` 时设的密码 |
| `APPLE_ID` | Apple ID 邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | App 专用密码（appleid.apple.com 生成，非登录密码） |
| `APPLE_TEAM_ID` | 10 位 Team ID |

## 一、创建并导出证书（需 Apple 登录，本地操作）

1. **创建 Developer ID Application 证书**（注意不是「Apple Distribution」，那是上架用的）：
   - Xcode：`Settings → Accounts → 选团队 → Manage Certificates → ＋ → Developer ID Application`
   - 或 developer.apple.com → Certificates → ＋ → Developer ID Application（用「钥匙串访问 → 证书助理 → 从证书颁发机构请求证书」生成 CSR 上传，下载 .cer 双击装入钥匙串）
2. 验证已装入：`security find-identity -v -p codesigning`（应出现 `Developer ID Application: … (TEAMID)`）
3. **钥匙串访问** → 找到该证书 → 右键 **导出** → 存 `.p12` → 设密码（= `APPLE_CSC_KEY_PASSWORD`，连私钥一起导出）
4. base64：`base64 -i ~/Desktop/Cert.p12`（= `APPLE_CSC_LINK`）

## 二、App 专用密码 + Team ID（需 Apple 登录）

- App 专用密码：https://appleid.apple.com → 登录与安全 → App 专用密码 → 生成（形如 `abcd-efgh-ijkl-mnop`）
- Team ID：developer.apple.com → Membership → Team ID（10 位，如 `ABCDE12345`）

## 三、配置 GitHub Secret（gh 已登录可直接跑）

```bash
gh secret set APPLE_CSC_LINK --body "$(base64 -i ~/Desktop/Cert.p12)"
gh secret set APPLE_CSC_KEY_PASSWORD       # 交互输入，密码不入命令历史
gh secret set APPLE_ID
gh secret set APPLE_APP_SPECIFIC_PASSWORD
gh secret set APPLE_TEAM_ID
gh secret list | grep APPLE                # 确认 5 个都在
```

## 四、触发 + 验证

- 照常打 tag 发版：`git checkout main && git merge dev --ff-only && git push && git tag vX.Y.Z && git push --tags && git checkout dev`
- CI 日志出现 `mac signing & notarize enabled (teamId=…)` 即说明走了签名公证分支
- 下载 dmg 装好后验证：
  ```bash
  spctl -a -vvv -t install /Applications/SkylerX.app
  # 期望：accepted  source=Notarized Developer ID
  codesign -dv --verbose=4 /Applications/SkylerX.app   # 看 Authority=Developer ID Application
  ```

## 排错

- 公证失败看日志：`xcrun notarytool log <submission-id> --apple-id … --team-id … --password …`
- 常见原因：某个 `.node`/二进制没签（electron-builder 默认会签所有可执行；自定义原生模块注意）；entitlements 缺 `com.apple.security.cs.allow-jit`（Electron 需要，已在 `build/entitlements.mac.plist`）。
- 证书一年过期，到期重导 `.p12` 重设 `APPLE_CSC_LINK` 即可，CI 其余不动。
