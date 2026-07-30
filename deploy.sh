#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BOT_SVC="${SERVICE_BOT:-news-bot}"
ADMIN_SVC="${SERVICE_ADMIN:-news-admin}"

echo "==> git pull"
git pull origin main

# Faqat lock o‘zgaganda npm ci (tez deploy)
NEED_INSTALL=0
if [[ ! -d node_modules ]]; then
  NEED_INSTALL=1
elif ! git diff --quiet HEAD@{1} HEAD -- package-lock.json package.json 2>/dev/null; then
  NEED_INSTALL=1
fi

if [[ "$NEED_INSTALL" -eq 1 ]]; then
  echo "==> npm ci (dependencies o‘zgargan)"
  npm ci --omit=dev
else
  echo "==> npm ci skip (dependencies o‘zgarmagan)"
fi

echo "==> systemctl restart $BOT_SVC $ADMIN_SVC"
sudo systemctl restart "$BOT_SVC" "$ADMIN_SVC"

# status --full ba’zan osilib timeout beradi — faqat active tekshiramiz
sleep 1
sudo systemctl is-active "$BOT_SVC" "$ADMIN_SVC"
echo "==> deploy OK"
