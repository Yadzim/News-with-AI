import Parser from "rss-parser";
import { processNews } from "./ai.js";
import {
  insertNews,
  isUrlBlocked,
  listActiveSources,
  recordSourceResult,
  similarTitleExists,
  type SourceRow,
} from "./db.js";
import { sanitizeSourceUrl } from "./url.js";

const parser = new Parser();

const FEED_HEADERS = {
  Accept: "application/rss+xml, application/xml, text/xml, */*",
  "User-Agent":
    "Mozilla/5.0 (compatible; AI-News-Bot/1.0; +https://github.com/news-bot)",
};

/** HTML sahifa kelib qolsa aniq xato beradi */
async function parseFeed(feedUrl: string) {
  const res = await fetch(feedUrl, {
    headers: FEED_HEADERS,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  const trimmed = xml.trimStart().toLowerCase();
  if (
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    (!trimmed.includes("<rss") && !trimmed.includes("<feed"))
  ) {
    throw new Error(
      `RSS emas (HTML/noto‘g‘ri URL). To‘g‘ri feed URL kerak: ${feedUrl}`,
    );
  }

  return parser.parseString(xml);
}

type FeedItem = {
  title?: string;
  link?: string;
  guid?: string;
  contentSnippet?: string;
  content?: string;
  summary?: string;
  isoDate?: string;
  pubDate?: string;
};

function resolveSourceUrl(item: FeedItem): string | null {
  const url = (item.link || item.guid || "").trim();
  if (!url) return null;
  return sanitizeSourceUrl(url);
}

function itemContent(item: FeedItem): string {
  return (item.contentSnippet || item.summary || item.content || item.title || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function processFeed(
  source: SourceRow,
  maxPerFeed: number,
  signal?: AbortSignal,
): Promise<number> {
  let added = 0;
  let itemErrors = 0;

  try {
    const feed = await parseFeed(source.url);
    const items = (feed.items as FeedItem[]).slice(0, maxPerFeed);

    for (const item of items) {
      if (signal?.aborted) break;

      const sourceUrl = resolveSourceUrl(item);
      const title = (item.title || "").trim();

      if (!sourceUrl || !title) continue;
      if (isUrlBlocked(sourceUrl)) continue;
      if (similarTitleExists(title)) {
        console.log(`[${source.name}] skip (o‘xshash sarlavha): ${title}`);
        continue;
      }

      const content = itemContent(item);
      if (!content) continue;

      try {
        const processed = await processNews({ title, content, url: sourceUrl });

        insertNews({
          source_url: sourceUrl,
          title_original: title,
          title_uz: processed.title_uz,
          summary_uz: processed.summary_uz,
          category: processed.category,
          published_at: item.isoDate || item.pubDate || null,
        });

        added += 1;
        console.log(`[${source.name}] qo‘shildi: ${processed.title_uz}`);
      } catch (err) {
        itemErrors += 1;
        console.error(`[${source.name}] AI/DB xato (${sourceUrl}):`, err);
      }
    }

    // Feed o‘qildi, lekin hech narsa qo‘shilmadi va xatolar bo‘ldi —
    // buni adminda ko‘rsatish kerak (odatda Gemini kvotasi/kaliti).
    recordSourceResult(source.id, {
      added,
      ...(added === 0 && itemErrors > 0
        ? { error: `Feed o‘qildi, lekin ${itemErrors} ta yangilikni AI qayta ishlay olmadi` }
        : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordSourceResult(source.id, { added, error: message });
    console.error(`[${source.name}] feed o‘qish xatosi:`, err);
  }

  return added;
}

export type FetchProgress = {
  totalSources: number;
  doneSources: number;
  currentSource: string | null;
  added: number;
};

export type FetchOptions = {
  maxPerFeed?: number;
  onProgress?: (progress: FetchProgress) => void;
  signal?: AbortSignal;
};

/**
 * Aktiv RSS manbalaridan yangiliklarni yig‘adi, dedupe qiladi va Gemini
 * orqali qayta ishlaydi. Manbalar ketma-ket ishlanadi (free tier RPM limiti).
 * @returns Yangi qo‘shilgan yangiliklar soni
 */
export async function fetchAndProcessNews(
  options: FetchOptions = {},
): Promise<number> {
  const maxPerFeed = options.maxPerFeed ?? 2;
  const sources = listActiveSources();

  if (sources.length === 0) {
    console.warn("Aktiv RSS manbasi yo‘q — admin panelda qo‘shing");
    return 0;
  }

  console.log(
    `RSS yig‘ish boshlandi (${sources.length} manba, har biridan max ${maxPerFeed})...`,
  );

  let total = 0;
  let done = 0;

  const report = (currentSource: string | null) =>
    options.onProgress?.({
      totalSources: sources.length,
      doneSources: done,
      currentSource,
      added: total,
    });

  report(sources[0]?.name ?? null);

  for (const source of sources) {
    if (options.signal?.aborted) {
      console.log("Fetch bekor qilindi");
      break;
    }
    report(source.name);
    total += await processFeed(source, maxPerFeed, options.signal);
    done += 1;
    report(source.name);
  }

  console.log(`Jami yangi yangiliklar: ${total}`);
  return total;
}
