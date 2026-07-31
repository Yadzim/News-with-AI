import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY majburiy"),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN majburiy"),
  TELEGRAM_GROUP_ID: z.string().min(1, "TELEGRAM_GROUP_ID majburiy"),
  TELEGRAM_CHANNEL_ID: z.string().optional().default(""),
  TOPIC_AI: z.coerce.number().int(),
  TOPIC_HARDWARE: z.coerce.number().int(),
  TOPIC_CYBERSECURITY: z.coerce.number().int(),
  TOPIC_STARTUPS: z.coerce.number().int(),
  TOPIC_GENERAL_TECH: z.coerce.number().int(),
  DATABASE_PATH: z.string().default("./data/news.db"),
  PORT: z.coerce.number().int().default(8787),
  ADMIN_TOKEN: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-3.1-flash-lite"),
  WEBAPP_URL: z.union([z.string().url(), z.literal("")]).default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Environment validatsiya xatosi:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

/** Superguruh ID odatda -100...; minus tushib qolsa tuzatiladi */
function normalizeTelegramChatId(raw: string): string {
  const id = raw.trim();
  if (/^-?\d+$/.test(id) && id.startsWith("100") && !id.startsWith("-")) {
    return `-${id}`;
  }
  return id;
}

export const config = {
  geminiApiKey: parsed.data.GEMINI_API_KEY,
  geminiModel: parsed.data.GEMINI_MODEL,
  telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN,
  telegramGroupId: normalizeTelegramChatId(parsed.data.TELEGRAM_GROUP_ID),
  telegramChannelId: parsed.data.TELEGRAM_CHANNEL_ID.trim()
    ? normalizeTelegramChatId(parsed.data.TELEGRAM_CHANNEL_ID.trim())
    : "",
  databasePath: parsed.data.DATABASE_PATH,
  port: parsed.data.PORT,
  adminToken: parsed.data.ADMIN_TOKEN,
  webappUrl: parsed.data.WEBAPP_URL,
  topics: {
    AI: parsed.data.TOPIC_AI,
    Hardware: parsed.data.TOPIC_HARDWARE,
    Cybersecurity: parsed.data.TOPIC_CYBERSECURITY,
    Startups: parsed.data.TOPIC_STARTUPS,
    "General Tech": parsed.data.TOPIC_GENERAL_TECH,
  } as const,
};

export type Category = keyof typeof config.topics;

export const CATEGORIES = [
  "AI",
  "Hardware",
  "Cybersecurity",
  "Startups",
  "General Tech",
] as const satisfies readonly Category[];
