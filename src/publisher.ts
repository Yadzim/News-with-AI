import { Bot } from "grammy";
import { config, type Category } from "./config.js";
import {
  claimNewsForChannelPosting,
  claimNewsForGroupPosting,
  getPendingNewsForChannel,
  getPendingNewsForGroup,
  getThreadId,
  unclaimChannelNews,
  unclaimGroupNews,
  type NewsRow,
} from "./db.js";
import { escapeHtml, siteNameFromUrl } from "./url.js";

const POST_DELAY_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** published_at yoki created_at ni Asia/Tashkent formatida */
export function formatPublishedAt(news: NewsRow): string | null {
  const raw = news.published_at || news.created_at;
  if (!raw) return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  const formatted = new Intl.DateTimeFormat("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  return formatted;
}

/** Telegram HTML: to‘liq URL ko‘rinmaydi, sayt nomi + havola bosiladi */
export function formatNewsMessage(news: NewsRow): string {
  const bullets = (news.summary_uz || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const text = line.startsWith("🔹") ? line : `🔹 ${line}`;
      return escapeHtml(text);
    });

  const category = (news.category || "General Tech") as Category;
  const hashtag = `#${category.replace(/\s+/g, "")}`;
  const when = formatPublishedAt(news);
  const site = escapeHtml(siteNameFromUrl(news.source_url));
  const href = escapeHtml(news.source_url);

  const lines = [
    `📌 ${escapeHtml(news.title_uz || news.title_original || "")}`,
    "",
    ...bullets,
    "",
    `🏷 Kategoriya: ${escapeHtml(hashtag)}`,
  ];

  if (when) {
    lines.push(`🕐 ${escapeHtml(when)}`);
  }

  lines.push(`🔗 ${site} · <a href="${href}">havola</a>`);
  return lines.join("\n");
}

export async function publishPendingToGroup(
  bot: Bot,
  limit = 50,
): Promise<number> {
  const pending = getPendingNewsForGroup(limit);
  let published = 0;

  for (const news of pending) {
    if (!news.category) continue;

    if (!claimNewsForGroupPosting(news.id)) {
      console.log(`Skip guruh (claim): ${news.id}`);
      continue;
    }

    try {
      const threadId = getThreadId(news.category as Category);
      const text = formatNewsMessage(news);

      await bot.api.sendMessage(config.telegramGroupId, text, {
        message_thread_id: threadId,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });

      published += 1;
      console.log(`Guruh [${news.category}]: ${news.title_uz}`);

      if (published < pending.length) {
        await sleep(POST_DELAY_MS);
      }
    } catch (err) {
      unclaimGroupNews(news.id);
      console.error(`Guruh post xatosi (${news.id}):`, err);
    }
  }

  console.log(`Guruh: ${published}/${pending.length}`);
  return published;
}

export async function publishPendingToChannel(
  bot: Bot,
  limit = 50,
): Promise<number> {
  if (!config.telegramChannelId) {
    throw new Error("TELEGRAM_CHANNEL_ID .env da belgilanmagan");
  }

  const pending = getPendingNewsForChannel(limit);
  let published = 0;

  for (const news of pending) {
    if (!news.category) continue;

    if (!claimNewsForChannelPosting(news.id)) {
      console.log(`Skip kanal (claim): ${news.id}`);
      continue;
    }

    try {
      const text = formatNewsMessage(news);

      await bot.api.sendMessage(config.telegramChannelId, text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });

      published += 1;
      console.log(`Kanal [${news.category}]: ${news.title_uz}`);

      if (published < pending.length) {
        await sleep(POST_DELAY_MS);
      }
    } catch (err) {
      unclaimChannelNews(news.id);
      console.error(`Kanal post xatosi (${news.id}):`, err);
    }
  }

  console.log(`Kanal: ${published}/${pending.length}`);
  return published;
}

/** @deprecated publishPendingToGroup */
export async function publishPendingNews(
  bot: Bot,
  limit = 50,
): Promise<number> {
  return publishPendingToGroup(bot, limit);
}
