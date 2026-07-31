import { Bot } from "grammy";
import { config } from "./config.js";
import "./db.js";
import { fetchAndProcessNews } from "./fetcher.js";
import {
  publishPendingToChannel,
  publishPendingToGroup,
} from "./publisher.js";

const MAX_PER_FEED = 5;
const PUBLISH_LIMIT = 50;

export async function runFetchOnly(): Promise<number> {
  console.log(`[${new Date().toISOString()}] Fetch boshlandi`);
  const added = await fetchAndProcessNews({ maxPerFeed: MAX_PER_FEED });
  console.log(`Fetch tugadi: yangi ${added}`);
  return added;
}

export async function runPublishGroup(): Promise<number> {
  console.log(`[${new Date().toISOString()}] Guruhga yuborish`);
  const bot = new Bot(config.telegramBotToken);
  const published = await publishPendingToGroup(bot, PUBLISH_LIMIT);
  console.log(`Guruhga yuborildi: ${published}`);
  return published;
}

export async function runPublishChannel(): Promise<number> {
  console.log(`[${new Date().toISOString()}] Kanalga yuborish`);
  const bot = new Bot(config.telegramBotToken);
  const published = await publishPendingToChannel(bot, PUBLISH_LIMIT);
  console.log(`Kanalga yuborildi: ${published}`);
  return published;
}

/** Guruh schedule: fetch + guruhga post */
export async function runGroupPipeline(): Promise<{
  fetched: number;
  published: number;
}> {
  const fetched = await runFetchOnly();
  const published = await runPublishGroup();
  return { fetched, published };
}

/** @deprecated runGroupPipeline */
export async function runPipeline(): Promise<{
  fetched: number;
  published: number;
}> {
  return runGroupPipeline();
}
