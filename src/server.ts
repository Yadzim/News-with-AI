import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Bot } from "grammy";
import { CATEGORIES, config, type Category } from "./config.js";
import {
  deleteNews,
  getNewsStats,
  getTargetScheduleSettings,
  listNews,
  saveTargetSchedule,
} from "./db.js";
import { fetchAndProcessNews } from "./fetcher.js";
import {
  publishPendingToChannel,
  publishPendingToGroup,
} from "./publisher.js";
import { applyScheduleFromDb, parseHourMinute, startScheduleWatcher } from "./schedule.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

const app = express();
app.use(express.json({ limit: "1mb" }));

function auth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (!config.adminToken) {
    next();
    return;
  }
  const header = req.header("x-admin-token") || "";
  const query = typeof req.query.token === "string" ? req.query.token : "";
  if (header === config.adminToken || query === config.adminToken) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/auth/status", (_req, res) => {
  res.json({ required: Boolean(config.adminToken) });
});

app.get("/api/meta", auth, (_req, res) => {
  res.json({
    categories: CATEGORIES,
    schedule: getTargetScheduleSettings(),
    channelConfigured: Boolean(config.telegramChannelId),
    stats: getNewsStats(),
  });
});

app.get("/api/stats", auth, (_req, res) => {
  res.json(getNewsStats());
});

app.get("/api/news", auth, (req, res) => {
  const categoryRaw = String(req.query.category || "all");
  const category =
    categoryRaw === "all"
      ? "all"
      : (CATEGORIES as readonly string[]).includes(categoryRaw)
        ? (categoryRaw as Category)
        : "all";

  const postedRaw = String(req.query.posted || "all");
  const postedAllowed = [
    "all",
    "yes",
    "no",
    "group_yes",
    "group_no",
    "channel_yes",
    "channel_no",
  ] as const;
  const posted = postedAllowed.includes(postedRaw as (typeof postedAllowed)[number])
    ? (postedRaw as (typeof postedAllowed)[number])
    : "all";

  const result = listNews({
    category,
    posted,
    q: typeof req.query.q === "string" ? req.query.q : undefined,
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 20,
  });

  res.json(result);
});

app.delete("/api/news/:id", auth, (req, res) => {
  const id = String(req.params.id);
  const ok = deleteNews(id);
  if (!ok) {
    res.status(404).json({ error: "Topilmadi" });
    return;
  }
  res.json({ ok: true });
});

app.post("/api/fetch", auth, async (_req, res) => {
  try {
    const added = await fetchAndProcessNews({ maxPerFeed: 5 });
    res.json({ ok: true, added, stats: getNewsStats() });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Fetch xatosi",
    });
  }
});

app.post("/api/publish/group", auth, async (_req, res) => {
  try {
    const bot = new Bot(config.telegramBotToken);
    const published = await publishPendingToGroup(bot, 50);
    res.json({ ok: true, published, stats: getNewsStats() });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Publish xatosi",
    });
  }
});

app.post("/api/publish/channel", auth, async (_req, res) => {
  try {
    if (!config.telegramChannelId) {
      res.status(400).json({ error: "TELEGRAM_CHANNEL_ID sozlanmagan" });
      return;
    }
    const bot = new Bot(config.telegramBotToken);
    const published = await publishPendingToChannel(bot, 50);
    res.json({ ok: true, published, stats: getNewsStats() });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Publish xatosi",
    });
  }
});

/** @deprecated /api/publish/group */
app.post("/api/publish", auth, async (_req, res) => {
  try {
    const bot = new Bot(config.telegramBotToken);
    const published = await publishPendingToGroup(bot, 50);
    res.json({ ok: true, published, stats: getNewsStats() });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Publish xatosi",
    });
  }
});

app.get("/api/schedule", auth, (_req, res) => {
  res.json(getTargetScheduleSettings());
});

app.put("/api/schedule/group", auth, (req, res) => {
  const morning = String(req.body?.morning || "").trim();
  const evening = String(req.body?.evening || "").trim();
  const enabled = Boolean(req.body?.enabled);

  if (!parseHourMinute(morning) || !parseHourMinute(evening)) {
    res.status(400).json({ error: "Vaqt HH:MM formatida bo‘lishi kerak" });
    return;
  }

  const saved = saveTargetSchedule("group", { morning, evening, enabled });
  const applied = applyScheduleFromDb();
  res.json({ ...saved, applied: applied.message });
});

app.put("/api/schedule/channel", auth, (req, res) => {
  const morning = String(req.body?.morning || "").trim();
  const evening = String(req.body?.evening || "").trim();
  const enabled = Boolean(req.body?.enabled);

  if (!parseHourMinute(morning) || !parseHourMinute(evening)) {
    res.status(400).json({ error: "Vaqt HH:MM formatida bo‘lishi kerak" });
    return;
  }

  const saved = saveTargetSchedule("channel", { morning, evening, enabled });
  const applied = applyScheduleFromDb();
  res.json({ ...saved, applied: applied.message });
});

/** @deprecated /api/schedule/group */
app.put("/api/schedule", auth, (req, res) => {
  const morning = String(req.body?.morning || "").trim();
  const evening = String(req.body?.evening || "").trim();
  const enabled = Boolean(req.body?.enabled);

  if (!parseHourMinute(morning) || !parseHourMinute(evening)) {
    res.status(400).json({ error: "Vaqt HH:MM formatida bo‘lishi kerak" });
    return;
  }

  const saved = saveTargetSchedule("group", { morning, evening, enabled });
  const applied = applyScheduleFromDb();
  res.json({ ...saved, applied: applied.message });
});

if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get("/", (_req, res) => {
    res.sendFile(join(publicDir, "index.html"));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Server xatosi" });
});

startScheduleWatcher();

app.listen(config.port, () => {
  console.log(`Admin API: http://127.0.0.1:${config.port}`);
  console.log(`UI: http://127.0.0.1:${config.port}/`);
});
