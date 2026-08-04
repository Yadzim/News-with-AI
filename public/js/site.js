const state = {
  page: 1,
  limit: 12,
  total: 0,
  category: "all",
  query: "",
  loading: false,
  items: [],
};

const $ = (id) => document.getElementById(id);
const tg = window.Telegram?.WebApp;

// ---------------------------------------------------------------------------
// Mavzu (light / dark)
// ---------------------------------------------------------------------------

function applyTheme(theme) {
  if (theme) document.documentElement.setAttribute("data-theme", theme);
  else document.documentElement.removeAttribute("data-theme");
}

function currentTheme() {
  return (
    document.documentElement.getAttribute("data-theme") ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
}

applyTheme(localStorage.getItem("theme"));

$("themeToggle").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem("theme", next);
});

/** Telegram ichida ochilsa mijoz mavzusiga ergashamiz */
if (tg) {
  tg.ready();
  tg.expand();
  if (!localStorage.getItem("theme")) {
    applyTheme(tg.colorScheme === "light" ? "light" : "dark");
  }
}

// ---------------------------------------------------------------------------
// Yordamchilar
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

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

// ICU da uz-UZ oy nomlari "M08" ko‘rinishida chiqadi — o‘zimiz yozamiz
const MONTHS = [
  "yanvar", "fevral", "mart", "aprel", "may", "iyun",
  "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
];

/** Toshkent vaqti bo‘yicha kun/oy/yil/soat */
function tashkentParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    day: get("day"), month: Number(get("month")), year: get("year"),
    hour: get("hour"), minute: get("minute"),
  };
}

/** "2 soat oldin" ko‘rinishida; eskilari uchun sana */
function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return "hozirgina";
  if (diffMin < 60) return `${diffMin} daqiqa oldin`;

  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} soat oldin`;

  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 7) return `${diffDay} kun oldin`;

  const p = tashkentParts(date);
  return `${p.day}-${MONTHS[p.month - 1]}, ${p.year}`;
}

function fullDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const p = tashkentParts(date);
  return `${p.day}-${MONTHS[p.month - 1]}, ${p.year} · ${p.hour}:${p.minute}`;
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) return "0:00";
  const total = Math.max(0, Math.round(value));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

async function api(path) {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Audio: bir vaqtda faqat bitta yangilik eshitiladi
// ---------------------------------------------------------------------------

const audio = new Audio();
audio.preload = "none";
let activePlayer = null;

const PLAY_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';

function playerMarkup(url) {
  return `
    <div class="player" data-audio="${escapeHtml(url)}">
      <button type="button" class="player-btn" aria-label="Eshitish">${PLAY_ICON}</button>
      <div class="player-bar"><div class="player-fill"></div></div>
      <span class="player-time">0:00</span>
    </div>`;
}

function resetPlayer(player) {
  if (!player) return;
  player.querySelector(".player-btn").innerHTML = PLAY_ICON;
  player.querySelector(".player-fill").style.width = "0%";
  player.querySelector(".player-time").textContent = "0:00";
}

function togglePlayer(player) {
  const url = player.dataset.audio;

  if (activePlayer === player && !audio.paused) {
    audio.pause();
    player.querySelector(".player-btn").innerHTML = PLAY_ICON;
    return;
  }

  if (activePlayer !== player) {
    resetPlayer(activePlayer);
    activePlayer = player;
    audio.src = url;
  }

  audio.play().then(
    () => {
      player.querySelector(".player-btn").innerHTML = PAUSE_ICON;
    },
    () => {
      player.querySelector(".player-time").textContent = "xato";
    },
  );
}

audio.addEventListener("timeupdate", () => {
  if (!activePlayer || !audio.duration) return;
  const percent = (audio.currentTime / audio.duration) * 100;
  activePlayer.querySelector(".player-fill").style.width = `${percent}%`;
  activePlayer.querySelector(".player-time").textContent = formatSeconds(
    audio.duration - audio.currentTime,
  );
});

audio.addEventListener("ended", () => {
  resetPlayer(activePlayer);
  activePlayer = null;
});

// Pleyer tugmasi va progress — kartada ham, maqola oynasida ham
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".player-btn");
  if (btn) {
    e.stopPropagation();
    togglePlayer(btn.closest(".player"));
    return;
  }

  const bar = e.target.closest(".player-bar");
  if (bar) {
    e.stopPropagation();
    const player = bar.closest(".player");
    if (activePlayer !== player || !audio.duration) return;
    const rect = bar.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  }
});

// ---------------------------------------------------------------------------
// Ro‘yxat
// ---------------------------------------------------------------------------

function cardMarkup(item) {
  const sources = item.sources || [];
  const sourceNames = sources.map((s) => s.name).join(" · ");
  const multi =
    sources.length > 1
      ? `<span class="badge warm">${sources.length} manba</span>`
      : "";

  return `
    <article class="card" data-id="${escapeHtml(item.id)}" tabindex="0">
      <div class="card-meta">
        <span class="badge">${escapeHtml(item.category || "Yangilik")}</span>
        ${multi}
        <span>${escapeHtml(relativeTime(item.published_at))}</span>
      </div>
      <h2>${escapeHtml(item.title)}</h2>
      <p class="lead">${escapeHtml((item.bullets || []).join(" "))}</p>
      ${item.audio_url ? playerMarkup(item.audio_url) : ""}
      <div class="card-foot">
        <span class="source-names">${escapeHtml(sourceNames)}</span>
        <span>O‘qish →</span>
      </div>
    </article>`;
}

function showSkeletons(count = 6) {
  $("cards").innerHTML = Array.from(
    { length: count },
    () => `<div class="skeleton"><span></span><span></span><span></span><span></span></div>`,
  ).join("");
}

async function loadNews({ append = false } = {}) {
  if (state.loading) return;
  state.loading = true;

  const btn = $("loadMore");
  btn.disabled = true;
  if (!append) {
    showSkeletons();
    $("feedState").textContent = "";
  }

  try {
    const params = new URLSearchParams({
      page: String(state.page),
      limit: String(state.limit),
      category: state.category,
    });
    if (state.query) params.set("q", state.query);

    const data = await api(`/api/public/news?${params}`);
    state.total = data.total || 0;
    state.items = append ? [...state.items, ...data.items] : data.items;

    if (state.items.length === 0) {
      $("cards").innerHTML = "";
      $("feedState").textContent = state.query
        ? `"${state.query}" bo‘yicha hech narsa topilmadi`
        : "Hozircha yangilik yo‘q";
    } else {
      $("cards").innerHTML = state.items.map(cardMarkup).join("");
      $("cards")
        .querySelectorAll(".card")
        .forEach((card, i) => {
          card.style.animationDelay = `${Math.min(i, 8) * 35}ms`;
        });
      $("feedState").textContent = "";
    }

    btn.hidden = state.items.length >= state.total;
  } catch (err) {
    $("cards").innerHTML = "";
    $("feedState").textContent = `Yuklashda xato: ${err.message}`;
  } finally {
    state.loading = false;
    btn.disabled = false;
  }
}

function renderCategories(categories) {
  $("categories").innerHTML = ["all", ...categories]
    .map((cat) => {
      const label = cat === "all" ? "Barchasi" : cat;
      const active = state.category === cat ? "is-active" : "";
      return `<button type="button" class="chip ${active}" data-category="${escapeHtml(cat)}">${escapeHtml(label)}</button>`;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Maqola oynasi
// ---------------------------------------------------------------------------

function openReader(item) {
  $("readerCategory").textContent = item.category || "Yangilik";
  $("readerTitle").textContent = item.title;
  $("readerDate").textContent = fullDate(item.published_at);
  $("readerAudio").innerHTML = item.audio_url ? playerMarkup(item.audio_url) : "";
  $("readerBullets").innerHTML = (item.bullets || [])
    .map((b) => `<li>${escapeHtml(b)}</li>`)
    .join("");

  const sources = item.sources || [];
  $("readerSources").innerHTML = sources.length
    ? `<h3>${sources.length > 1 ? "Manbalar" : "Manba"}</h3>
       <div class="source-list">
         ${sources
           .map(
             (s) =>
               `<a href="${escapeHtml(safeHref(s.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.name)} ↗</a>`,
           )
           .join("")}
       </div>`
    : "";

  $("readerOverlay").hidden = false;
  $("reader").classList.add("is-open");
  $("reader").setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
  $("reader").querySelector(".reader-body").scrollTop = 0;

  history.replaceState(null, "", `?id=${encodeURIComponent(item.id)}`);
  tg?.BackButton?.show?.();
}

function closeReader() {
  $("readerOverlay").hidden = true;
  $("reader").classList.remove("is-open");
  $("reader").setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");

  // Oynadagi pleyer yo‘qolganda ovoz ham to‘xtasin
  if (activePlayer && !document.body.contains(activePlayer)) {
    audio.pause();
    activePlayer = null;
  }

  history.replaceState(null, "", window.location.pathname);
  tg?.BackButton?.hide?.();
}

$("readerClose").addEventListener("click", closeReader);
$("readerOverlay").addEventListener("click", closeReader);
tg?.BackButton?.onClick?.(closeReader);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("reader").classList.contains("is-open")) {
    closeReader();
  }
});

// ---------------------------------------------------------------------------
// Hodisalar
// ---------------------------------------------------------------------------

$("cards").addEventListener("click", async (e) => {
  if (e.target.closest(".player")) return;
  const card = e.target.closest(".card");
  if (!card) return;

  const item = state.items.find((n) => n.id === card.dataset.id);
  if (item) openReader(item);
});

$("cards").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest(".card");
  if (!card) return;
  e.preventDefault();
  const item = state.items.find((n) => n.id === card.dataset.id);
  if (item) openReader(item);
});

$("categories").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-category]");
  if (!btn) return;
  state.category = btn.dataset.category;
  state.page = 1;
  renderCategories(state.categoriesList || []);
  void loadNews();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

let searchTimer;
$("search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    state.page = 1;
    void loadNews();
  }, 300);
});

$("loadMore").addEventListener("click", () => {
  state.page += 1;
  void loadNews({ append: true });
});

// ---------------------------------------------------------------------------
// Boshlash
// ---------------------------------------------------------------------------

(async function boot() {
  try {
    const meta = await api("/api/public/meta");
    state.categoriesList = meta.categories || [];
    renderCategories(state.categoriesList);

    if (meta.channel) {
      const link = $("channelLink");
      const handle = meta.channel.startsWith("@")
        ? meta.channel.slice(1)
        : meta.channel;
      if (!handle.startsWith("-")) {
        link.href = `https://t.me/${handle}`;
        link.hidden = false;
      }
    }
  } catch {
    /* kategoriyalarsiz ham ro‘yxat ishlaydi */
  }

  await loadNews();

  // ?id=... bilan kelingan bo‘lsa o‘sha maqolani ochamiz
  const wanted = new URLSearchParams(window.location.search).get("id");
  if (wanted) {
    const known = state.items.find((n) => n.id === wanted);
    if (known) openReader(known);
    else {
      try {
        openReader(await api(`/api/public/news/${encodeURIComponent(wanted)}`));
      } catch {
        /* topilmadi — oddiy ro‘yxat qoladi */
      }
    }
  }
})();
