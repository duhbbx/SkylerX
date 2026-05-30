---
title: SkylerX 다운로드
description: 모든 플랫폼 설치 패키지(macOS / Windows / Linux), x64 + arm64 멀티 아키텍처
---

# SkylerX 다운로드

<DownloadButton />

::: tip 다운로드 소스 자동 선택
중국 본토 / 홍콩·마카오에서 접속하면 자동으로 **알리바바 클라우드 OSS 미러**(상하이 노드) 직접 링크를 사용합니다. GitHub보다 훨씬 빠릅니다. 해외 사용자는 **GitHub Releases** 를 사용합니다. 아래 매트릭스 상단에서 언제든 수동으로 전환할 수 있으며, 선택은 기억됩니다.
:::

<DownloadMatrix />

## 시스템 요구 사항

| 플랫폼 | 최소 버전 | 권장 |
|---|---|---|
| **macOS** | 10.13(High Sierra) | 12+(Monterey 이상) |
| **Windows** | 10 | 11 |
| **Linux** | glibc 2.28+(Ubuntu 20.04 / Debian 11 / CentOS 8 등 동시기) | Ubuntu 22.04+ |

**아키텍처**: x64(Intel / AMD) 와 arm64(Apple Silicon / ARM 서버 / Surface Pro X) 듀얼 아키텍처 지원.

## 중국 국산 신촹 환경

다음 중국 국산 운영 체제에 대응합니다(`.deb` / `.rpm` / `.AppImage` 사용):

| 시스템 | 권장 포맷 |
|---|---|
| **银河麒麟 (Kylin)** / **中标麒麟** | `.rpm` |
| **统信 UOS** | `.deb` |
| **Ubuntu Kylin** / **优麒麟** | `.deb` |
| **openEuler** | `.rpm` |
| **Deepin** | `.deb` |
| **红旗 Linux** | `.rpm` |
| **龙芯 LoongArch** | 공식 빌드 미제공, 엔터프라이즈 문의를 통해 자체 빌드 가능 |

## 업그레이드

SkylerX 는 **자동 업데이트가 내장되어** 있습니다(electron-updater 기반). 앱 실행 시 자동으로 새 버전을 감지하고, 사용자에게 다운로드 및 설치를 안내합니다.

비활성화하려면 `Settings → 업데이트` 에서 "자동으로 업데이트 확인"을 해제하세요.

::: warning Windows 사용자 — v0.5.0-rc1 / rc2 에서 rc3+ 로 업그레이드하려면 한 번 수동 작업이 필요합니다
구 버전(rc1/rc2)의 updater는 `publisherName` 을 엄격히 검증하지만, v0.5.0-rc3 부터는 일시적으로 서명 검증이 제거되어 있습니다(SignPath Foundation 승인 대기 중). 따라서 자동 업데이트가 `not signed by the application owner` 오류를 보고합니다.

**일회성 수동 작업**: 아래 표에서 해당 플랫폼의 rc3+ setup.exe 또는 portable.exe 를 다운로드하여 덮어쓰기 설치하세요(설정은 보존됩니다). 이후로는 자동 업데이트가 정상 동작합니다.

SignPath Foundation 승인 후에는 EV 서명 + 엄격한 검증이 복원되며, 더 이상 수동 단계가 필요하지 않습니다.
:::

## 과거 버전

[GitHub Releases 에서 모든 버전 보기 →](https://github.com/duhbbx/SkylerX/releases)

## 코드 서명 / Code Signing

Windows 설치 패키지는 **[SignPath Foundation](https://signpath.org/)** 에 의해 디지털 서명됩니다 — 오픈 소스 프로젝트에 무상으로 코드 서명을 제공하는 비영리 단체입니다.

> Code signing for this project is provided by the [SignPath Foundation](https://signpath.org/), free of charge.

This means:
- Windows users won't see SmartScreen "unknown publisher" warnings
- The installer's authenticity can be verified through standard certificate chain checks
- `electron-updater` enforces publisher name matching on every update

The Foundation issues an EV (Extended Validation) code-signing certificate to qualifying open-source projects. SkylerX is grateful for their support of the open-source community.

## 설치 패키지 검증

각 Release 에는 `SHA256SUMS.txt` 가 첨부되어 있어, 다운로드 후 검증할 수 있습니다.

```bash
# macOS / Linux
shasum -a 256 SkylerX-0.5.0-arm64.dmg
# 또는 Releases 페이지의 SHA256SUMS.txt 값과 비교

# Windows PowerShell
Get-FileHash SkylerX-0.5.0-x64-setup.exe -Algorithm SHA256
```

## 문제가 있나요?

- **중국 내 GitHub 가 느림**: 이 페이지는 기본적으로 알리바바 클라우드 OSS 미러(상단 스위처)로 자동 전환됩니다. 또는 `https://github.akams.cn/` 등의 가속 미러로 GitHub URL 접두사를 교체할 수 있습니다
- **OSS 미러도 느림 / 다운로드 중단**: 상단 "🌐 GitHub" 클릭으로 원본 소스로 돌리거나, <https://skylerx-build.oss-cn-shanghai.aliyuncs.com/releases/latest/> 에 직접 접근하여 다운로드 도구(IDM / Aria2 등)로 이어받기 하세요
- **설치 실패**: [트러블슈팅 문서 →](/ko/docs/troubleshooting) 참고
- **macOS 에서 "개발자를 확인할 수 없음" 안내**: 앱 우클릭 → 열기 → 확인하여 열기, 또는 `시스템 설정 → 개인정보 및 보안` 에서 "이대로 열기" 클릭

## 라이선스

[Apache License 2.0](https://github.com/duhbbx/SkylerX/blob/main/LICENSE) — 데스크톱 클라이언트는 완전 오픈 소스이며, 상업적 사용도 무료입니다.
