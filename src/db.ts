import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { CATEGORIES, config, type Category } from "./config.js";
import { normalizeSourceUrl } from "./url.js";

export type NewsRow = {
  id: string;
  source_url: string;
  title_original: string | null;
  title_uz: string | null;
  summary_uz: string | null;
  category: Category | null;
  published_at: string | null;
  is_posted: number;
  is_posted_channel: number;
  created_at: string;
};

mkdirSync(dirname(config.databasePath), { recursive: true });

export const db: BetterSqlite3.Database = new Database(config.databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS news (
    id TEXT PRIMARY KEY,
    source_url TEXT UNIQUE NOT NULL,
    title_original TEXT,
    title_uz TEXT,
    summary_uz TEXT,
    category TEXT CHECK(category IN ('AI','Hardware','Cybersecurity','Startups','General Tech')),
    published_at TEXT,
    is_posted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS topic_mappings (
    category TEXT PRIMARY KEY,
    thread_id INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_news_category_created
    ON news(category, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_news_is_posted
    ON news(is_posted, created_at ASC);
`);

const upsertTopic = db.prepare(`
  INSERT INTO topic_mappings (category, thread_id)
  VALUES (@category, @thread_id)
  ON CONFLICT(category) DO UPDATE SET thread_id = excluded.thread_id
`);

for (const category of CATEGORIES) {
  upsertTopic.run({ category, thread_id: config.topics[category] });
}

const DEFAULT_SETTINGS: Record<string, string> = {
  schedule_morning: "08:00",
  schedule_evening: "20:00",
  schedule_enabled: "1",
};

const insertSettingIfMissing = db.prepare(`
  INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
`);

for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  insertSettingIfMissing.run(key, value);
}

// Migratsiya: kanal ustuni
const newsCols = db
  .prepare("PRAGMA table_info(news)")
  .all() as { name: string }[];
if (!newsCols.some((c) => c.name === "is_posted_channel")) {
  db.exec(`ALTER TABLE news ADD COLUMN is_posted_channel INTEGER DEFAULT 0`);
}

export function newsExists(sourceUrl: string): boolean {
  const normalized = normalizeSourceUrl(sourceUrl);
  const row = db
    .prepare("SELECT 1 AS ok FROM news WHERE source_url = ?")
    .get(normalized) as { ok: number } | undefined;
  return Boolean(row);
}

export type InsertNewsInput = {
  source_url: string;
  title_original: string;
  title_uz: string;
  summary_uz: string;
  category: Category;
  published_at: string | null;
};

export function insertNews(input: InsertNewsInput): NewsRow {
  const id = randomUUID();
  const source_url = normalizeSourceUrl(input.source_url);
  db.prepare(
    `INSERT INTO news (
      id, source_url, title_original, title_uz, summary_uz, category, published_at, is_posted
    ) VALUES (
      @id, @source_url, @title_original, @title_uz, @summary_uz, @category, @published_at, 0
    )`,
  ).run({ id, ...input, source_url });

  return getNewsById(id)!;
}

export function getNewsById(id: string): NewsRow | undefined {
  return db.prepare("SELECT * FROM news WHERE id = ?").get(id) as
    | NewsRow
    | undefined;
}

export function getPendingNewsForGroup(limit = 20): NewsRow[] {
  return db
    .prepare(
      `SELECT * FROM news
       WHERE is_posted = 0
         AND title_uz IS NOT NULL
         AND summary_uz IS NOT NULL
         AND category IS NOT NULL
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(limit) as NewsRow[];
}

export function getPendingNewsForChannel(limit = 20): NewsRow[] {
  return db
    .prepare(
      `SELECT * FROM news
       WHERE is_posted_channel = 0
         AND title_uz IS NOT NULL
         AND summary_uz IS NOT NULL
         AND category IS NOT NULL
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(limit) as NewsRow[];
}

/** @deprecated getPendingNewsForGroup ishlating */
export function getPendingNews(limit = 20): NewsRow[] {
  return getPendingNewsForGroup(limit);
}

export function markNewsPostedToGroup(id: string): void {
  db.prepare("UPDATE news SET is_posted = 1 WHERE id = ?").run(id);
}

export function markNewsPostedToChannel(id: string): void {
  db.prepare("UPDATE news SET is_posted_channel = 1 WHERE id = ?").run(id);
}

/** @deprecated */
export function markNewsPosted(id: string): void {
  markNewsPostedToGroup(id);
}

export function claimNewsForGroupPosting(id: string): boolean {
  const result = db
    .prepare("UPDATE news SET is_posted = 1 WHERE id = ? AND is_posted = 0")
    .run(id);
  return result.changes === 1;
}

export function claimNewsForChannelPosting(id: string): boolean {
  const result = db
    .prepare(
      "UPDATE news SET is_posted_channel = 1 WHERE id = ? AND is_posted_channel = 0",
    )
    .run(id);
  return result.changes === 1;
}

/** @deprecated */
export function claimNewsForPosting(id: string): boolean {
  return claimNewsForGroupPosting(id);
}

export function unclaimGroupNews(id: string): void {
  db.prepare("UPDATE news SET is_posted = 0 WHERE id = ? AND is_posted = 1").run(
    id,
  );
}

export function unclaimChannelNews(id: string): void {
  db
    .prepare(
      "UPDATE news SET is_posted_channel = 0 WHERE id = ? AND is_posted_channel = 1",
    )
    .run(id);
}

/** @deprecated */
export function unclaimNews(id: string): void {
  unclaimGroupNews(id);
}

/** Bir xil sarlavha (taxminan) allaqachon bor-yo‘qligi */
export function similarTitleExists(title: string): boolean {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized.length < 12) return false;

  const rows = db
    .prepare(
      `SELECT title_original, title_uz FROM news
       WHERE created_at >= datetime('now', '-14 days')
       ORDER BY created_at DESC
       LIMIT 200`,
    )
    .all() as { title_original: string | null; title_uz: string | null }[];

  for (const row of rows) {
    for (const t of [row.title_original, row.title_uz]) {
      if (!t) continue;
      const other = t.trim().toLowerCase().replace(/\s+/g, " ");
      if (other === normalized) return true;
    }
  }
  return false;
}

export function getNewsByCategory(
  category: Category,
  offset = 0,
  limit = 1,
): NewsRow[] {
  return db
    .prepare(
      `SELECT * FROM news
       WHERE category = ?
         AND title_uz IS NOT NULL
         AND summary_uz IS NOT NULL
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(category, limit, offset) as NewsRow[];
}

export function getThreadId(category: Category): number {
  const row = db
    .prepare("SELECT thread_id FROM topic_mappings WHERE category = ?")
    .get(category) as { thread_id: number } | undefined;

  if (!row) {
    throw new Error(`Topic mapping topilmadi: ${category}`);
  }

  return row.thread_id;
}

export function getCategoryByThreadId(threadId: number): Category | null {
  const row = db
    .prepare("SELECT category FROM topic_mappings WHERE thread_id = ?")
    .get(threadId) as { category: string } | undefined;

  if (!row || !(CATEGORIES as readonly string[]).includes(row.category)) {
    return null;
  }

  return row.category as Category;
}

export function getSetting(key: string): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export type ScheduleSettings = {
  morning: string;
  evening: string;
  enabled: boolean;
};

export type TargetScheduleSettings = {
  group: ScheduleSettings;
  channel: ScheduleSettings;
};

function readSchedule(prefix: "group" | "channel"): ScheduleSettings {
  return {
    morning: getSetting(`schedule_${prefix}_morning`) || "08:00",
    evening: getSetting(`schedule_${prefix}_evening`) || "20:00",
    enabled: (getSetting(`schedule_${prefix}_enabled`) || "1") === "1",
  };
}

export function getTargetScheduleSettings(): TargetScheduleSettings {
  return {
    group: readSchedule("group"),
    channel: readSchedule("channel"),
  };
}

/** @deprecated getTargetScheduleSettings().group */
export function getScheduleSettings(): ScheduleSettings {
  return readSchedule("group");
}

export function saveTargetSchedule(
  target: "group" | "channel",
  input: ScheduleSettings,
): ScheduleSettings {
  setSetting(`schedule_${target}_morning`, input.morning);
  setSetting(`schedule_${target}_evening`, input.evening);
  setSetting(`schedule_${target}_enabled`, input.enabled ? "1" : "0");
  return readSchedule(target);
}

/** @deprecated saveTargetSchedule('group', ...) */
export function saveScheduleSettings(input: ScheduleSettings): ScheduleSettings {
  return saveTargetSchedule("group", input);
}

function migrateScheduleSettings(): void {
  const legacyMorning = getSetting("schedule_morning");
  const legacyEvening = getSetting("schedule_evening");
  const legacyEnabled = getSetting("schedule_enabled");
  if (legacyMorning && !getSetting("schedule_group_morning")) {
    setSetting("schedule_group_morning", legacyMorning);
  }
  if (legacyEvening && !getSetting("schedule_group_evening")) {
    setSetting("schedule_group_evening", legacyEvening);
  }
  if (legacyEnabled && !getSetting("schedule_group_enabled")) {
    setSetting("schedule_group_enabled", legacyEnabled);
  }

  const defaults: Record<string, string> = {
    schedule_group_morning: "08:00",
    schedule_group_evening: "20:00",
    schedule_group_enabled: "1",
    schedule_channel_morning: "09:00",
    schedule_channel_evening: "21:00",
    schedule_channel_enabled: "1",
  };
  for (const [key, value] of Object.entries(defaults)) {
    insertSettingIfMissing.run(key, value);
  }
}

migrateScheduleSettings();

export type ListNewsFilters = {
  category?: Category | "all";
  posted?:
    | "all"
    | "yes"
    | "no"
    | "group_yes"
    | "group_no"
    | "channel_yes"
    | "channel_no";
  q?: string;
  page?: number;
  limit?: number;
};

export function listNews(filters: ListNewsFilters = {}): {
  items: NewsRow[];
  total: number;
  page: number;
  limit: number;
} {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.category && filters.category !== "all") {
    where.push("category = ?");
    params.push(filters.category);
  }

  if (filters.posted === "yes") {
    where.push("is_posted = 1");
  } else if (filters.posted === "no") {
    where.push("is_posted = 0");
  } else if (filters.posted === "channel_yes") {
    where.push("is_posted_channel = 1");
  } else if (filters.posted === "channel_no") {
    where.push("is_posted_channel = 0");
  } else if (filters.posted === "group_yes") {
    where.push("is_posted = 1");
  } else if (filters.posted === "group_no") {
    where.push("is_posted = 0");
  }

  if (filters.q?.trim()) {
    where.push("(title_uz LIKE ? OR title_original LIKE ? OR summary_uz LIKE ?)");
    const like = `%${filters.q.trim()}%`;
    params.push(like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM news ${whereSql}`).get(...params) as {
      c: number;
    }
  ).c;

  const items = db
    .prepare(
      `SELECT * FROM news ${whereSql}
       ORDER BY datetime(created_at) DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as NewsRow[];

  return { items, total, page, limit };
}

export function getNewsStats(): {
  total: number;
  pending: number;
  posted: number;
  pendingGroup: number;
  postedGroup: number;
  pendingChannel: number;
  postedChannel: number;
  byCategory: { category: string; count: number }[];
} {
  const total = (db.prepare("SELECT COUNT(*) AS c FROM news").get() as { c: number }).c;
  const pendingGroup = (
    db.prepare("SELECT COUNT(*) AS c FROM news WHERE is_posted = 0").get() as {
      c: number;
    }
  ).c;
  const postedGroup = (
    db.prepare("SELECT COUNT(*) AS c FROM news WHERE is_posted = 1").get() as {
      c: number;
    }
  ).c;
  const pendingChannel = (
    db
      .prepare("SELECT COUNT(*) AS c FROM news WHERE is_posted_channel = 0")
      .get() as { c: number }
  ).c;
  const postedChannel = (
    db
      .prepare("SELECT COUNT(*) AS c FROM news WHERE is_posted_channel = 1")
      .get() as { c: number }
  ).c;
  const byCategory = db
    .prepare(
      `SELECT COALESCE(category, 'Unknown') AS category, COUNT(*) AS count
       FROM news GROUP BY category ORDER BY count DESC`,
    )
    .all() as { category: string; count: number }[];

  return {
    total,
    pending: pendingGroup,
    posted: postedGroup,
    pendingGroup,
    postedGroup,
    pendingChannel,
    postedChannel,
    byCategory,
  };
}

export function deleteNews(id: string): boolean {
  const result = db.prepare("DELETE FROM news WHERE id = ?").run(id);
  return result.changes > 0;
}
