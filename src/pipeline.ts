import { Bot } from "grammy";
import { config } from "./config.js";
import "./db.js";
import { fetchAndProcessNews } from "./fetcher.js";
import { publishPendingNews } from "./publisher.js";

/** Bir cron/CI ishida ko‘proq yangilik yig‘ish va jo‘natish */
const MAX_PER_FEED = 5;
const PUBLISH_LIMIT = 50;

export async function runPipeline(): Promise<{
  fetched: number;
  published: number;
}> {
  console.log(`[${new Date().toISOString()}] Pipeline boshlandi`);
  const bot = new Bot(config.telegramBotToken);

  try {
    const fetched = await fetchAndProcessNews({ maxPerFeed: MAX_PER_FEED });
    const published = await publishPendingNews(bot, PUBLISH_LIMIT);
    console.log(
      `[${new Date().toISOString()}] Pipeline tugadi (yangi: ${fetched}, post: ${published})`,
    );
    return { fetched, published };
  } catch (err) {
    console.error("Pipeline xatosi:", err);
    throw err;
  }
}
