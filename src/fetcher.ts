import Parser from "rss-parser";
import { processNews } from "./ai.js";
import { insertNews, newsExists } from "./db.js";

const parser = new Parser({
  timeout: 15_000,
  headers: {
    Accept: "application/rss+xml, application/xml, text/xml, */*",
    "User-Agent":
      "Mozilla/5.0 (compatible; AI-News-Bot/1.0; +https://github.com/news-bot)",
  },
});

/** HTML sahifa kelib qolsa aniq xato beradi */
async function parseFeed(feedUrl: string) {
  const res = await fetch(feedUrl, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml, */*",
      "User-Agent":
        "Mozilla/5.0 (compatible; AI-News-Bot/1.0; +https://github.com/news-bot)",
    },
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

export const RSS_FEEDS = [
  {
    name: "TechCrunch",
    url: "https://techcrunch.com/feed/",
  },
  {
    name: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
  },
  {
    name: "Wired",
    url: "https://www.wired.com/feed/rss",
  },
  {
    name: "Hacker News",
    url: "https://hnrss.org/frontpage",
  },
  {
    name: "MIT Technology Review",
    url: "https://www.technologyreview.com/feed/",
  },
  {
    name: "The Next Web",
    url: "https://thenextweb.com/feed",
  },
] as const;

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
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

function itemContent(item: FeedItem): string {
  return (
    item.contentSnippet ||
    item.summary ||
    item.content ||
    item.title ||
    ""
  )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function processFeed(
  feedName: string,
  feedUrl: string,
  maxPerFeed: number,
): Promise<number> {
  let added = 0;

  try {
    const feed = await parseFeed(feedUrl);
    const items = (feed.items as FeedItem[]).slice(0, maxPerFeed);

    for (const item of items) {
      const sourceUrl = resolveSourceUrl(item);
      const title = (item.title || "").trim();

      if (!sourceUrl || !title) continue;
      if (newsExists(sourceUrl)) continue;

      const content = itemContent(item);
      if (!content) continue;

      try {
        const processed = await processNews({
          title,
          content,
          url: sourceUrl,
        });

        insertNews({
          source_url: sourceUrl,
          title_original: title,
          title_uz: processed.title_uz,
          summary_uz: processed.summary_uz,
          category: processed.category,
          published_at: item.isoDate || item.pubDate || null,
        });

        added += 1;
        console.log(`[${feedName}] qo‘shildi: ${processed.title_uz}`);
      } catch (err) {
        console.error(`[${feedName}] AI/DB xato (${sourceUrl}):`, err);
      }
    }
  } catch (err) {
    console.error(`[${feedName}] feed o‘qish xatosi:`, err);
  }

  return added;
}

/**
 * Barcha RSS manbalaridan yangiliklarni yig‘adi, dedupe qiladi va Gemini orqali qayta ishlaydi.
 * Feedlar ketma-ket ishlanadi (free tier RPM limitini saqlash uchun).
 * @returns Yangi qo‘shilgan yangiliklar soni
 */
export async function fetchAndProcessNews(
  options: { maxPerFeed?: number } = {},
): Promise<number> {
  const maxPerFeed = options.maxPerFeed ?? 2;
  console.log(`RSS yig‘ish boshlandi (har feeddan max ${maxPerFeed})...`);

  let total = 0;
  for (const feed of RSS_FEEDS) {
    total += await processFeed(feed.name, feed.url, maxPerFeed);
  }

  console.log(`Jami yangi yangiliklar: ${total}`);
  return total;
}
