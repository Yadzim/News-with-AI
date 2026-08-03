import { Bot, InputFile } from "grammy";
import { config } from "./config.js";
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
import { generateNewsAudio, ttsAvailable } from "./tts.js";
import { escapeHtml, siteNameFromUrl } from "./url.js";

const POST_DELAY_MS = 800;

/** Telegram matn limiti */
export const TELEGRAM_TEXT_LIMIT = 4096;
const TELEGRAM_CAPTION_LIMIT = 1024;
const MAX_TITLE_CHARS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** published_at yoki created_at ni Asia/Tashkent formatida */
export function formatPublishedAt(news: NewsRow): string | null {
  const raw = news.published_at || news.created_at;
  if (!raw) return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("uz-UZ", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Telegram HTML: to‘liq URL ko‘rinmaydi, sayt nomi + havola bosiladi.
 * Xabar 4096 belgidan oshsa bulletlar qisqartiriladi — HTML teglari
 * hech qachon o‘rtasidan kesilmaydi (kesish escape’dan oldin bo‘ladi).
 */
export function formatNewsMessage(news: NewsRow): string {
  const title = truncate(
    (news.title_uz || news.title_original || "").trim(),
    MAX_TITLE_CHARS,
  );

  const bullets = (news.summary_uz || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith("🔹") ? line : `🔹 ${line}`));

  const category = news.category || "General Tech";
  const hashtag = `#${category.replace(/\s+/g, "")}`;
  const when = formatPublishedAt(news);
  const site = escapeHtml(siteNameFromUrl(news.source_url));
  const href = escapeHtml(news.source_url);

  const head = `📌 ${escapeHtml(title)}`;
  const tail = [`🏷 Kategoriya: ${escapeHtml(hashtag)}`];
  if (when) tail.push(`🕐 ${escapeHtml(when)}`);
  tail.push(`🔗 ${site} · <a href="${href}">havola</a>`);

  const fixedLength = head.length + tail.join("\n").length + 4; // 2 ta bo‘sh qator
  const bulletBudget = TELEGRAM_TEXT_LIMIT - fixedLength;

  const kept: string[] = [];
  let used = 0;
  for (const bullet of bullets) {
    const remaining = bulletBudget - used;
    if (remaining <= 12) break;
    const line = bullet.length + 1 <= remaining ? bullet : truncate(bullet, remaining - 1);
    kept.push(escapeHtml(line));
    used += line.length + 1;
  }

  return [head, "", ...kept, "", ...tail].join("\n");
}

export function formatVoiceCaption(news: NewsRow): string {
  const title = (news.title_uz || news.title_original || "").trim();
  return truncate(`🔊 ${title}`, TELEGRAM_CAPTION_LIMIT);
}

type SendTarget = {
  chatId: string;
  threadId?: number;
};

/** Matnni, iloji bo‘lsa ovozli xabarni ham yuboradi */
async function sendNews(
  bot: Bot,
  news: NewsRow,
  target: SendTarget,
): Promise<void> {
  const sent = await bot.api.sendMessage(target.chatId, formatNewsMessage(news), {
    ...(target.threadId === undefined ? {} : { message_thread_id: target.threadId }),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });

  if (!ttsAvailable()) return;

  const audioPath = await generateNewsAudio(news);
  if (!audioPath) return;

  try {
    await bot.api.sendVoice(target.chatId, new InputFile(audioPath), {
      ...(target.threadId === undefined ? {} : { message_thread_id: target.threadId }),
      caption: formatVoiceCaption(news),
      reply_parameters: { message_id: sent.message_id },
    });
  } catch (err) {
    // Audio ixtiyoriy — matn allaqachon yuborilgan, xatolik postni buzmasin
    console.error(`Audio yuborilmadi (${news.id}):`, err);
  }
}

export async function publishPendingToGroup(
  bot: Bot,
  limit = 50,
): Promise<number> {
  const pending = getPendingNewsForGroup(limit);
  let published = 0;

  for (const [index, news] of pending.entries()) {
    if (!news.category) continue;

    if (!claimNewsForGroupPosting(news.id)) {
      console.log(`Skip guruh (claim): ${news.id}`);
      continue;
    }

    try {
      const threadId = getThreadId(news.category);
      await sendNews(bot, news, {
        chatId: config.telegramGroupId,
        // Topic biriktirilmagan kategoriya guruhning General topic’iga tushadi
        ...(threadId === null ? {} : { threadId }),
      });

      published += 1;
      console.log(`Guruh [${news.category}]: ${news.title_uz}`);
    } catch (err) {
      unclaimGroupNews(news.id);
      console.error(`Guruh post xatosi (${news.id}):`, err);
    }

    if (index < pending.length - 1) await sleep(POST_DELAY_MS);
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

  for (const [index, news] of pending.entries()) {
    if (!news.category) continue;

    if (!claimNewsForChannelPosting(news.id)) {
      console.log(`Skip kanal (claim): ${news.id}`);
      continue;
    }

    try {
      await sendNews(bot, news, { chatId: config.telegramChannelId });
      published += 1;
      console.log(`Kanal [${news.category}]: ${news.title_uz}`);
    } catch (err) {
      unclaimChannelNews(news.id);
      console.error(`Kanal post xatosi (${news.id}):`, err);
    }

    if (index < pending.length - 1) await sleep(POST_DELAY_MS);
  }

  console.log(`Kanal: ${published}/${pending.length}`);
  return published;
}
