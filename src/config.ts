import "dotenv/config";
import { z } from "zod";

/** Bo‘sh satrni "berilmagan" deb hisoblaydigan ixtiyoriy butun son */
const optionalInt = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return undefined;
    const num = Number(trimmed);
    return Number.isInteger(num) ? num : undefined;
  });

const envSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY majburiy"),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN majburiy"),
  TELEGRAM_GROUP_ID: z.string().min(1, "TELEGRAM_GROUP_ID majburiy"),
  TELEGRAM_CHANNEL_ID: z.string().optional().default(""),
  // TOPIC_* faqat birinchi ishga tushirishda kategoriyalarni seed qilish uchun.
  // Keyinchalik kategoriyalar admin panelidan boshqariladi (DB: `categories`).
  TOPIC_AI: optionalInt,
  TOPIC_HARDWARE: optionalInt,
  TOPIC_CYBERSECURITY: optionalInt,
  TOPIC_STARTUPS: optionalInt,
  TOPIC_GENERAL_TECH: optionalInt,
  DATABASE_PATH: z.string().default("./data/news.db"),
  PORT: z.coerce.number().int().default(8787),
  ADMIN_TOKEN: z.string().optional().default(""),
  ADMIN_USER_IDS: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-3.1-flash-lite"),
  GEMINI_TTS_MODEL: z.string().default("gemini-2.5-flash-preview-tts"),
  TTS_VOICE: z.string().default("Kore"),
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

function parseUserIds(raw: string): number[] {
  return raw
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Birinchi ishga tushirishda `categories` jadvalini to‘ldirish uchun.
 * `threadId` berilmagan kategoriya guruh topic’iga emas, faqat kanal/botga chiqadi.
 */
export const SEED_CATEGORIES: { name: string; threadId?: number }[] = [
  { name: "AI", threadId: parsed.data.TOPIC_AI },
  { name: "Hardware", threadId: parsed.data.TOPIC_HARDWARE },
  { name: "Cybersecurity", threadId: parsed.data.TOPIC_CYBERSECURITY },
  { name: "Startups", threadId: parsed.data.TOPIC_STARTUPS },
  { name: "General Tech", threadId: parsed.data.TOPIC_GENERAL_TECH },
];

/** AI noma’lum kategoriya qaytarsa shu ishlatiladi (yo‘q bo‘lsa — birinchi aktiv) */
export const FALLBACK_CATEGORY = "General Tech";

export const config = {
  geminiApiKey: parsed.data.GEMINI_API_KEY,
  geminiModel: parsed.data.GEMINI_MODEL,
  geminiTtsModel: parsed.data.GEMINI_TTS_MODEL,
  ttsVoice: parsed.data.TTS_VOICE,
  telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN,
  telegramGroupId: normalizeTelegramChatId(parsed.data.TELEGRAM_GROUP_ID),
  telegramChannelId: parsed.data.TELEGRAM_CHANNEL_ID.trim()
    ? normalizeTelegramChatId(parsed.data.TELEGRAM_CHANNEL_ID.trim())
    : "",
  databasePath: parsed.data.DATABASE_PATH,
  port: parsed.data.PORT,
  adminToken: parsed.data.ADMIN_TOKEN.trim(),
  adminUserIds: parseUserIds(parsed.data.ADMIN_USER_IDS),
  webappUrl: parsed.data.WEBAPP_URL,
};

/** Kategoriya nomi endi qat’iy emas — ro‘yxat DB dan keladi */
export type Category = string;
