const state = {
  page: 1,
  limit: 12,
  total: 0,
  busy: false,
  category: "all",
  posted: "all",
  categories: [],
  settingsOpen: false,
  tokenGateOpen: false,
  auth: { required: true, token: true, telegram: false },
  fetchTimer: null,
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
  if (tp.link_color) root.style.setProperty("--accent", tp.link_color);

  tg.BackButton.onClick(() => {
    if (state.tokenGateOpen) closeTokenGate();
    else if (state.settingsOpen) closeSettings();
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

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function getToken() {
  return localStorage.getItem("admin_token") || "";
}

function saveToken(token) {
  const value = (token || "").trim();
  if (value) localStorage.setItem("admin_token", value);
  else localStorage.removeItem("admin_token");
}

/** Mini App ichida bo‘lsak imzolangan initData ham yuboriladi */
function authHeaders(tokenOverride) {
  const headers = {};
  const token = tokenOverride ?? getToken();
  if (token) headers["x-admin-token"] = token;
  if (tg?.initData) headers["x-telegram-init-data"] = tg.initData;
  return headers;
}

async function api(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...authHeaders(options.token),
    ...(options.headers || {}),
  };

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function fetchAuthStatus() {
  try {
    const res = await fetch("/api/auth/status");
    const data = await res.json();
    state.auth = {
      required: Boolean(data.required),
      token: Boolean(data.token),
      telegram: Boolean(data.telegram),
    };
  } catch {
    /* holat noma’lum bo‘lsa ham davom etamiz */
  }
  return state.auth;
}

// ---------------------------------------------------------------------------
// Yordamchilar
// ---------------------------------------------------------------------------

function setStatus(el, text, type = "") {
  if (!el) return;
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

/** RSS dan kelgan `javascript:` kabi havolalar bosiladigan bo‘lib qolmasin */
function safeHref(url) {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : "#";
  } catch {
    return "#";
  }
}

function confirmDialog(message) {
  return tg?.showConfirm
    ? new Promise((resolve) => tg.showConfirm(message, resolve))
    : Promise.resolve(confirm(message));
}

function alertDialog(message) {
  if (tg?.showAlert) tg.showAlert(message);
  else alert(message);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderStats(stats) {
  $("statTotal").textContent = String(stats?.total ?? "—");
  $("statPendingGroup").textContent = String(stats?.pendingGroup ?? "—");
  $("statPendingChannel").textContent = String(stats?.pendingChannel ?? "—");
}

function renderCategoryChips() {
  const cats = ["all", ...state.categories];
  $("categoryChips").innerHTML = cats
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
    return (
      map[host] || host.split(".")[0]?.replace(/^\w/, (c) => c.toUpperCase()) || host
    );
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
      const audioBadge = item.audio_path ? `<span class="badge">🔊</span>` : "";
      const clusterBadge =
        item.cluster_size > 1
          ? `<span class="badge cluster">${item.cluster_size} manba</span>`
          : "";
      return `
        <article class="news-card" style="animation-delay:${i * 40}ms" data-id="${escapeAttr(item.id)}">
          <div class="news-card-top">
            <h2>${escapeHtml(item.title_uz || item.title_original || "Nomsiz")}</h2>
          </div>
          <div class="meta">
            ${groupBadge}
            ${channelBadge}
            ${audioBadge}
            ${clusterBadge}
            <span class="badge cat">${escapeHtml(item.category || "—")}</span>
            <span class="badge">${escapeHtml(formatWhen(item.published_at || item.created_at))}</span>
          </div>
          <p class="summary">${escapeHtml(bulletsText(item.summary_uz))}</p>
          <button type="button" class="toggle-more" data-toggle="${escapeAttr(item.id)}">Ko‘proq o‘qish</button>
          <div class="card-footer">
            <a class="source-link" href="${escapeAttr(safeHref(item.source_url))}" target="_blank" rel="noopener noreferrer">
              <strong>${escapeHtml(siteNameFromUrl(item.source_url))}</strong>
              <span>· ochish</span>
            </a>
            <button type="button" class="btn-danger" data-del="${escapeAttr(item.id)}">O‘chirish</button>
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

// ---------------------------------------------------------------------------
// Kategoriyalar / manbalar (CRUD)
// ---------------------------------------------------------------------------

function renderCategoryList(items) {
  const root = $("categoryList");
  if (!items.length) {
    root.innerHTML = `<p class="crud-empty">Hali kategoriya yo‘q. Quyida qo‘shing.</p>`;
    return;
  }

  root.innerHTML = items
    .map((item) => {
      const thread =
        item.thread_id === null || item.thread_id === undefined
          ? "Topic biriktirilmagan"
          : `Topic ID: ${item.thread_id}`;
      return `
        <div class="crud-item ${item.is_active ? "" : "is-off"}">
          <div class="crud-item-main">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(thread)}</span>
          </div>
          <div class="crud-item-actions">
            <button type="button" class="icon-mini ${item.is_active ? "is-on" : ""}"
              data-cat-toggle="${escapeAttr(item.id)}">${item.is_active ? "Aktiv" : "O‘chiq"}</button>
            <button type="button" class="icon-mini" data-cat-edit="${escapeAttr(item.id)}"
              data-thread="${escapeAttr(item.thread_id ?? "")}">Topic</button>
            <button type="button" class="icon-mini is-danger" data-cat-del="${escapeAttr(item.id)}">✕</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderSourceList(items) {
  const root = $("sourceList");
  if (!items.length) {
    root.innerHTML = `<p class="crud-empty">Hali RSS manbasi yo‘q. Quyida qo‘shing.</p>`;
    return;
  }

  root.innerHTML = items
    .map((item) => {
      const detail = item.last_error
        ? `Xato: ${item.last_error}`
        : item.last_fetched_at
          ? `${formatWhen(item.last_fetched_at)} · +${item.last_added}`
          : item.url;
      return `
        <div class="crud-item ${item.is_active ? "" : "is-off"}">
          <div class="crud-item-main">
            <strong>${escapeHtml(item.name)}</strong>
            <span class="${item.last_error ? "err" : ""}">${escapeHtml(detail)}</span>
          </div>
          <div class="crud-item-actions">
            <button type="button" class="icon-mini ${item.is_active ? "is-on" : ""}"
              data-src-toggle="${escapeAttr(item.id)}">${item.is_active ? "Aktiv" : "O‘chiq"}</button>
            <button type="button" class="icon-mini is-danger" data-src-del="${escapeAttr(item.id)}">✕</button>
          </div>
        </div>
      `;
    })
    .join("");
}

async function loadCategories() {
  renderCategoryList((await api("/api/categories")).items || []);
}

async function loadSources() {
  renderSourceList((await api("/api/sources")).items || []);
}

// ---------------------------------------------------------------------------
// Yuklash
// ---------------------------------------------------------------------------

function renderTimeList(containerId, times) {
  const root = $(containerId);
  root.innerHTML = (times.length ? times : ["08:00"])
    .map(
      (time) => `
        <div class="time-row">
          <input type="time" value="${escapeAttr(time)}" required />
          <button type="button" class="icon-mini is-danger" data-remove-time>✕</button>
        </div>`,
    )
    .join("");
}

function readTimeList(containerId) {
  return [...$(containerId).querySelectorAll("input[type=time]")]
    .map((input) => input.value.trim())
    .filter(Boolean);
}

// Vaqt qo‘shish / o‘chirish — oxirgi qator qolishi shart
document.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add-time]");
  if (add) {
    const root = $(add.dataset.addTime);
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="time-row">
         <input type="time" value="12:00" required />
         <button type="button" class="icon-mini is-danger" data-remove-time>✕</button>
       </div>`,
    );
    haptic("light");
    return;
  }

  const remove = e.target.closest("[data-remove-time]");
  if (remove) {
    const list = remove.closest(".time-list");
    if (list.querySelectorAll(".time-row").length > 1) {
      remove.closest(".time-row").remove();
      haptic("light");
    }
  }
});

async function loadMeta() {
  const meta = await api("/api/meta");
  state.categories = meta.categories || [];
  if (state.category !== "all" && !state.categories.includes(state.category)) {
    state.category = "all";
  }
  renderCategoryChips();
  renderStats(meta.stats || {});

  const sg = meta.schedule?.group || {};
  renderTimeList("groupTimes", sg.times || ["08:00", "20:00"]);
  $("groupLimit").value = sg.limit ?? 50;
  $("groupEnabled").checked = Boolean(sg.enabled);

  const sc = meta.schedule?.channel || {};
  renderTimeList("channelTimes", sc.times || ["08:00", "14:00", "20:00"]);
  $("channelLimit").value = sc.limit ?? 5;
  $("channelEnabled").checked = Boolean(sc.enabled);

  $("ttsEnabled").checked = Boolean(meta.tts?.enabled);
  if (!meta.tts?.ffmpeg) {
    setStatus(
      $("ttsStatus"),
      "ffmpeg topilmadi — audio yuborilmaydi (sudo apt install -y ffmpeg)",
      "err",
    );
  }

  const btnChannel = $("btnPublishChannel");
  btnChannel.disabled = !meta.channelConfigured;
  btnChannel.title = meta.channelConfigured ? "" : "TELEGRAM_CHANNEL_ID sozlanmagan";
}

async function loadNews() {
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
  await loadMeta();
  await loadNews();
}

async function loadSettingsData() {
  await loadMeta();
  await Promise.all([loadCategories(), loadSources()]);
  await pollFetchJob(false);
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

// ---------------------------------------------------------------------------
// Panellar
// ---------------------------------------------------------------------------

function openTokenGate(message = "") {
  state.tokenGateOpen = true;
  $("tokenGateOverlay").hidden = false;
  $("tokenGatePanel").classList.add("is-open");
  $("tokenGatePanel").setAttribute("aria-hidden", "false");
  document.body.classList.add("sheet-open");
  $("tokenGateInput").value = "";
  setStatus($("tokenGateStatus"), message, message ? "err" : "");
  tg?.BackButton?.show?.();
  setTimeout(() => $("tokenGateInput").focus(), 200);
  haptic("soft");
}

function closeTokenGate() {
  state.tokenGateOpen = false;
  $("tokenGateOverlay").hidden = true;
  $("tokenGatePanel").classList.remove("is-open");
  $("tokenGatePanel").setAttribute("aria-hidden", "true");
  if (!state.settingsOpen) {
    document.body.classList.remove("sheet-open");
    tg?.BackButton?.hide?.();
  }
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
  stopFetchPolling();
}

// ---------------------------------------------------------------------------
// Fetch jarayoni
// ---------------------------------------------------------------------------

function stopFetchPolling() {
  if (state.fetchTimer) {
    clearTimeout(state.fetchTimer);
    state.fetchTimer = null;
  }
}

function renderFetchProgress(job) {
  const box = $("fetchProgress");
  if (!job || (!job.running && !job.startedAt)) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  const total = job.progress?.totalSources || 0;
  const done = job.progress?.doneSources || 0;
  const percent = total ? Math.round((done / total) * 100) : job.running ? 5 : 100;
  $("fetchProgressBar").style.width = `${percent}%`;
  $("btnCancelFetch").hidden = !job.running;

  if (job.running) {
    const current = job.progress?.currentSource || "boshlanmoqda";
    $("fetchProgressText").textContent =
      `${done}/${total || "?"} · ${current} · +${job.added}`;
  } else if (job.error) {
    $("fetchProgressText").textContent = `Xato: ${job.error}`;
  } else {
    $("fetchProgressText").textContent = job.cancelled
      ? `Bekor qilindi · +${job.added}`
      : `Tugadi · yangi ${job.added}`;
  }
}

async function pollFetchJob(reloadWhenDone = true) {
  stopFetchPolling();
  try {
    const { job, stats } = await api("/api/fetch/status");
    renderFetchProgress(job);
    renderStats(stats);

    if (job.running) {
      state.fetchTimer = setTimeout(() => void pollFetchJob(reloadWhenDone), 2000);
      return;
    }

    if (reloadWhenDone) {
      setStatus(
        $("actionStatus"),
        job.error ? job.error : `Tayyor. Yangi: ${job.added}`,
        job.error ? "err" : "ok",
      );
      state.page = 1;
      await loadNews();
      await loadSources();
      haptic("medium");
    }
  } catch (err) {
    setStatus($("actionStatus"), err.message, "err");
  }
}

// ---------------------------------------------------------------------------
// Hodisalar
// ---------------------------------------------------------------------------

$("btnOpenSettings").addEventListener("click", async () => {
  openSettings();
  try {
    await loadSettingsData();
  } catch (err) {
    if (err.status === 401) {
      closeSettings();
      openTokenGate("Kirish uchun maxfiy kalitni kiriting");
    } else {
      setStatus($("actionStatus"), err.message, "err");
    }
  }
});
$("btnCloseSettings").addEventListener("click", closeSettings);
$("settingsOverlay").addEventListener("click", closeSettings);

$("btnCloseTokenGate").addEventListener("click", closeTokenGate);
$("tokenGateOverlay").addEventListener("click", closeTokenGate);

$("tokenGateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = $("tokenGateInput").value.trim();
  if (!token) {
    setStatus($("tokenGateStatus"), "Maxfiy kalitni kiriting", "err");
    return;
  }

  setStatus($("tokenGateStatus"), "Tekshirilmoqda...", "");
  try {
    await api("/api/meta", { token });
    saveToken(token);
    closeTokenGate();
    await refreshAll();
    haptic("medium");
  } catch (err) {
    if (err.status === 401) {
      setStatus($("tokenGateStatus"), "Noto‘g‘ri maxfiy kalit", "err");
      haptic("rigid");
    } else {
      setStatus($("tokenGateStatus"), err.message, "err");
    }
  }
});

$("btnLogoutToken").addEventListener("click", () => {
  saveToken("");
  closeSettings();
  haptic("light");
  openTokenGate("Kalit o‘chirildi. Qayta kiriting.");
});

$("btnRefresh").addEventListener(
  "click",
  withBusy([$("btnRefresh")], async () => {
    haptic("light");
    try {
      await refreshAll();
    } catch (err) {
      setStatus($("actionStatus"), err.message, "err");
    }
  }),
);

const publishBtns = () => [$("btnFetch"), $("btnPublishGroup"), $("btnPublishChannel")];

$("btnFetch").addEventListener("click", async () => {
  setStatus($("actionStatus"), "RSS yig‘ish boshlandi...", "");
  try {
    await api("/api/fetch", { method: "POST" });
  } catch (err) {
    if (err.status !== 409) {
      setStatus($("actionStatus"), err.message, "err");
      return;
    }
    setStatus($("actionStatus"), "Fetch allaqachon ishlayapti", "");
  }
  await pollFetchJob();
});

$("btnCancelFetch").addEventListener("click", async () => {
  try {
    await api("/api/fetch/cancel", { method: "POST" });
    setStatus($("actionStatus"), "Bekor qilinmoqda...", "");
  } catch (err) {
    setStatus($("actionStatus"), err.message, "err");
  }
});

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

function bindScheduleForm(formId, path, fields, statusId) {
  $(formId).addEventListener("submit", async (e) => {
    e.preventDefault();
    const times = readTimeList(fields.times);
    if (times.length === 0) {
      setStatus($(statusId), "Kamida bitta vaqt kerak", "err");
      return;
    }

    try {
      const data = await api(path, {
        method: "PUT",
        body: JSON.stringify({
          times,
          limit: Number($(fields.limit).value) || undefined,
          enabled: $(fields.enabled).checked,
        }),
      });
      renderTimeList(fields.times, data.times || times);
      setStatus($(statusId), data.applied || "Saqlandi", "ok");
      haptic("light");
    } catch (err) {
      setStatus($(statusId), err.message, "err");
    }
  });
}

bindScheduleForm(
  "scheduleGroupForm",
  "/api/schedule/group",
  { times: "groupTimes", limit: "groupLimit", enabled: "groupEnabled" },
  "scheduleGroupStatus",
);

bindScheduleForm(
  "scheduleChannelForm",
  "/api/schedule/channel",
  { times: "channelTimes", limit: "channelLimit", enabled: "channelEnabled" },
  "scheduleChannelStatus",
);

// --- Kategoriyalar ---

$("categoryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("categoryName").value.trim();
  const threadRaw = $("categoryThread").value.trim();
  if (!name) return;

  setStatus($("categoryStatus"), "Qo‘shilmoqda...", "");
  try {
    await api("/api/categories", {
      method: "POST",
      body: JSON.stringify({
        name,
        thread_id: threadRaw === "" ? null : Number(threadRaw),
      }),
    });
    $("categoryName").value = "";
    $("categoryThread").value = "";
    await Promise.all([loadCategories(), loadMeta()]);
    setStatus($("categoryStatus"), `"${name}" qo‘shildi`, "ok");
    haptic("medium");
  } catch (err) {
    setStatus($("categoryStatus"), err.message, "err");
  }
});

$("categoryList").addEventListener("click", async (e) => {
  const toggle = e.target.closest("[data-cat-toggle]");
  const edit = e.target.closest("[data-cat-edit]");
  const del = e.target.closest("[data-cat-del]");

  try {
    if (toggle) {
      await api(`/api/categories/${toggle.dataset.catToggle}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: !toggle.classList.contains("is-on") }),
      });
    } else if (edit) {
      const value = prompt(
        "Topic ID (message_thread_id). Bo‘sh qoldiring — umumiy topic:",
        edit.dataset.thread || "",
      );
      if (value === null) return;
      const trimmed = value.trim();
      if (trimmed !== "" && !Number.isInteger(Number(trimmed))) {
        setStatus($("categoryStatus"), "Topic ID butun son bo‘lishi kerak", "err");
        return;
      }
      await api(`/api/categories/${edit.dataset.catEdit}`, {
        method: "PUT",
        body: JSON.stringify({ thread_id: trimmed === "" ? null : Number(trimmed) }),
      });
    } else if (del) {
      const ok = await confirmDialog(
        "Kategoriya o‘chirilsinmi? Mavjud yangiliklar saqlanib qoladi.",
      );
      if (!ok) return;
      await api(`/api/categories/${del.dataset.catDel}`, { method: "DELETE" });
    } else {
      return;
    }

    await Promise.all([loadCategories(), loadMeta()]);
    setStatus($("categoryStatus"), "Saqlandi", "ok");
    haptic("light");
  } catch (err) {
    setStatus($("categoryStatus"), err.message, "err");
  }
});

// --- Manbalar ---

$("sourceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("sourceName").value.trim();
  const url = $("sourceUrl").value.trim();
  if (!name || !url) return;

  setStatus($("sourceStatus"), "Qo‘shilmoqda...", "");
  try {
    await api("/api/sources", { method: "POST", body: JSON.stringify({ name, url }) });
    $("sourceName").value = "";
    $("sourceUrl").value = "";
    await loadSources();
    setStatus($("sourceStatus"), `"${name}" qo‘shildi`, "ok");
    haptic("medium");
  } catch (err) {
    setStatus($("sourceStatus"), err.message, "err");
  }
});

$("sourceList").addEventListener("click", async (e) => {
  const toggle = e.target.closest("[data-src-toggle]");
  const del = e.target.closest("[data-src-del]");

  try {
    if (toggle) {
      await api(`/api/sources/${toggle.dataset.srcToggle}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: !toggle.classList.contains("is-on") }),
      });
    } else if (del) {
      if (!(await confirmDialog("Bu RSS manbasi o‘chirilsinmi?"))) return;
      await api(`/api/sources/${del.dataset.srcDel}`, { method: "DELETE" });
    } else {
      return;
    }

    await loadSources();
    setStatus($("sourceStatus"), "Saqlandi", "ok");
    haptic("light");
  } catch (err) {
    setStatus($("sourceStatus"), err.message, "err");
  }
});

// --- TTS ---

$("ttsEnabled").addEventListener("change", async (e) => {
  const enabled = e.target.checked;
  try {
    const data = await api("/api/settings/tts", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
    const missingFfmpeg = data.enabled && !data.ffmpeg;
    setStatus(
      $("ttsStatus"),
      missingFfmpeg
        ? "Yoqildi, lekin ffmpeg yo‘q — audio yuborilmaydi"
        : data.enabled
          ? "Audio yuborish yoqildi"
          : "Audio yuborish o‘chirildi",
      missingFfmpeg ? "err" : "ok",
    );
    haptic("light");
  } catch (err) {
    e.target.checked = !enabled;
    setStatus($("ttsStatus"), err.message, "err");
  }
});

// --- Filtrlar / ro‘yxat ---

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
  if (!(await confirmDialog("Ushbu yangilikni o‘chirasizmi?"))) return;

  try {
    const data = await api(`/api/news/${del.getAttribute("data-del")}`, {
      method: "DELETE",
    });
    renderStats(data.stats || {});
    await loadNews();
  } catch (err) {
    alertDialog(err.message);
  }
});

// ---------------------------------------------------------------------------
// Boshlash
// ---------------------------------------------------------------------------

initTelegram();
renderStatusChips();

(async function boot() {
  await fetchAuthStatus();
  try {
    await refreshAll();
  } catch (err) {
    if (err.status === 401) {
      $("newsList").innerHTML = `<div class="empty">Kirish uchun maxfiy kalit kerak</div>`;
      openTokenGate(
        state.auth.telegram && tg?.initData
          ? "Telegram hisobingizga ruxsat yo‘q. Maxfiy kalitni kiriting."
          : "",
      );
    } else {
      $("newsList").innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
      setStatus($("actionStatus"), err.message, "err");
    }
  }
})();
