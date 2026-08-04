import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initDataKeys, safeEqual, verifyInitData } from "./auth.js";
import { config } from "./config.js";
import {
  POSTED_FILTERS,
  createCategory,
  createSource,
  deleteCategory,
  deleteNews,
  deleteSource,
  getNewsStats,
  getTargetScheduleSettings,
  isTtsEnabled,
  listActiveCategoryNames,
  listCategories,
  listNews,
  listSources,
  saveTargetSchedule,
  setTtsEnabled,
  updateCategory,
  updateSource,
  type PostedFilter,
} from "./db.js";
import { cancelFetch, getFetchJobState, startFetch } from "./fetch-job.js";
import {
  publishPendingToChannel,
  publishPendingToGroup,
} from "./publisher.js";
import {
  applyScheduleFromDb,
  parseHourMinute,
  startScheduleWatcher,
} from "./schedule.js";
import { publisherBot } from "./telegram.js";
import { deleteAudioFile, hasFfmpeg } from "./tts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const MIN_ADMIN_TOKEN_LENGTH = 24;

// ---------------------------------------------------------------------------
// Ishga tushirishdan oldingi tekshiruv
// ---------------------------------------------------------------------------

const hasToken = config.adminToken.length >= MIN_ADMIN_TOKEN_LENGTH;
const hasTelegramAuth = config.adminUserIds.length > 0;

if (!hasToken && !hasTelegramAuth) {
  console.error(
    "Admin API himoyalanmagan holda ishga tushmaydi.\n" +
      `  - ADMIN_TOKEN kamida ${MIN_ADMIN_TOKEN_LENGTH} belgidan iborat bo‘lsin, yoki\n` +
      "  - ADMIN_USER_IDS ga Telegram foydalanuvchi ID(lar)ini yozing.\n" +
      "Kalit yaratish: openssl rand -hex 32",
  );
  if (config.adminToken.length > 0) {
    console.error(
      `  Hozirgi ADMIN_TOKEN juda qisqa (${config.adminToken.length} belgi).`,
    );
  }
  process.exit(1);
}

/**
 * systemd `EnvironmentFile` dotenv’dan farqli o‘laroq qator ichidagi izohni
 * kesmaydi va u qiymatga qo‘shilib ketadi. `EnvironmentFile` dotenv’dan oldin
 * o‘qilgani uchun bunday qiymat g‘olib chiqadi va kalit hech qachon mos
 * kelmaydi. Buni ishga tushishda aytib qo‘yamiz.
 */
if (/[\s#]/.test(config.adminToken)) {
  console.warn(
    "OGOHLANTIRISH: ADMIN_TOKEN ichida bo‘shliq yoki '#' bor.\n" +
      "  Ehtimol .env da qator ichida izoh qolgan (ADMIN_TOKEN=abc  # izoh).\n" +
      "  systemd izohni qiymatga qo‘shib yuboradi — izohni alohida qatorga oling.",
  );
}

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---------------------------------------------------------------------------
// Autentifikatsiya
// ---------------------------------------------------------------------------

/**
 * Ikki yo‘l bilan kirish mumkin:
 *  1. `x-admin-token` — ADMIN_TOKEN bilan aynan mos kelishi kerak.
 *  2. `x-telegram-init-data` — Mini App imzosi to‘g‘ri va user ID
 *     ADMIN_USER_IDS ro‘yxatida bo‘lsa.
 * Token query parametrida qabul qilinmaydi (nginx log/Referer’ga tushmasin).
 */
function auth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  // Nima uchun rad etilganini jurnalga yozamiz — sirlarsiz, lekin
  // sababni aniqlash uchun yetarli
  const reasons: string[] = [];

  if (hasToken) {
    const header = req.header("x-admin-token") || "";
    if (header && safeEqual(header, config.adminToken)) {
      next();
      return;
    }
    reasons.push(
      header
        ? `token mos kelmadi (kelgan ${header.length} belgi, kutilgan ${config.adminToken.length})`
        : "x-admin-token sarlavhasi yo‘q",
    );
  }

  if (hasTelegramAuth) {
    const initData = req.header("x-telegram-init-data") || "";
    if (!initData) {
      reasons.push("x-telegram-init-data sarlavhasi yo‘q");
    } else {
      const verified = verifyInitData(initData, config.telegramBotToken);
      if (!verified) {
        reasons.push(
          "initData imzosi noto‘g‘ri yoki muddati o‘tgan " +
            `(maydonlar: ${initDataKeys(initData).join(",") || "yo‘q"}; ` +
            `bot token ${config.telegramBotToken.length} belgi)`,
        );
      } else if (!config.adminUserIds.includes(verified.userId)) {
        reasons.push(
          `user ${verified.userId} ADMIN_USER_IDS ro‘yxatida yo‘q ` +
            `(ro‘yxat: ${config.adminUserIds.join(", ")})`,
        );
      } else {
        next();
        return;
      }
    }
  }

  console.warn(`401 ${req.method} ${req.path} — ${reasons.join(" | ")}`);
  res.status(401).json({ error: "Unauthorized" });
}

/** Handler ichidagi Error’ni 400 ga aylantiradi */
function handle(
  fn: (req: express.Request, res: express.Response) => void | Promise<void>,
) {
  return async (req: express.Request, res: express.Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.status(400).json({
          error: err instanceof Error ? err.message : "So‘rov bajarilmadi",
        });
      }
    }
  };
}

function optionalThreadId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num)) {
    throw new Error("Topic ID butun son bo‘lishi kerak");
  }
  return num;
}

// ---------------------------------------------------------------------------
// Umumiy
// ---------------------------------------------------------------------------

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/auth/status", (_req, res) => {
  res.json({ required: true, token: hasToken, telegram: hasTelegramAuth });
});

app.get(
  "/api/meta",
  auth,
  handle((_req, res) => {
    res.json({
      categories: listActiveCategoryNames(),
      schedule: getTargetScheduleSettings(),
      channelConfigured: Boolean(config.telegramChannelId),
      tts: { enabled: isTtsEnabled(), ffmpeg: hasFfmpeg() },
      stats: getNewsStats(),
    });
  }),
);

app.get(
  "/api/stats",
  auth,
  handle((_req, res) => {
    res.json(getNewsStats());
  }),
);

// ---------------------------------------------------------------------------
// Yangiliklar
// ---------------------------------------------------------------------------

app.get(
  "/api/news",
  auth,
  handle((req, res) => {
    const categoryRaw = String(req.query.category || "all");
    const known = listActiveCategoryNames();
    const category = known.includes(categoryRaw) ? categoryRaw : "all";

    const postedRaw = String(req.query.posted || "all");
    const posted = (POSTED_FILTERS as readonly string[]).includes(postedRaw)
      ? (postedRaw as PostedFilter)
      : "all";

    res.json(
      listNews({
        category,
        posted,
        q: typeof req.query.q === "string" ? req.query.q : undefined,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
      }),
    );
  }),
);

app.delete(
  "/api/news/:id",
  auth,
  handle((req, res) => {
    const removed = deleteNews(String(req.params.id));
    if (!removed) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    deleteAudioFile(removed.audio_path);
    res.json({ ok: true, stats: getNewsStats() });
  }),
);

// ---------------------------------------------------------------------------
// Fetch (fon rejimida, qulf bilan)
// ---------------------------------------------------------------------------

app.post(
  "/api/fetch",
  auth,
  handle((_req, res) => {
    const { started } = startFetch();
    if (!started) {
      res.status(409).json({
        error: "Fetch allaqachon ishlayapti",
        job: getFetchJobState(),
      });
      return;
    }
    res.status(202).json({ ok: true, job: getFetchJobState() });
  }),
);

app.get(
  "/api/fetch/status",
  auth,
  handle((_req, res) => {
    res.json({ job: getFetchJobState(), stats: getNewsStats() });
  }),
);

app.post(
  "/api/fetch/cancel",
  auth,
  handle((_req, res) => {
    res.json({ ok: cancelFetch(), job: getFetchJobState() });
  }),
);

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

app.post(
  "/api/publish/group",
  auth,
  handle(async (_req, res) => {
    const published = await publishPendingToGroup(publisherBot, 50);
    res.json({ ok: true, published, stats: getNewsStats() });
  }),
);

app.post(
  "/api/publish/channel",
  auth,
  handle(async (_req, res) => {
    if (!config.telegramChannelId) {
      res.status(400).json({ error: "TELEGRAM_CHANNEL_ID sozlanmagan" });
      return;
    }
    const published = await publishPendingToChannel(publisherBot, 50);
    res.json({ ok: true, published, stats: getNewsStats() });
  }),
);

// ---------------------------------------------------------------------------
// Jadval
// ---------------------------------------------------------------------------

app.get(
  "/api/schedule",
  auth,
  handle((_req, res) => {
    res.json(getTargetScheduleSettings());
  }),
);

function saveSchedule(target: "group" | "channel") {
  return handle((req: express.Request, res: express.Response) => {
    const rawTimes: unknown = req.body?.times;
    const times = Array.isArray(rawTimes)
      ? rawTimes.map((t) => String(t).trim())
      : String(rawTimes ?? "")
          .split(",")
          .map((t) => t.trim());

    const valid = times.filter((t) => t && parseHourMinute(t));
    if (valid.length === 0) {
      res.status(400).json({
        error: "Kamida bitta vaqt HH:MM formatida bo‘lishi kerak",
      });
      return;
    }

    const limitRaw = req.body?.limit;
    const limit = limitRaw === undefined ? undefined : Number(limitRaw);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      res.status(400).json({ error: "Limit 1 dan katta butun son bo‘lishi kerak" });
      return;
    }

    const saved = saveTargetSchedule(target, {
      times: valid,
      enabled: Boolean(req.body?.enabled),
      ...(limit === undefined ? {} : { limit }),
    });
    const applied = applyScheduleFromDb();
    res.json({ ...saved, applied: applied.message });
  });
}

app.put("/api/schedule/group", auth, saveSchedule("group"));
app.put("/api/schedule/channel", auth, saveSchedule("channel"));

// ---------------------------------------------------------------------------
// Kategoriyalar (CRUD)
// ---------------------------------------------------------------------------

app.get(
  "/api/categories",
  auth,
  handle((_req, res) => {
    res.json({ items: listCategories(true) });
  }),
);

app.post(
  "/api/categories",
  auth,
  handle((req, res) => {
    const created = createCategory({
      name: String(req.body?.name || ""),
      thread_id: optionalThreadId(req.body?.thread_id),
      is_active: req.body?.is_active === undefined ? true : Boolean(req.body.is_active),
    });
    res.status(201).json(created);
  }),
);

app.put(
  "/api/categories/:id",
  auth,
  handle((req, res) => {
    const updated = updateCategory(String(req.params.id), {
      ...(req.body?.name === undefined ? {} : { name: String(req.body.name) }),
      ...(req.body?.thread_id === undefined
        ? {}
        : { thread_id: optionalThreadId(req.body.thread_id) }),
      ...(req.body?.is_active === undefined
        ? {}
        : { is_active: Boolean(req.body.is_active) }),
      ...(req.body?.sort_order === undefined
        ? {}
        : { sort_order: Number(req.body.sort_order) }),
    });
    if (!updated) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    res.json(updated);
  }),
);

app.delete(
  "/api/categories/:id",
  auth,
  handle((req, res) => {
    if (!deleteCategory(String(req.params.id))) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// RSS manbalari (CRUD)
// ---------------------------------------------------------------------------

app.get(
  "/api/sources",
  auth,
  handle((_req, res) => {
    res.json({ items: listSources(true) });
  }),
);

app.post(
  "/api/sources",
  auth,
  handle((req, res) => {
    const created = createSource({
      name: String(req.body?.name || ""),
      url: String(req.body?.url || ""),
      is_active: req.body?.is_active === undefined ? true : Boolean(req.body.is_active),
    });
    res.status(201).json(created);
  }),
);

app.put(
  "/api/sources/:id",
  auth,
  handle((req, res) => {
    const updated = updateSource(String(req.params.id), {
      ...(req.body?.name === undefined ? {} : { name: String(req.body.name) }),
      ...(req.body?.url === undefined ? {} : { url: String(req.body.url) }),
      ...(req.body?.is_active === undefined
        ? {}
        : { is_active: Boolean(req.body.is_active) }),
      ...(req.body?.sort_order === undefined
        ? {}
        : { sort_order: Number(req.body.sort_order) }),
    });
    if (!updated) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    res.json(updated);
  }),
);

app.delete(
  "/api/sources/:id",
  auth,
  handle((req, res) => {
    if (!deleteSource(String(req.params.id))) {
      res.status(404).json({ error: "Topilmadi" });
      return;
    }
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// TTS sozlamasi
// ---------------------------------------------------------------------------

app.get(
  "/api/settings/tts",
  auth,
  handle((_req, res) => {
    res.json({ enabled: isTtsEnabled(), ffmpeg: hasFfmpeg() });
  }),
);

app.put(
  "/api/settings/tts",
  auth,
  handle((req, res) => {
    setTtsEnabled(Boolean(req.body?.enabled));
    res.json({ enabled: isTtsEnabled(), ffmpeg: hasFfmpeg() });
  }),
);

// ---------------------------------------------------------------------------
// Static + xato ushlagich
// ---------------------------------------------------------------------------

if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get("/", (_req, res) => {
    res.sendFile(join(publicDir, "index.html"));
  });
}

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Server xatosi" });
  },
);

startScheduleWatcher();

app.listen(config.port, () => {
  console.log(`Admin API: http://127.0.0.1:${config.port}`);
  console.log(`UI: http://127.0.0.1:${config.port}/`);
  console.log(
    `Auth: ${[hasToken ? "token" : null, hasTelegramAuth ? "telegram" : null]
      .filter(Boolean)
      .join(" + ")}`,
  );
  if (hasToken) {
    console.log(`  ADMIN_TOKEN: ${config.adminToken.length} belgi`);
  }
  if (hasTelegramAuth) {
    console.log(`  ADMIN_USER_IDS: ${config.adminUserIds.join(", ")}`);
  }
  if (isTtsEnabled() && !hasFfmpeg()) {
    console.warn("TTS yoqilgan, lekin ffmpeg yo‘q — audio yuborilmaydi");
  }
});
