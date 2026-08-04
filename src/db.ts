import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { SEED_CATEGORIES, config, type Category } from "./config.js";
import { isSameFeed, normalizeSourceUrl, sanitizeFeedUrl } from "./url.js";

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
  audio_path: string | null;
  /** Bir voqea haqidagi turli manbalar bitta cluster_id ostida turadi */
  cluster_id: string | null;
  /** Klasterdan faqat primary post qilinadi */
  is_primary: number;
  /** AI bergan qisqa voqea kaliti — klasterlash shu bo‘yicha */
  topic_key: string | null;
  merged_at: string | null;
  created_at: string;
};

export type CategoryRow = {
  id: string;
  name: string;
  thread_id: number | null;
  is_active: number;
  sort_order: number;
  created_at: string;
};

export type SourceRow = {
  id: string;
  name: string;
  url: string;
  is_active: number;
  sort_order: number;
  last_fetched_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_added: number;
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
    category TEXT,
    published_at TEXT,
    is_posted INTEGER NOT NULL DEFAULT 0,
    is_posted_channel INTEGER NOT NULL DEFAULT 0,
    audio_path TEXT,
    cluster_id TEXT,
    is_primary INTEGER NOT NULL DEFAULT 1,
    topic_key TEXT,
    merged_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    thread_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    last_fetched_at TEXT,
    last_status TEXT,
    last_error TEXT,
    last_added INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deleted_urls (
    source_url TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------------------------------------------------------------------------
// Settings (migratsiyalardan oldin kerak)
// ---------------------------------------------------------------------------

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

const insertSettingIfMissing = db.prepare(
  "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
);

// ---------------------------------------------------------------------------
// Migratsiyalar
// ---------------------------------------------------------------------------

function addMissingNewsColumns(): void {
  const cols = (
    db.prepare("PRAGMA table_info(news)").all() as { name: string }[]
  ).map((c) => c.name);

  if (!cols.includes("is_posted_channel")) {
    db.exec("ALTER TABLE news ADD COLUMN is_posted_channel INTEGER DEFAULT 0");
  }
  if (!cols.includes("audio_path")) {
    db.exec("ALTER TABLE news ADD COLUMN audio_path TEXT");
  }

  // Klasterlash: bir voqea haqidagi turli manbalar bitta cluster_id ostida
  if (!cols.includes("cluster_id")) {
    db.exec("ALTER TABLE news ADD COLUMN cluster_id TEXT");
    db.exec("UPDATE news SET cluster_id = id WHERE cluster_id IS NULL");
  }
  if (!cols.includes("is_primary")) {
    db.exec("ALTER TABLE news ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 1");
  }
  if (!cols.includes("topic_key")) {
    db.exec("ALTER TABLE news ADD COLUMN topic_key TEXT");
  }
  if (!cols.includes("merged_at")) {
    db.exec("ALTER TABLE news ADD COLUMN merged_at TEXT");
  }
}

/**
 * Eski sxemada `category` ustunida qat’iy CHECK bor edi — dinamik
 * kategoriyalar bilan u yangi nomlarni rad etadi. SQLite CHECK ni ALTER
 * bilan olib tashlay olmagani uchun jadval qayta quriladi.
 */
function dropCategoryCheckConstraint(): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='news'")
    .get() as { sql: string | null } | undefined;

  if (!row?.sql || !/CHECK\s*\(\s*category/i.test(row.sql)) return;

  console.log("Migratsiya: news.category CHECK constrainti olib tashlanmoqda...");
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      BEGIN;
      CREATE TABLE news_migrated (
        id TEXT PRIMARY KEY,
        source_url TEXT UNIQUE NOT NULL,
        title_original TEXT,
        title_uz TEXT,
        summary_uz TEXT,
        category TEXT,
        published_at TEXT,
        is_posted INTEGER NOT NULL DEFAULT 0,
        is_posted_channel INTEGER NOT NULL DEFAULT 0,
        audio_path TEXT,
        cluster_id TEXT,
        is_primary INTEGER NOT NULL DEFAULT 1,
        topic_key TEXT,
        merged_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO news_migrated (
        id, source_url, title_original, title_uz, summary_uz, category,
        published_at, is_posted, is_posted_channel, audio_path,
        cluster_id, is_primary, topic_key, merged_at, created_at
      )
      SELECT
        id, source_url, title_original, title_uz, summary_uz, category,
        published_at, COALESCE(is_posted, 0), COALESCE(is_posted_channel, 0),
        audio_path, COALESCE(cluster_id, id), COALESCE(is_primary, 1),
        topic_key, merged_at, created_at
      FROM news;
      DROP TABLE news;
      ALTER TABLE news_migrated RENAME TO news;
      COMMIT;
    `);
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* tranzaksiya allaqachon yopilgan */
    }
    throw err;
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

export type ScheduleSettings = {
  /** Kuniga necha marta va qaysi vaqtda — "HH:MM" ro‘yxati */
  times: string[];
  enabled: boolean;
  /** Bir yuborishda nechta post ketsin */
  limit: number;
};

const SCHEDULE_DEFAULTS: Record<"group" | "channel", ScheduleSettings> = {
  group: { times: ["08:00", "20:00"], enabled: true, limit: 50 },
  channel: { times: ["08:00", "14:00", "20:00"], enabled: true, limit: 5 },
};

export const DEFAULT_SOURCES: { name: string; url: string }[] = [
  { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
  { name: "Wired", url: "https://www.wired.com/feed/rss" },
  { name: "Hacker News", url: "https://hnrss.org/frontpage" },
  {
    name: "MIT Technology Review",
    url: "https://www.technologyreview.com/feed/",
  },
  { name: "The Next Web", url: "https://thenextweb.com/feed" },
];

function seedCategories(): void {
  const count = (
    db.prepare("SELECT COUNT(*) AS c FROM categories").get() as { c: number }
  ).c;
  if (count > 0) return;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO categories (id, name, thread_id, is_active, sort_order)
     VALUES (?, ?, ?, 1, ?)`,
  );

  // Eski `topic_mappings` jadvali bo‘lsa — undan ko‘chiramiz
  const legacy = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='topic_mappings'",
    )
    .get() as { name: string } | undefined;

  if (legacy) {
    const rows = db
      .prepare("SELECT category, thread_id FROM topic_mappings")
      .all() as { category: string; thread_id: number }[];
    rows.forEach((row, i) => insert.run(randomUUID(), row.category, row.thread_id, i));
    if (rows.length) {
      console.log(
        `Migratsiya: ${rows.length} kategoriya topic_mappings dan ko‘chirildi`,
      );
    }
  }

  SEED_CATEGORIES.forEach((seed, i) =>
    insert.run(randomUUID(), seed.name, seed.threadId ?? null, i),
  );

  // Bazada bor, lekin ro‘yxatga tushmagan kategoriyalar yo‘qolmasin
  const orphans = db
    .prepare(
      `SELECT DISTINCT category FROM news
       WHERE category IS NOT NULL
         AND category NOT IN (SELECT name FROM categories)`,
    )
    .all() as { category: string }[];
  orphans.forEach((row, i) =>
    insert.run(randomUUID(), row.category, null, SEED_CATEGORIES.length + i),
  );
}

function seedSources(): void {
  const count = (
    db.prepare("SELECT COUNT(*) AS c FROM sources").get() as { c: number }
  ).c;
  if (count > 0) return;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO sources (id, name, url, is_active, sort_order)
     VALUES (?, ?, ?, 1, ?)`,
  );
  DEFAULT_SOURCES.forEach((source, i) =>
    insert.run(randomUUID(), source.name, source.url, i),
  );
}

function migrateSettings(): void {
  // Eng eski sxema: bitta umumiy morning/evening
  for (const [from, to] of [
    ["schedule_morning", "schedule_group_morning"],
    ["schedule_evening", "schedule_group_evening"],
    ["schedule_enabled", "schedule_group_enabled"],
  ] as const) {
    const value = getSetting(from);
    if (value && !getSetting(to)) setSetting(to, value);
  }

  // morning/evening → times ro‘yxati (ixtiyoriy sondagi vaqt uchun)
  for (const target of ["group", "channel"] as const) {
    if (getSetting(`schedule_${target}_times`)) continue;

    const legacy = [
      getSetting(`schedule_${target}_morning`),
      getSetting(`schedule_${target}_evening`),
    ].filter((value): value is string => Boolean(value));

    if (legacy.length > 0) {
      setSetting(`schedule_${target}_times`, legacy.join(","));
      console.log(
        `Migratsiya: ${target} jadvali times ga ko‘chirildi (${legacy.join(", ")})`,
      );
    }
  }

  const defaults: Record<string, string> = {
    schedule_group_times: SCHEDULE_DEFAULTS.group.times.join(","),
    schedule_group_enabled: "1",
    schedule_group_limit: String(SCHEDULE_DEFAULTS.group.limit),
    schedule_channel_times: SCHEDULE_DEFAULTS.channel.times.join(","),
    schedule_channel_enabled: "1",
    schedule_channel_limit: String(SCHEDULE_DEFAULTS.channel.limit),
    tts_enabled: "0",
  };
  for (const [key, value] of Object.entries(defaults)) {
    insertSettingIfMissing.run(key, value);
  }
}

addMissingNewsColumns();
dropCategoryCheckConstraint();
seedCategories();
seedSources();
migrateSettings();

// CHECK migratsiyasi jadvalni qayta qurgani uchun indekslar shundan keyin
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_news_category_created
    ON news(category, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_news_is_posted
    ON news(is_posted, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_news_is_posted_channel
    ON news(is_posted_channel, created_at ASC);
`);

// Ma’lumot `categories` ga ko‘chirildi — eski jadval endi kerak emas
db.exec("DROP TABLE IF EXISTS topic_mappings");

// ---------------------------------------------------------------------------
// TTS sozlamasi
// ---------------------------------------------------------------------------

export function isTtsEnabled(): boolean {
  return getSetting("tts_enabled") === "1";
}

export function setTtsEnabled(enabled: boolean): void {
  setSetting("tts_enabled", enabled ? "1" : "0");
}

// ---------------------------------------------------------------------------
// Kategoriyalar
// ---------------------------------------------------------------------------

export function listCategories(includeInactive = true): CategoryRow[] {
  return db
    .prepare(
      `SELECT * FROM categories
       ${includeInactive ? "" : "WHERE is_active = 1"}
       ORDER BY sort_order ASC, name ASC`,
    )
    .all() as CategoryRow[];
}

export function listActiveCategories(): CategoryRow[] {
  return listCategories(false);
}

export function listActiveCategoryNames(): string[] {
  return listActiveCategories().map((c) => c.name);
}

export function getCategoryByName(name: string): CategoryRow | undefined {
  return db
    .prepare("SELECT * FROM categories WHERE name = ? COLLATE NOCASE")
    .get(name.trim()) as CategoryRow | undefined;
}

export function getCategoryById(id: string): CategoryRow | undefined {
  return db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as
    | CategoryRow
    | undefined;
}

/** Guruh topic’i (`message_thread_id`). Biriktirilmagan bo‘lsa `null`. */
export function getThreadId(name: string): number | null {
  return getCategoryByName(name)?.thread_id ?? null;
}

export function getCategoryByThreadId(
  threadId: number,
): CategoryRow | undefined {
  return db
    .prepare("SELECT * FROM categories WHERE thread_id = ? AND is_active = 1")
    .get(threadId) as CategoryRow | undefined;
}

export type CategoryInput = {
  name: string;
  thread_id?: number | null;
  is_active?: boolean;
  sort_order?: number;
};

export function createCategory(input: CategoryInput): CategoryRow {
  const name = input.name.trim();
  if (!name) throw new Error("Kategoriya nomi bo‘sh bo‘lmasligi kerak");
  if (getCategoryByName(name)) {
    throw new Error(`"${name}" kategoriyasi allaqachon mavjud`);
  }

  const maxOrder = (
    db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories")
      .get() as { m: number }
  ).m;

  const id = randomUUID();
  db.prepare(
    `INSERT INTO categories (id, name, thread_id, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    input.thread_id ?? null,
    input.is_active === false ? 0 : 1,
    input.sort_order ?? maxOrder + 1,
  );

  return getCategoryById(id)!;
}

export function updateCategory(
  id: string,
  input: Partial<CategoryInput>,
): CategoryRow | undefined {
  const current = getCategoryById(id);
  if (!current) return undefined;

  const name = input.name?.trim() || current.name;
  if (name.toLowerCase() !== current.name.toLowerCase()) {
    const clash = getCategoryByName(name);
    if (clash && clash.id !== id) {
      throw new Error(`"${name}" kategoriyasi allaqachon mavjud`);
    }
  }

  db.prepare(
    `UPDATE categories
     SET name = ?, thread_id = ?, is_active = ?, sort_order = ?
     WHERE id = ?`,
  ).run(
    name,
    input.thread_id === undefined ? current.thread_id : input.thread_id,
    input.is_active === undefined ? current.is_active : input.is_active ? 1 : 0,
    input.sort_order ?? current.sort_order,
    id,
  );

  // Nom o‘zgarsa mavjud yangiliklar ham yangi nomga ko‘chadi
  if (name !== current.name) {
    db.prepare("UPDATE news SET category = ? WHERE category = ?").run(
      name,
      current.name,
    );
  }

  return getCategoryById(id);
}

export function deleteCategory(id: string): boolean {
  return db.prepare("DELETE FROM categories WHERE id = ?").run(id).changes > 0;
}

/**
 * AI qaytargan nomni mavjud aktiv kategoriyaga moslashtiradi.
 * Mos kelmasa — "General Tech", u ham bo‘lmasa birinchi aktiv kategoriya.
 */
export function resolveCategoryName(raw: string): string | null {
  const active = listActiveCategoryNames();
  if (active.length === 0) return null;

  const needle = raw.trim().toLowerCase();
  const exact = active.find((name) => name.toLowerCase() === needle);
  if (exact) return exact;

  const collapsed = needle.replace(/\s+/g, "");
  const loose = active.find(
    (name) => name.toLowerCase().replace(/\s+/g, "") === collapsed,
  );
  if (loose) return loose;

  return active.find((name) => name === "General Tech") ?? active[0]!;
}

// ---------------------------------------------------------------------------
// Manbalar (RSS)
// ---------------------------------------------------------------------------

export function listSources(includeInactive = true): SourceRow[] {
  return db
    .prepare(
      `SELECT * FROM sources
       ${includeInactive ? "" : "WHERE is_active = 1"}
       ORDER BY sort_order ASC, name ASC`,
    )
    .all() as SourceRow[];
}

export function listActiveSources(): SourceRow[] {
  return listSources(false);
}

export function getSourceById(id: string): SourceRow | undefined {
  return db.prepare("SELECT * FROM sources WHERE id = ?").get(id) as
    | SourceRow
    | undefined;
}

export type SourceInput = {
  name: string;
  url: string;
  is_active?: boolean;
  sort_order?: number;
};

/** `www.` / oxirgi slash farqi bilan ham bir xil feed ikki marta qo‘shilmasin */
function findSourceByFeed(url: string, exceptId?: string): SourceRow | undefined {
  return listSources(true).find(
    (source) => source.id !== exceptId && isSameFeed(source.url, url),
  );
}

export function createSource(input: SourceInput): SourceRow {
  const name = input.name.trim();
  const url = sanitizeFeedUrl(input.url);
  if (!name) throw new Error("Manba nomi bo‘sh bo‘lmasligi kerak");
  if (!url) throw new Error("URL http yoki https bo‘lishi kerak");

  if (findSourceByFeed(url)) {
    throw new Error("Bu URL allaqachon qo‘shilgan");
  }

  const maxOrder = (
    db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM sources").get() as {
      m: number;
    }
  ).m;

  const id = randomUUID();
  db.prepare(
    `INSERT INTO sources (id, name, url, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    url,
    input.is_active === false ? 0 : 1,
    input.sort_order ?? maxOrder + 1,
  );

  return getSourceById(id)!;
}

export function updateSource(
  id: string,
  input: Partial<SourceInput>,
): SourceRow | undefined {
  const current = getSourceById(id);
  if (!current) return undefined;

  let url = current.url;
  if (input.url !== undefined) {
    const sanitized = sanitizeFeedUrl(input.url);
    if (!sanitized) throw new Error("URL http yoki https bo‘lishi kerak");
    if (findSourceByFeed(sanitized, id)) {
      throw new Error("Bu URL allaqachon qo‘shilgan");
    }
    url = sanitized;
  }

  db.prepare(
    "UPDATE sources SET name = ?, url = ?, is_active = ?, sort_order = ? WHERE id = ?",
  ).run(
    input.name?.trim() || current.name,
    url,
    input.is_active === undefined ? current.is_active : input.is_active ? 1 : 0,
    input.sort_order ?? current.sort_order,
    id,
  );

  return getSourceById(id);
}

export function deleteSource(id: string): boolean {
  return db.prepare("DELETE FROM sources WHERE id = ?").run(id).changes > 0;
}

export function recordSourceResult(
  id: string,
  result: { added: number; error?: string },
): void {
  db.prepare(
    `UPDATE sources
     SET last_fetched_at = datetime('now'),
         last_status = ?,
         last_error = ?,
         last_added = ?
     WHERE id = ?`,
  ).run(result.error ? "error" : "ok", result.error ?? null, result.added, id);
}

// ---------------------------------------------------------------------------
// Yangiliklar
// ---------------------------------------------------------------------------

export function newsExists(sourceUrl: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM news WHERE source_url = ?")
    .get(normalizeSourceUrl(sourceUrl)) as { ok: number } | undefined;
  return Boolean(row);
}

export function rememberDeletedUrl(sourceUrl: string): void {
  db.prepare("INSERT OR IGNORE INTO deleted_urls (source_url) VALUES (?)").run(
    normalizeSourceUrl(sourceUrl),
  );
}

export function isUrlDeleted(sourceUrl: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM deleted_urls WHERE source_url = ?")
    .get(normalizeSourceUrl(sourceUrl)) as { ok: number } | undefined;
  return Boolean(row);
}

/** Qayta olib kelmaslik kerak: allaqachon bor yoki qo‘lda o‘chirilgan */
export function isUrlBlocked(sourceUrl: string): boolean {
  return newsExists(sourceUrl) || isUrlDeleted(sourceUrl);
}

export type InsertNewsInput = {
  source_url: string;
  title_original: string;
  title_uz: string;
  summary_uz: string;
  category: Category;
  published_at: string | null;
  topic_key?: string | null;
  /** Mavjud klasterga qo‘shilsa — o‘sha cluster_id */
  cluster_id?: string | null;
};

export function insertNews(input: InsertNewsInput): NewsRow {
  const id = randomUUID();
  const source_url = normalizeSourceUrl(input.source_url);
  const clusterId = input.cluster_id ?? id;

  db.prepare(
    `INSERT INTO news (
      id, source_url, title_original, title_uz, summary_uz, category,
      published_at, is_posted, cluster_id, is_primary, topic_key
    ) VALUES (
      @id, @source_url, @title_original, @title_uz, @summary_uz, @category,
      @published_at, 0, @cluster_id, @is_primary, @topic_key
    )`,
  ).run({
    id,
    source_url,
    title_original: input.title_original,
    title_uz: input.title_uz,
    summary_uz: input.summary_uz,
    category: input.category,
    published_at: input.published_at,
    cluster_id: clusterId,
    // Mavjud klasterga qo‘shilgan bo‘lsa — bu qo‘shimcha manba, alohida
    // post qilinmaydi
    is_primary: input.cluster_id ? 0 : 1,
    topic_key: input.topic_key ?? null,
  });

  return getNewsById(id)!;
}

// ---------------------------------------------------------------------------
// Klasterlash — bir voqea, bir nechta manba
// ---------------------------------------------------------------------------

/** `topic_key` ni taqqoslash uchun so‘zlar to‘plami */
export function topicKeyTokens(key: string): Set<string> {
  return new Set(
    key
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1),
  );
}

export const TOPIC_MATCH_THRESHOLD = 0.6;

/**
 * Shu voqea haqidagi yangilik allaqachon bormi. Bor bo‘lsa uning
 * `cluster_id` si qaytadi — yangi yozuv o‘sha klasterga qo‘shiladi.
 *
 * Faqat hali kanalga yuborilmagan va yaqinda kelgan yangiliklar tekshiriladi:
 * eski postga keyin qo‘shilsa ham foydasi yo‘q.
 */
export function findClusterForTopic(
  topicKey: string,
  withinHours = 48,
): string | null {
  const tokens = topicKeyTokens(topicKey);
  if (tokens.size === 0) return null;

  const rows = db
    .prepare(
      `SELECT cluster_id, topic_key FROM news
       WHERE topic_key IS NOT NULL
         AND is_posted_channel = 0
         AND created_at >= datetime('now', ?)
       ORDER BY created_at DESC
       LIMIT 300`,
    )
    .all(`-${withinHours} hours`) as {
    cluster_id: string | null;
    topic_key: string;
  }[];

  for (const row of rows) {
    if (!row.cluster_id) continue;
    const similarity = jaccardSimilarity(tokens, topicKeyTokens(row.topic_key));
    if (similarity >= TOPIC_MATCH_THRESHOLD) return row.cluster_id;
  }

  return null;
}

export function getClusterMembers(clusterId: string): NewsRow[] {
  return db
    .prepare(
      `SELECT * FROM news WHERE cluster_id = ?
       ORDER BY is_primary DESC, created_at ASC`,
    )
    .all(clusterId) as NewsRow[];
}

/** Klasterdagi manbalar soni */
export function getClusterSize(clusterId: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS c FROM news WHERE cluster_id = ?")
      .get(clusterId) as { c: number }
  ).c;
}

/** Umumiy xulosa yaratilgach primary yozuvni yangilaydi */
export function applyMergedSummary(
  id: string,
  input: { title_uz: string; summary_uz: string; category: Category },
): void {
  db.prepare(
    `UPDATE news
     SET title_uz = ?, summary_uz = ?, category = ?, merged_at = datetime('now')
     WHERE id = ?`,
  ).run(input.title_uz, input.summary_uz, input.category, id);
}

/** Klasterning barcha a’zolarini yuborilgan deb belgilaydi */
export function markClusterPosted(
  clusterId: string,
  target: "group" | "channel",
): void {
  const column = target === "group" ? "is_posted" : "is_posted_channel";
  db.prepare(`UPDATE news SET ${column} = 1 WHERE cluster_id = ?`).run(clusterId);
}

export function getNewsById(id: string): NewsRow | undefined {
  return db.prepare("SELECT * FROM news WHERE id = ?").get(id) as
    | NewsRow
    | undefined;
}

export function setNewsAudioPath(id: string, path: string | null): void {
  db.prepare("UPDATE news SET audio_path = ? WHERE id = ?").run(path, id);
}

export function getPendingNewsForGroup(limit = 20): NewsRow[] {
  return db
    .prepare(
      `SELECT * FROM news
       WHERE is_posted = 0
         AND is_primary = 1
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
         AND is_primary = 1
         AND title_uz IS NOT NULL
         AND summary_uz IS NOT NULL
         AND category IS NOT NULL
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(limit) as NewsRow[];
}

export function claimNewsForGroupPosting(id: string): boolean {
  return (
    db
      .prepare("UPDATE news SET is_posted = 1 WHERE id = ? AND is_posted = 0")
      .run(id).changes === 1
  );
}

export function claimNewsForChannelPosting(id: string): boolean {
  return (
    db
      .prepare(
        "UPDATE news SET is_posted_channel = 1 WHERE id = ? AND is_posted_channel = 0",
      )
      .run(id).changes === 1
  );
}

export function unclaimGroupNews(id: string): void {
  db.prepare("UPDATE news SET is_posted = 0 WHERE id = ? AND is_posted = 1").run(
    id,
  );
}

export function unclaimChannelNews(id: string): void {
  db.prepare(
    "UPDATE news SET is_posted_channel = 0 WHERE id = ? AND is_posted_channel = 1",
  ).run(id);
}

/** Sarlavhani taqqoslash uchun ma’noli so‘zlar to‘plami */
export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

export const SIMILARITY_THRESHOLD = 0.85;

/** So‘nggi 14 kunda shu sarlavhaga juda yaqin yangilik bormi */
export function similarTitleExists(title: string): boolean {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized.length < 12) return false;

  const tokens = titleTokens(title);

  const rows = db
    .prepare(
      `SELECT title_original, title_uz FROM news
       WHERE created_at >= datetime('now', '-14 days')
       ORDER BY created_at DESC
       LIMIT 200`,
    )
    .all() as { title_original: string | null; title_uz: string | null }[];

  for (const row of rows) {
    for (const other of [row.title_original, row.title_uz]) {
      if (!other) continue;
      if (other.trim().toLowerCase().replace(/\s+/g, " ") === normalized) {
        return true;
      }
      if (jaccardSimilarity(tokens, titleTokens(other)) >= SIMILARITY_THRESHOLD) {
        return true;
      }
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
         AND is_primary = 1
         AND title_uz IS NOT NULL
         AND summary_uz IS NOT NULL
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(category, limit, offset) as NewsRow[];
}

// ---------------------------------------------------------------------------
// Jadval (schedule)
// ---------------------------------------------------------------------------

export type TargetScheduleSettings = {
  group: ScheduleSettings;
  channel: ScheduleSettings;
};

export function parseTimeList(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => /^\d{1,2}:\d{2}$/.test(part))
    .map((part) => {
      const [h, m] = part.split(":");
      return `${String(Number(h)).padStart(2, "0")}:${m}`;
    })
    .filter((part) => {
      const [h, m] = part.split(":").map(Number);
      return h! >= 0 && h! <= 23 && m! >= 0 && m! <= 59;
    })
    .filter((part, i, all) => all.indexOf(part) === i)
    .sort();
}

function readSchedule(prefix: "group" | "channel"): ScheduleSettings {
  const defaults = SCHEDULE_DEFAULTS[prefix];
  const times = parseTimeList(getSetting(`schedule_${prefix}_times`) || "");
  const limit = Number(getSetting(`schedule_${prefix}_limit`));

  return {
    times: times.length > 0 ? times : defaults.times,
    enabled: (getSetting(`schedule_${prefix}_enabled`) || "1") === "1",
    limit: Number.isInteger(limit) && limit > 0 ? limit : defaults.limit,
  };
}

export function getTargetScheduleSettings(): TargetScheduleSettings {
  return { group: readSchedule("group"), channel: readSchedule("channel") };
}

export function saveTargetSchedule(
  target: "group" | "channel",
  input: { times: string[]; enabled: boolean; limit?: number },
): ScheduleSettings {
  const times = parseTimeList(input.times.join(","));
  if (times.length === 0) {
    throw new Error("Kamida bitta vaqt HH:MM formatida bo‘lishi kerak");
  }

  setSetting(`schedule_${target}_times`, times.join(","));
  setSetting(`schedule_${target}_enabled`, input.enabled ? "1" : "0");
  if (input.limit !== undefined) {
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
    setSetting(`schedule_${target}_limit`, String(limit));
  }

  return readSchedule(target);
}

// ---------------------------------------------------------------------------
// Ro‘yxat / statistika
// ---------------------------------------------------------------------------

export const POSTED_FILTERS = [
  "all",
  "group_yes",
  "group_no",
  "channel_yes",
  "channel_no",
] as const;

export type PostedFilter = (typeof POSTED_FILTERS)[number];

export type ListNewsFilters = {
  category?: Category | "all";
  posted?: PostedFilter;
  q?: string;
  page?: number;
  limit?: number;
};

const POSTED_CLAUSES: Record<Exclude<PostedFilter, "all">, string> = {
  group_yes: "is_posted = 1",
  group_no: "is_posted = 0",
  channel_yes: "is_posted_channel = 1",
  channel_no: "is_posted_channel = 0",
};

export function listNews(filters: ListNewsFilters = {}): {
  items: (NewsRow & { cluster_size: number })[];
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

  if (filters.posted && filters.posted !== "all") {
    where.push(POSTED_CLAUSES[filters.posted]);
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
      `SELECT n.*,
              (SELECT COUNT(*) FROM news m WHERE m.cluster_id = n.cluster_id)
                AS cluster_size
       FROM news n ${whereSql.replace(/\b(category|is_posted|is_posted_channel|title_uz|title_original|summary_uz)\b/g, "n.$1")}
       ORDER BY datetime(n.created_at) DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as (NewsRow & { cluster_size: number })[];

  return { items, total, page, limit };
}

export function getNewsStats(): {
  total: number;
  pendingGroup: number;
  postedGroup: number;
  pendingChannel: number;
  postedChannel: number;
  byCategory: { category: string; count: number }[];
} {
  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;

  return {
    total: one("SELECT COUNT(*) AS c FROM news"),
    pendingGroup: one("SELECT COUNT(*) AS c FROM news WHERE is_posted = 0"),
    postedGroup: one("SELECT COUNT(*) AS c FROM news WHERE is_posted = 1"),
    pendingChannel: one(
      "SELECT COUNT(*) AS c FROM news WHERE is_posted_channel = 0",
    ),
    postedChannel: one(
      "SELECT COUNT(*) AS c FROM news WHERE is_posted_channel = 1",
    ),
    byCategory: db
      .prepare(
        `SELECT COALESCE(category, 'Unknown') AS category, COUNT(*) AS count
         FROM news GROUP BY category ORDER BY count DESC`,
      )
      .all() as { category: string; count: number }[],
  };
}

/**
 * O‘chirilgan URL `deleted_urls` ga yoziladi — keyingi fetch uni qaytadan
 * olib kelmaydi va qayta post qilmaydi.
 * @returns o‘chirilgan qator (audio faylini tozalash uchun) yoki `undefined`
 */
export function deleteNews(id: string): NewsRow | undefined {
  const row = getNewsById(id);
  if (!row) return undefined;

  rememberDeletedUrl(row.source_url);
  db.prepare("DELETE FROM news WHERE id = ?").run(id);
  return row;
}
