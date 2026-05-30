#!/usr/bin/env bash
#
# 把 .github/labels.yml 同步到 GitHub 仓库的 Labels 列表.
# 幂等: 已存在的 label 会更新 color/description, 不存在的会创建.
# 不存在于 yml 的旧 label 默认保留(避免误删别人在 issue 上手动加的).
#   想删: 加 --prune
#
# 依赖:
#   - gh CLI (brew install gh) 已 auth (gh auth status)
#   - yq (brew install yq)
#
# 用法:
#   bash scripts/sync-github-labels.sh           # 创建/更新
#   bash scripts/sync-github-labels.sh --dry-run # 只打印不动 GitHub
#   bash scripts/sync-github-labels.sh --prune   # 同时删除 yml 里没列的
#   REPO=duhbbx/SkylerX bash scripts/sync-github-labels.sh

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

REPO=${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}
YML=".github/labels.yml"
DRY=0
PRUNE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --prune)   PRUNE=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

command -v gh >/dev/null || { echo "❌ gh CLI 未安装: brew install gh" >&2; exit 1; }
command -v yq >/dev/null || { echo "❌ yq 未安装: brew install yq" >&2; exit 1; }

echo "▶ Repo:   $REPO"
echo "▶ YML:    $YML"
[ $DRY -eq 1 ]   && echo "▶ Mode:   DRY RUN (不实际改 GitHub)"
[ $PRUNE -eq 1 ] && echo "▶ Prune:  ON (删除 yml 里没列的 label)"
echo ""

# ── 1. 读 yml 里期望的 labels ──
DESIRED_NAMES=$(yq -r '.[].name' "$YML")
TOTAL=$(echo "$DESIRED_NAMES" | wc -l | tr -d ' ')
echo "▶ Desired: $TOTAL labels"

# ── 2. 拿 GitHub 现有 labels ──
EXISTING=$(gh label list --repo "$REPO" --limit 300 --json name,color,description)

# ── 3. 逐个 upsert ──
CREATED=0
UPDATED=0
UNCHANGED=0
i=0
yq -o=json '.' "$YML" | jq -c '.[]' | while read -r row; do
  i=$((i + 1))
  name=$(echo "$row" | jq -r '.name')
  color=$(echo "$row" | jq -r '.color')
  desc=$(echo "$row" | jq -r '.description')

  cur=$(echo "$EXISTING" | jq -r --arg n "$name" '.[] | select(.name==$n)')
  if [ -z "$cur" ]; then
    # 不存在 → create
    printf "  [%2d/%d] %-30s CREATE  #%s\n" "$i" "$TOTAL" "$name" "$color"
    if [ $DRY -eq 0 ]; then
      gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" --force >/dev/null
    fi
  else
    curColor=$(echo "$cur" | jq -r '.color')
    curDesc=$(echo "$cur" | jq -r '.description // ""')
    if [ "$curColor" != "$color" ] || [ "$curDesc" != "$desc" ]; then
      printf "  [%2d/%d] %-30s UPDATE  #%s→#%s\n" "$i" "$TOTAL" "$name" "$curColor" "$color"
      if [ $DRY -eq 0 ]; then
        gh label edit "$name" --repo "$REPO" --color "$color" --description "$desc" >/dev/null
      fi
    else
      printf "  [%2d/%d] %-30s UNCHANGED\n" "$i" "$TOTAL" "$name"
    fi
  fi
done

# ── 4. 可选 prune ──
if [ $PRUNE -eq 1 ]; then
  echo ""
  echo "▶ Pruning labels not in yml ..."
  EXISTING_NAMES=$(echo "$EXISTING" | jq -r '.[].name')
  while IFS= read -r exist; do
    if ! echo "$DESIRED_NAMES" | grep -qx "$exist"; then
      echo "  DELETE  $exist"
      if [ $DRY -eq 0 ]; then
        gh label delete "$exist" --repo "$REPO" --yes >/dev/null
      fi
    fi
  done <<< "$EXISTING_NAMES"
fi

echo ""
echo "✅ Sync done"
