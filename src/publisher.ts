import { Bot, InputFile } from "grammy";
import { mergeClusterNews, type ClusterMember } from "./ai.js";
import { config } from "./config.js";
import {
  applyMergedSummary,
  claimNewsForChannelPosting,
  claimNewsForGroupPosting,
  getClusterMembers,
  getNewsById,
  getPendingNewsForChannel,
  getPendingNewsForGroup,
  getThreadId,
  markClusterPosted,
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

export type NewsSource = { name: string; url: string };

/** Klaster a’zolaridan takrorlanmagan manbalar ro‘yxati */
export function sourcesFromRows(rows: NewsRow[]): NewsSource[] {
  const seen = new Set<string>();
  const sources: NewsSource[] = [];

  for (const row of rows) {
    const name = siteNameFromUrl(row.source_url);
    if (seen.has(name)) continue;
    seen.add(name);
    sources.push({ name, url: row.source_url });
  }

  return sources;
}

function formatSourceLine(sources: NewsSource[]): string {
  const links = sources
    .map(
      ({ name, url }) =>
        `<a href="${escapeHtml(url)}">${escapeHtml(name)}</a>`,
    )
    .join(" · ");

  return sources.length > 1 ? `🔗 Manbalar: ${links}` : `🔗 ${links}`;
}

/**
 * Telegram HTML: to‘liq URL ko‘rinmaydi, sayt nomi bosiladigan havola bo‘ladi.
 * Bir voqea bir necha manbadan kelgan bo‘lsa hammasi pastda sanaladi.
 * Xabar 4096 belgidan oshsa bulletlar qisqartiriladi — HTML teglari
 * hech qachon o‘rtasidan kesilmaydi (kesish escape’dan oldin bo‘ladi).
 */
export function formatNewsMessage(
  news: NewsRow,
  sources: NewsSource[] = [
    { name: siteNameFromUrl(news.source_url), url: news.source_url },
  ],
): string {
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

  const head = `📌 ${escapeHtml(title)}`;
  const tail = [`🏷 Kategoriya: ${escapeHtml(hashtag)}`];
  if (when) tail.push(`🕐 ${escapeHtml(when)}`);
  tail.push(formatSourceLine(sources));

  const fixedLength = head.length + tail.join("\n").length + 4; // 2 ta bo‘sh qator
  const bulletBudget = TELEGRAM_TEXT_LIMIT - fixedLength;

  const kept: string[] = [];
  let used = 0;
  for (const bullet of bullets) {
    const remaining = bulletBudget - used;
    if (remaining <= 12) break;
    const line =
      bullet.length + 1 <= remaining ? bullet : truncate(bullet, remaining - 1);
    kept.push(escapeHtml(line));
    used += line.length + 1;
  }

  return [head, "", ...kept, "", ...tail].join("\n");
}

export function formatVoiceCaption(news: NewsRow): string {
  const title = (news.title_uz || news.title_original || "").trim();
  return truncate(`🔊 ${title}`, TELEGRAM_CAPTION_LIMIT);
}

/**
 * Klasterni post uchun tayyorlaydi: bir nechta manba bo‘lsa bitta umumiy
 * xulosa yasaladi (bir marta — natija bazaga yoziladi).
 * AI chaqiruvi yiqilsa mavjud xulosa bilan davom etadi.
 */
async function prepareForPosting(
  news: NewsRow,
): Promise<{ news: NewsRow; sources: NewsSource[] }> {
  const clusterId = news.cluster_id;
  if (!clusterId) {
    return {
      news,
      sources: [{ name: siteNameFromUrl(news.source_url), url: news.source_url }],
    };
  }

  const members = getClusterMembers(clusterId);
  const sources = sourcesFromRows(members);

  if (members.length < 2 || news.merged_at) {
    return { news, sources };
  }

  const forMerge: ClusterMember[] = members
    .filter((m) => m.title_uz && m.summary_uz)
    .map((m) => ({
      source: siteNameFromUrl(m.source_url),
      title: m.title_uz!,
      content: m.summary_uz!,
    }));

  if (forMerge.length < 2) return { news, sources };

  try {
    console.log(
      `Klaster birlashtirilyapti (${members.length} manba): ${news.title_uz}`,
    );
    const merged = await mergeClusterNews(forMerge);
    applyMergedSummary(news.id, merged);
    return { news: getNewsById(news.id) ?? news, sources };
  } catch (err) {
    // Umumiy xulosa chiqmasa ham post ketaveradi — faqat manbalar sanaladi
    console.error(`Klaster birlashtirilmadi (${news.id}):`, err);
    return { news, sources };
  }
}

type SendTarget = {
  chatId: string;
  threadId?: number;
  /** Ovozli xabar faqat kanalga yuboriladi (TTS kvotasini tejash uchun) */
  withAudio: boolean;
};

async function sendNews(
  bot: Bot,
  news: NewsRow,
  sources: NewsSource[],
  target: SendTarget,
): Promise<void> {
  const threadOption =
    target.threadId === undefined ? {} : { message_thread_id: target.threadId };

  const sent = await bot.api.sendMessage(
    target.chatId,
    formatNewsMessage(news, sources),
    {
      ...threadOption,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    },
  );

  if (!target.withAudio || !ttsAvailable()) return;

  const audioPath = await generateNewsAudio(news);
  if (!audioPath) return;

  try {
    await bot.api.sendVoice(target.chatId, new InputFile(audioPath), {
      ...threadOption,
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

  for (const [index, row] of pending.entries()) {
    if (!row.category) continue;

    if (!claimNewsForGroupPosting(row.id)) {
      console.log(`Skip guruh (claim): ${row.id}`);
      continue;
    }

    try {
      const { news, sources } = await prepareForPosting(row);
      const threadId = getThreadId(news.category!);

      await sendNews(bot, news, sources, {
        chatId: config.telegramGroupId,
        // Topic biriktirilmagan kategoriya guruhning General topic’iga tushadi
        ...(threadId === null ? {} : { threadId }),
        withAudio: false,
      });

      if (news.cluster_id) markClusterPosted(news.cluster_id, "group");
      published += 1;
      console.log(`Guruh [${news.category}]: ${news.title_uz}`);
    } catch (err) {
      unclaimGroupNews(row.id);
      console.error(`Guruh post xatosi (${row.id}):`, err);
    }

    if (index < pending.length - 1) await sleep(POST_DELAY_MS);
  }

  console.log(`Guruh: ${published}/${pending.length}`);
  return published;
}

export async function publishPendingToChannel(
  bot: Bot,
  limit = 5,
): Promise<number> {
  if (!config.telegramChannelId) {
    throw new Error("TELEGRAM_CHANNEL_ID .env da belgilanmagan");
  }

  const pending = getPendingNewsForChannel(limit);
  let published = 0;

  for (const [index, row] of pending.entries()) {
    if (!row.category) continue;

    if (!claimNewsForChannelPosting(row.id)) {
      console.log(`Skip kanal (claim): ${row.id}`);
      continue;
    }

    try {
      const { news, sources } = await prepareForPosting(row);

      await sendNews(bot, news, sources, {
        chatId: config.telegramChannelId,
        withAudio: true,
      });

      if (news.cluster_id) markClusterPosted(news.cluster_id, "channel");
      published += 1;
      console.log(`Kanal [${news.category}]: ${news.title_uz}`);
    } catch (err) {
      unclaimChannelNews(row.id);
      console.error(`Kanal post xatosi (${row.id}):`, err);
    }

    if (index < pending.length - 1) await sleep(POST_DELAY_MS);
  }

  console.log(`Kanal: ${published}/${pending.length}`);
  return published;
}
