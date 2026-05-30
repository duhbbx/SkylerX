#!/usr/bin/env bash
# 一键发布官网到 skylerx.skyler.uno (101.132.20.134)
#
# 用法:
#   apps/website/deploy.sh
# 或从根目录:
#   bash apps/website/deploy.sh
#
# 前置:
#   - 已 brew install sshpass(或换用 ssh-key 免密)
#   - 环境变量 SSHPASS 写好服务器 root 密码(或下方 read -s 输入)
#
# rsync --chmod 把文件统一改成 644/755,避免 macOS 默认 600 让 nginx 403。

set -euo pipefail

HOST=${SKYLERX_DEPLOY_HOST:-101.132.20.134}
USER=${SKYLERX_DEPLOY_USER:-root}
WEBROOT=${SKYLERX_DEPLOY_WEBROOT:-/var/www/skylerx.skyler.uno}
DOMAIN=${SKYLERX_DEPLOY_DOMAIN:-skylerx.skyler.uno}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "▶ 1/3 构建产物..."
pnpm --filter @db-tool/website build

DIST="$SCRIPT_DIR/.vitepress/dist"
if [ ! -d "$DIST" ]; then
  echo "❌ 构建产物目录不存在: $DIST" >&2
  exit 1
fi
SIZE=$(du -sh "$DIST" | awk '{print $1}')
echo "▶ 产物大小: $SIZE"

if [ -z "${SSHPASS:-}" ]; then
  read -rsp "▶ 输入 $USER@$HOST 密码: " SSHPASS
  echo
fi
export SSHPASS

echo "▶ 2/3 rsync 同步到 $USER@$HOST:$WEBROOT/ ..."
# macOS 自带 rsync 不支持 --chmod=D/F 语法,改成传完后服务器端统一 chmod。
sshpass -e rsync -avz --delete \
  -e "ssh -o StrictHostKeyChecking=accept-new" \
  "$DIST/" "$USER@$HOST:$WEBROOT/"

echo "▶ 3/3 服务器侧:归一所有者 + 权限 + reload nginx..."
sshpass -e ssh -o StrictHostKeyChecking=accept-new "$USER@$HOST" "
  chown -R www-data:www-data $WEBROOT &&
  find $WEBROOT -type d -exec chmod 755 {} \; &&
  find $WEBROOT -type f -exec chmod 644 {} \; &&
  nginx -t && nginx -s reload && echo OK
"

echo ""
echo "✅ 部署完成"
echo "   https://$DOMAIN  (DNS 已生效 + 已签 SSL 时)"
echo "   http://$DOMAIN   (HTTP 兜底)"
