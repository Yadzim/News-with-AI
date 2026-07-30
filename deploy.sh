#!/usr/bin/env bash
# Serverda: cd /var/www/news-bot && ./deploy.sh
# Kod allaqachon yangilangan bo‘lishi mumkin; pull shu yerda ham qilinadi.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BOT_SVC="${SERVICE_BOT:-news-bot}"
ADMIN_SVC="${SERVICE_ADMIN:-news-admin}"

echo "==> git sync"
git fetch origin main
git reset --hard origin/main

echo "==> dependencies"
if [[ -d node_modules ]] && git diff --quiet HEAD@{1} HEAD -- package-lock.json package.json 2>/dev/null; then
  echo "npm ci skip"
else
  npm ci --omit=dev
fi

# sudo parol so‘rasa darhol fail (Actions’da osilib qolmasin)
SUDO=(sudo -n)

restart_svc() {
  local svc="$1"
  echo "==> restart $svc"

  # stop uzoq kutmasin
  "${SUDO[@]}" systemctl stop "$svc" >/dev/null 2>&1 || true

  # hali tirik bo‘lsa majburiy o‘chirish
  if systemctl is-active --quiet "$svc" 2>/dev/null; then
    echo "force kill $svc"
    "${SUDO[@]}" systemctl kill -s SIGKILL "$svc" >/dev/null 2>&1 || true
    sleep 1
  fi

  "${SUDO[@]}" systemctl start "$svc"
  sleep 1

  if ! systemctl is-active --quiet "$svc"; then
    echo "ERROR: $svc active emas"
    "${SUDO[@]}" systemctl --no-pager -l status "$svc" || true
    exit 1
  fi
  echo "$svc OK"
}

restart_svc "$BOT_SVC"
restart_svc "$ADMIN_SVC"
echo "==> deploy OK"
