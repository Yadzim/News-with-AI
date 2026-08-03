#!/usr/bin/env bash
# Serverda: cd /var/www/news-bot && ./deploy.sh
# Kod allaqachon yangilangan bo‘lishi mumkin; pull shu yerda ham qilinadi.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BOT_SVC="${SERVICE_BOT:-news-bot}"
ADMIN_SVC="${SERVICE_ADMIN:-news-admin}"

# tsx TypeScript’ni yuklashga bir necha soniya oladi — shuncha kutmasak,
# ishga tushib darrov yiqilgan xizmat ham "active" ko‘rinadi
STARTUP_GRACE_SECONDS="${STARTUP_GRACE_SECONDS:-8}"

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

restart_count() {
  systemctl show -p NRestarts --value "$1" 2>/dev/null || echo 0
}

dump_failure() {
  local svc="$1"
  "${SUDO[@]}" systemctl --no-pager -l status "$svc" || true
  echo "--- journalctl -u $svc -n 40 ---"
  "${SUDO[@]}" journalctl -u "$svc" -n 40 --no-pager || true
}

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

  local restarts_before
  restarts_before="$(restart_count "$svc")"

  "${SUDO[@]}" systemctl start "$svc"
  sleep "$STARTUP_GRACE_SECONDS"

  if ! systemctl is-active --quiet "$svc"; then
    echo "ERROR: $svc ishga tushmadi"
    dump_failure "$svc"
    exit 1
  fi

  # Restart=always tufayli yiqilgan xizmat ham qayta ko‘tarilib "active"
  # bo‘lishi mumkin — NRestarts o‘sgani crash-loop degani
  local restarts_after
  restarts_after="$(restart_count "$svc")"
  if [[ "$restarts_after" != "$restarts_before" ]]; then
    echo "ERROR: $svc qayta-qayta yiqilyapti (NRestarts: $restarts_before -> $restarts_after)"
    dump_failure "$svc"
    exit 1
  fi

  echo "$svc OK"
}

# Admin API haqiqatan javob berayotganini tekshiradi
check_admin_health() {
  local port
  port="$(sed -n 's/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*\([0-9]\+\).*/\1/p' .env 2>/dev/null | tail -1)"
  port="${port:-8787}"

  echo "==> health check (127.0.0.1:$port)"
  for attempt in 1 2 3 4 5; do
    if curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
      echo "health OK"
      return 0
    fi
    sleep 2
  done

  echo "ERROR: admin API ${port} portda javob bermayapti"
  dump_failure "$ADMIN_SVC"
  exit 1
}

restart_svc "$BOT_SVC"
restart_svc "$ADMIN_SVC"
check_admin_health
echo "==> deploy OK"
