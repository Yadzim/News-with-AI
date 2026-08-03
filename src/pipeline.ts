import "./db.js";
import { startFetch } from "./fetch-job.js";
import {
  publishPendingToChannel,
  publishPendingToGroup,
} from "./publisher.js";
import { publisherBot } from "./telegram.js";

const MAX_PER_FEED = 5;
const PUBLISH_LIMIT = 50;

/**
 * Fetch qulf ostida ishlaydi: admin paneldagi tugma bilan cron bir vaqtda
 * tushib qolsa, ikkinchisi mavjud jarayonni kutadi (qayta yugurtirmaydi).
 */
export async function runFetchOnly(maxPerFeed = MAX_PER_FEED): Promise<number> {
  console.log(`[${new Date().toISOString()}] Fetch boshlandi`);
  const { started, promise } = startFetch(maxPerFeed);
  if (!started) {
    console.log("Fetch allaqachon ishlayapti — mavjud jarayon kutilmoqda");
  }
  const added = await promise;
  console.log(`Fetch tugadi: yangi ${added}`);
  return added;
}

export async function runPublishGroup(): Promise<number> {
  console.log(`[${new Date().toISOString()}] Guruhga yuborish`);
  const published = await publishPendingToGroup(publisherBot, PUBLISH_LIMIT);
  console.log(`Guruhga yuborildi: ${published}`);
  return published;
}

export async function runPublishChannel(): Promise<number> {
  console.log(`[${new Date().toISOString()}] Kanalga yuborish`);
  const published = await publishPendingToChannel(publisherBot, PUBLISH_LIMIT);
  console.log(`Kanalga yuborildi: ${published}`);
  return published;
}

/** Guruh jadvali: fetch + guruhga post */
export async function runGroupPipeline(): Promise<{
  fetched: number;
  published: number;
}> {
  const fetched = await runFetchOnly();
  const published = await runPublishGroup();
  return { fetched, published };
}
