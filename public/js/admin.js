const state = {
  page: 1,
  limit: 12,
  total: 0,
  busy: false,
  category: "all",
  posted: "all",
  categories: [],
  settingsOpen: false,
};

const $ = (id) => document.getElementById(id);
const tg = window.Telegram?.WebApp;

function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  try {
    tg.setHeaderColor("secondary_bg_color");
    tg.setBackgroundColor("bg_color");
  } catch {
    /* older clients */
  }

  const tp = tg.themeParams || {};
  const root = document.documentElement;
  if (tp.bg_color) root.style.setProperty("--bg", tp.bg_color);
  if (tp.secondary_bg_color) {
    root.style.setProperty("--bg-elevated", tp.secondary_bg_color);
    root.style.setProperty("--surface", tp.secondary_bg_color);
  }
  if (tp.text_color) root.style.setProperty("--text", tp.text_color);
  if (tp.hint_color) root.style.setProperty("--muted", tp.hint_color);
  if (tp.button_color) root.style.setProperty("--accent", tp.button_color);
  if (tp.button_text_color) {
    /* used via accent contrast already */
  }
  if (tp.link_color) root.style.setProperty("--accent", tp.link_color);

  tg.BackButton.onClick(() => {
    if (state.settingsOpen) closeSettings();
    else tg.close();
  });
}

function haptic(type = "light") {
  try {
    tg?.HapticFeedback?.impactOccurred?.(type);
  } catch {
    /* ignore */
  }
}

function getToken() {
  return localStorage.getItem("admin_token") || $("adminToken").value.trim();
}

function saveToken() {
  const token = $("adminToken").value.trim();
  if (token) localStorage.setItem("admin_token", token);
  else localStorage.removeItem("admin_token");
}

async function api(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  const token = getToken();
  if (token) headers["x-admin-token"] = token;

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setStatus(el, text, type = "") {
  el.textContent = text || "";
  el.className = `status ${type}`.trim();
}

function formatWhen(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("'", "&#39;");
}

function syncHiddenFilters() {
  $("filterCategory").value = state.category;
  $("filterPosted").value = state.posted;
}

function renderStats(stats) {
  $("statTotal").textContent = String(stats.total ?? "—");
  $("statPendingGroup").textContent = String(stats.pendingGroup ?? stats.pending ?? "—");
  $("statPendingChannel").textContent = String(stats.pendingChannel ?? "—");
}

function renderCategoryChips() {
  const root = $("categoryChips");
  const cats = ["all", ...state.categories];
  root.innerHTML = cats
    .map((cat) => {
      const label = cat === "all" ? "Hammasi" : cat;
      const active = state.category === cat ? "is-active" : "";
      return `<button type="button" class="chip ${active}" data-category="${escapeAttr(cat)}">${escapeHtml(label)}</button>`;
    })
    .join("");
}

function renderStatusChips() {
  document.querySelectorAll(".status-chip").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.posted === state.posted);
  });
}

function bulletsText(summary) {
  return (summary || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith("🔹") ? l : `🔹 ${l}`))
    .join("\n");
}

function siteNameFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const map = {
      "techcrunch.com": "TechCrunch",
      "theverge.com": "The Verge",
      "wired.com": "Wired",
      "news.ycombinator.com": "Hacker News",
      "hnrss.org": "Hacker News",
      "technologyreview.com": "MIT Tech Review",
      "thenextweb.com": "The Next Web",
    };
    return map[host] || host.split(".")[0]?.replace(/^\w/, (c) => c.toUpperCase()) || host;
  } catch {
    return "Manba";
  }
}

function renderNews(items) {
  const root = $("newsList");
  if (!items.length) {
    root.innerHTML = `<div class="empty">Bu filter bo‘yicha yangilik yo‘q</div>`;
    return;
  }

  root.innerHTML = items
    .map((item, i) => {
      const groupBadge = item.is_posted
        ? `<span class="badge posted">Guruh ✓</span>`
        : `<span class="badge pending">Guruh</span>`;
      const channelBadge = item.is_posted_channel
        ? `<span class="badge posted">Kanal ✓</span>`
        : `<span class="badge pending">Kanal</span>`;
      const summary = bulletsText(item.summary_uz);
      const site = siteNameFromUrl(item.source_url);
      return `
        <article class="news-card" style="animation-delay:${i * 40}ms" data-id="${item.id}">
          <div class="news-card-top">
            <h2>${escapeHtml(item.title_uz || item.title_original || "Nomsiz")}</h2>
          </div>
          <div class="meta">
            ${groupBadge}
            ${channelBadge}
            <span class="badge cat">${escapeHtml(item.category || "—")}</span>
            <span class="badge">${escapeHtml(formatWhen(item.published_at || item.created_at))}</span>
          </div>
          <p class="summary">${escapeHtml(summary)}</p>
          <button type="button" class="toggle-more" data-toggle="${item.id}">Ko‘proq o‘qish</button>
          <div class="card-footer">
            <a class="source-link" href="${escapeAttr(item.source_url)}" target="_blank" rel="noopener">
              <strong>${escapeHtml(site)}</strong>
              <span>· ochish</span>
            </a>
            <button type="button" class="btn-danger" data-del="${item.id}">O‘chirish</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function updatePager() {
  const pages = Math.max(1, Math.ceil(state.total / state.limit));
  $("pageInfo").textContent = `${state.page} / ${pages} · ${state.total} ta`;
  $("btnPrev").disabled = state.page <= 1 || state.busy;
  $("btnNext").disabled = state.page >= pages || state.busy;
}

async function loadMeta() {
  const meta = await api("/api/meta");
  state.categories = meta.categories || [];
  renderCategoryChips();
  renderStats(meta.stats || {});

  const sg = meta.schedule?.group || {};
  $("groupMorning").value = sg.morning || "08:00";
  $("groupEvening").value = sg.evening || "20:00";
  $("groupEnabled").checked = Boolean(sg.enabled);

  const sc = meta.schedule?.channel || {};
  $("channelMorning").value = sc.morning || "09:00";
  $("channelEvening").value = sc.evening || "21:00";
  $("channelEnabled").checked = Boolean(sc.enabled);

  const btnChannel = $("btnPublishChannel");
  if (btnChannel) {
    btnChannel.disabled = !meta.channelConfigured;
    btnChannel.title = meta.channelConfigured
      ? ""
      : "TELEGRAM_CHANNEL_ID sozlanmagan";
  }

  const select = $("filterCategory");
  select.innerHTML = `<option value="all">all</option>`;
  for (const cat of state.categories) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  }
  syncHiddenFilters();
}

async function loadNews() {
  syncHiddenFilters();
  $("newsList").innerHTML = `<div class="loading">Yuklanmoqda...</div>`;
  const params = new URLSearchParams({
    page: String(state.page),
    limit: String(state.limit),
    category: state.category,
    posted: state.posted,
    q: $("filterQ").value.trim(),
  });
  const data = await api(`/api/news?${params}`);
  state.total = data.total || 0;
  renderNews(data.items || []);
  updatePager();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function refreshAll() {
  saveToken();
  await loadMeta();
  await loadNews();
}

function withBusy(buttons, fn) {
  return async (...args) => {
    if (state.busy) return;
    state.busy = true;
    for (const b of buttons) if (b) b.disabled = true;
    try {
      await fn(...args);
    } finally {
      state.busy = false;
      for (const b of buttons) if (b) b.disabled = false;
      updatePager();
    }
  };
}

function openSettings() {
  state.settingsOpen = true;
  $("settingsOverlay").hidden = false;
  $("settingsPanel").classList.add("is-open");
  $("settingsPanel").setAttribute("aria-hidden", "false");
  document.body.classList.add("sheet-open");
  tg?.BackButton?.show?.();
  haptic("soft");
}

function closeSettings() {
  state.settingsOpen = false;
  $("settingsOverlay").hidden = true;
  $("settingsPanel").classList.remove("is-open");
  $("settingsPanel").setAttribute("aria-hidden", "true");
  document.body.classList.remove("sheet-open");
  tg?.BackButton?.hide?.();
}

$("adminToken").value = localStorage.getItem("admin_token") || "";

$("btnOpenSettings").addEventListener("click", openSettings);
$("btnCloseSettings").addEventListener("click", closeSettings);
$("settingsOverlay").addEventListener("click", closeSettings);

$("btnRefresh").addEventListener(
  "click",
  withBusy([$("btnRefresh")], async () => {
    haptic("light");
    await refreshAll();
  }),
);

const publishBtns = () => [
  $("btnFetch"),
  $("btnPublishGroup"),
  $("btnPublishChannel"),
];

$("btnFetch").addEventListener(
  "click",
  withBusy(publishBtns(), async () => {
    setStatus($("actionStatus"), "RSS yig‘ilmoqda...", "");
    try {
      const data = await api("/api/fetch", { method: "POST" });
      renderStats(data.stats || {});
      setStatus($("actionStatus"), `Tayyor. Yangi: ${data.added}`, "ok");
      state.page = 1;
      await loadNews();
      haptic("medium");
    } catch (err) {
      setStatus($("actionStatus"), err.message, "err");
      haptic("rigid");
    }
  }),
);

$("btnPublishGroup").addEventListener(
  "click",
  withBusy(publishBtns(), async () => {
    setStatus($("actionStatus"), "Guruhga yuborilmoqda...", "");
    try {
      const data = await api("/api/publish/group", { method: "POST" });
      renderStats(data.stats || {});
      setStatus($("actionStatus"), `Guruh: ${data.published} ta`, "ok");
      await loadNews();
      haptic("medium");
    } catch (err) {
      setStatus($("actionStatus"), err.message, "err");
    }
  }),
);

$("btnPublishChannel").addEventListener(
  "click",
  withBusy(publishBtns(), async () => {
    setStatus($("actionStatus"), "Kanalga yuborilmoqda...", "");
    try {
      const data = await api("/api/publish/channel", { method: "POST" });
      renderStats(data.stats || {});
      setStatus($("actionStatus"), `Kanal: ${data.published} ta`, "ok");
      await loadNews();
      haptic("medium");
    } catch (err) {
      setStatus($("actionStatus"), err.message, "err");
    }
  }),
);

$("scheduleGroupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  saveToken();
  try {
    const data = await api("/api/schedule/group", {
      method: "PUT",
      body: JSON.stringify({
        morning: $("groupMorning").value,
        evening: $("groupEvening").value,
        enabled: $("groupEnabled").checked,
      }),
    });
    setStatus($("scheduleGroupStatus"), data.applied || "Saqlandi", "ok");
    haptic("light");
  } catch (err) {
    setStatus($("scheduleGroupStatus"), err.message, "err");
  }
});

$("scheduleChannelForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  saveToken();
  try {
    const data = await api("/api/schedule/channel", {
      method: "PUT",
      body: JSON.stringify({
        morning: $("channelMorning").value,
        evening: $("channelEvening").value,
        enabled: $("channelEnabled").checked,
      }),
    });
    setStatus($("scheduleChannelStatus"), data.applied || "Saqlandi", "ok");
    haptic("light");
  } catch (err) {
    setStatus($("scheduleChannelStatus"), err.message, "err");
  }
});

$("categoryChips").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-category]");
  if (!btn) return;
  state.category = btn.getAttribute("data-category") || "all";
  state.page = 1;
  renderCategoryChips();
  haptic("light");
  await loadNews();
});

document.querySelector(".status-row").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-posted]");
  if (!btn) return;
  state.posted = btn.getAttribute("data-posted") || "all";
  state.page = 1;
  renderStatusChips();
  haptic("light");
  await loadNews();
});

let searchTimer;
$("filterQ").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    state.page = 1;
    await loadNews();
  }, 280);
});

$("btnPrev").addEventListener("click", async () => {
  if (state.page > 1) {
    state.page -= 1;
    await loadNews();
  }
});

$("btnNext").addEventListener("click", async () => {
  const pages = Math.max(1, Math.ceil(state.total / state.limit));
  if (state.page < pages) {
    state.page += 1;
    await loadNews();
  }
});

$("newsList").addEventListener("click", async (e) => {
  const toggle = e.target.closest("[data-toggle]");
  if (toggle) {
    const card = toggle.closest(".news-card");
    const open = card.classList.toggle("is-open");
    toggle.textContent = open ? "Yig‘ish" : "Ko‘proq o‘qish";
    haptic("soft");
    return;
  }

  const del = e.target.closest("[data-del]");
  if (!del) return;
  const id = del.getAttribute("data-del");
  const ok = tg?.showConfirm
    ? await new Promise((resolve) => {
        tg.showConfirm("Ushbu yangilikni o‘chirasizmi?", resolve);
      })
    : confirm("Ushbu yangilikni o‘chirasizmi?");
  if (!ok) return;
  try {
    await api(`/api/news/${id}`, { method: "DELETE" });
    await loadMeta();
    await loadNews();
  } catch (err) {
    if (tg?.showAlert) tg.showAlert(err.message);
    else alert(err.message);
  }
});

initTelegram();
renderStatusChips();

refreshAll().catch((err) => {
  $("newsList").innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  setStatus($("actionStatus"), err.message, "err");
});
