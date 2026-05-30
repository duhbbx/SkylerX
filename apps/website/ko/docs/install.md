# 설치 및 업그레이드

## macOS

`.dmg` 다운로드 → 더블 클릭하여 마운트 → SkylerX 를 Applications 로 드래그 → 디스크 추출.

첫 실행 시 "개발자를 확인할 수 없음" 경고가 나타날 수 있습니다.
1. SkylerX 우클릭 → 열기 → 다이얼로그에서 "열기" 선택
2. 또는 `시스템 설정 → 개인정보 및 보안 → 이대로 열기`

### Apple Silicon vs Intel

다운로드 페이지가 자동으로 감지하여 arm64 버전을 권장합니다. Mac 에 Rosetta 가 설치되어 있다면 x64 버전도 사용 가능하지만, arm64 가 네이티브로 더 빠르고 메모리 사용량이 적습니다.

## Windows

`.exe` 설치 마법사 다운로드 → 더블 클릭하여 실행 → 계속 Next 클릭.

**SmartScreen 경고**: "추가 정보 → 실행" 클릭.

### x64 vs arm64

x64 는 모든 Windows 머신과 호환됩니다. arm64 는 Surface Pro X / Qualcomm Snapdragon 노트북용으로, x64 에뮬레이션으로 인한 전력 소모를 피할 수 있습니다.

## Linux

### AppImage(설치 불필요, 임시 사용에 적합)

```bash
chmod +x SkylerX-0.5.0-x64.AppImage
./SkylerX-0.5.0-x64.AppImage
```

### .deb(Debian / Ubuntu / 统信 UOS / 优麒麟 / Deepin)

```bash
sudo dpkg -i SkylerX-0.5.0-amd64.deb
# 의존성 문제가 있을 경우:
sudo apt-get install -f
```

### .rpm(Fedora / openEuler / 银河麒麟 / 红旗 / 中标麒麟)

```bash
sudo rpm -ivh SkylerX-0.5.0-x86_64.rpm
# 또는 dnf 사용
sudo dnf install ./SkylerX-0.5.0-x86_64.rpm
```

### .pacman(Arch Linux / Manjaro)

```bash
sudo pacman -U SkylerX-0.5.0-x86_64.pacman
```

### .tar.gz(기타 배포판)

```bash
tar -xzf SkylerX-0.5.0-x64.tar.gz
cd SkylerX-0.5.0
./skylerx
# 선택: 데스크톱 바로가기 생성
```

## 자동 업데이트

SkylerX 는 `electron-updater` 가 내장되어 있어 실행 시 자동으로 새 버전을 확인합니다.

1. 백그라운드에서 무음 다운로드
2. 다운로드 완료 후 "업데이트 완료를 위해 앱 재시작" 안내
3. 사용자가 클릭하면 새 버전 적용

**자동 업데이트 끄기**: `Settings → 업데이트 → "자동으로 업데이트 확인" 해제` 또는 환경 변수 `SKYLERX_DISABLE_AUTOUPDATE=1` 로 실행.

## 데이터 저장 위치

SkylerX 의 로컬 설정 저장소(SQLite)는 OS 표준 사용자 데이터 디렉터리에 저장됩니다.

| 플랫폼 | 경로 |
|---|---|
| macOS | `~/Library/Application Support/@db-tool/desktop/db-tool.db` |
| Windows | `%APPDATA%\@db-tool\desktop\db-tool.db` |
| Linux | `~/.config/@db-tool/desktop/db-tool.db` |

저장 내용:
- 연결 설정(비밀번호는 OS 키체인으로 암호화)
- SQL 쿼리 이력
- SQL 스니펫 라이브러리
- 즐겨찾기
- AI 메모리
- 사용자 환경 설정

**백업 권장**: `@db-tool/desktop` 디렉터리 전체를 정기적으로 OneDrive / iCloud / NAS 에 복사.

## 제거

### macOS
SkylerX 를 휴지통으로 드래그 → 선택적으로 `~/Library/Application Support/@db-tool/` 정리

### Windows
제어판 → 프로그램 및 기능 → SkylerX → 제거 → 선택적으로 `%APPDATA%\@db-tool\` 정리

### Linux
```bash
sudo apt remove skylerx        # .deb 로 설치한 경우
sudo rpm -e skylerx            # .rpm 으로 설치한 경우
rm -f ~/.config/@db-tool       # 설정(선택)
```

## 업그레이드

앱 내 자동 업데이트 → 재시작하면 완료. 새 버전 설치 패키지를 수동으로 다운로드하여 덮어쓰기 설치할 수도 있습니다. **설정 저장소는 보존**되며 버전 간 호환됩니다.

## 중국 국산 신촹 환경

다음 중국 국산 운영 체제에 대응합니다.

- **银河麒麟 / 中标麒麟**: `.rpm` 권장
- **统信 UOS**: `.deb` 권장
- **Ubuntu Kylin 优麒麟**: `.deb` 권장
- **openEuler**: `.rpm` 권장
- **Deepin**: `.deb` 권장

**龙芯 LoongArch / 飞腾**: 공식 빌드는 아직 제공하지 않습니다. 필요하시면 [엔터프라이즈 협력](mailto:duhbbx@gmail.com)을 통해 커스텀 빌드를 받을 수 있습니다.
