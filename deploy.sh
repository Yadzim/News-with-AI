#!/usr/bin/env bash
# Serverda: cd /var/www/news-bot && ./deploy.sh
# Kod allaqachon yangilangan bo‘lishi mumkin; pull shu yerda ham qilinadi.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BOT_SVC="${SERVICE_BOT:-news-bot}"
ADMIN_SVC="${SERVICE_ADMIN:-news-admin}"

# tsx + esbuild yuklanishi sekin serverda ~20 soniya olishi mumkin, shuning
# uchun xizmat shu muddat davomida barqaror turgani kuzatiladi
STARTUP_GRACE_SECONDS="${STARTUP_GRACE_SECONDS:-30}"
# Admin API portni band qilishini kutish muddati
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-60}"
POLL_INTERVAL_SECONDS=2

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
  local value
  value="$(systemctl show -p NRestarts --value "$1" 2>/dev/null || true)"
  # Raqam bo‘lmasa (eski systemd, xizmat yo‘q) 0 deb hisoblaymiz
  [[ "$value" =~ ^[0-9]+$ ]] && echo "$value" || echo 0
}

dump_failure() {
  local svc="$1"
  # `status -n 40` jurnalning oxirgi 40 qatorini ham ko‘rsatadi
  "${SUDO[@]}" systemctl --no-pager -l -n 40 status "$svc" || true

  # sudoers'da odatda faqat systemctl NOPASSWD bo‘ladi, shuning uchun
  # journalctl'ni avval sudosiz, keyin sudo bilan sinaymiz
  echo "--- journalctl -u $svc -n 40 ---"
  journalctl -u "$svc" -n 40 --no-pager 2>/dev/null ||
    "${SUDO[@]}" journalctl -u "$svc" -n 40 --no-pager 2>/dev/null ||
    echo "(journalctl o‘qib bo‘lmadi — serverda: sudo journalctl -u $svc -n 40)"
}

read_port() {
  local port
  port="$(sed -n 's/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*\([0-9]\+\).*/\1/p' .env 2>/dev/null | tail -1)"
  echo "${port:-8787}"
}

admin_is_healthy() {
  curl -fsS --max-time 3 "http://127.0.0.1:$(read_port)/api/health" >/dev/null 2>&1
}

# Xizmat yiqilgan yoki crash-loopga tushgan bo‘lsa 1 qaytaradi
service_broken() {
  local svc="$1" baseline="$2"

  if [[ "$(restart_count "$svc")" -gt "$baseline" ]]; then
    echo "ERROR: $svc qayta-qayta yiqilyapti (NRestarts $baseline dan oshdi)"
    return 1
  fi

  if ! systemctl is-active --quiet "$svc"; then
    echo "ERROR: $svc ishga tushmadi"
    return 1
  fi

  return 0
}

restart_svc() {
  local svc="$1"
  local health_gate="${2:-no}"
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

  # NRestarts stop/start'da nolga qaytadi — bazani start'dan KEYIN olamiz,
  # aks holda eski qayta ishga tushishlar tarixi sog‘lom deploy'ni yiqitardi
  sleep "$POLL_INTERVAL_SECONDS"
  local baseline
  baseline="$(restart_count "$svc")"

  # Qat’iy `sleep` o‘rniga polling: sekin serverda ham yetarli kutamiz,
  # yiqilishni esa darhol ushlaymiz
  local deadline=$STARTUP_GRACE_SECONDS
  [[ "$health_gate" == "health" ]] && deadline=$HEALTH_TIMEOUT_SECONDS

  local elapsed=0
  while [[ "$elapsed" -lt "$deadline" ]]; do
    if ! service_broken "$svc" "$baseline"; then
      dump_failure "$svc"
      exit 1
    fi

    # Admin API port'ni band qilsa — kutishni davom ettirmaymiz
    if [[ "$health_gate" == "health" ]] && admin_is_healthy; then
      echo "$svc OK (health $(read_port) portda javob berdi, ${elapsed}s)"
      return 0
    fi

    sleep "$POLL_INTERVAL_SECONDS"
    elapsed=$((elapsed + POLL_INTERVAL_SECONDS))
  done

  if [[ "$health_gate" == "health" ]]; then
    echo "ERROR: $svc $(read_port) portda ${deadline}s ichida javob bermadi"
    dump_failure "$svc"
    exit 1
  fi

  echo "$svc OK (${deadline}s barqaror)"
}

restart_svc "$BOT_SVC"
restart_svc "$ADMIN_SVC" health
echo "==> deploy OK"
