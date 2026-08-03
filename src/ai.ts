import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { config, type Category } from "./config.js";
import { listActiveCategoryNames, resolveCategoryName } from "./db.js";

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

const model = genAI.getGenerativeModel({
  model: config.geminiModel,
  generationConfig: {
    responseMimeType: "application/json",
    temperature: 0.4,
  },
});

/** Free tier ~15 RPM → kamida ~4.5s oralig‘ida so‘rov */
const MIN_REQUEST_INTERVAL_MS = 4_500;
const MAX_ATTEMPTS = 5;

let lastRequestAt = 0;

const aiResponseSchema = z.object({
  title_uz: z.string().min(1),
  bullets: z.array(z.string().min(1)).min(3).max(4),
  category: z.string().min(1),
});

export type ProcessedNews = {
  title_uz: string;
  summary_uz: string;
  category: Category;
};

export type ProcessNewsInput = {
  title: string;
  content: string;
  url: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (lastRequestAt > 0 && elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastRequestAt = Date.now();
}

export function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; message?: string };
  return (
    e.status === 429 ||
    Boolean(e.message?.includes("429")) ||
    Boolean(e.message?.includes("Too Many Requests")) ||
    Boolean(e.message?.includes("quota"))
  );
}

export function retryDelayMs(err: unknown, attempt: number): number {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);

  const match = msg.match(/retry in ([\d.]+)\s*m?s/i);
  if (match) {
    const secondsOrMs = Number(match[1]);
    // "541.608053ms" yoki "5.2s"
    const ms = /ms/i.test(msg.slice(msg.toLowerCase().indexOf("retry")))
      ? secondsOrMs
      : secondsOrMs * 1000;
    return Math.max(ms, 1_000) + 500;
  }

  // Exponential backoff: 5s, 15s, 30s, 60s...
  return Math.min(5_000 * 3 ** (attempt - 1), 60_000);
}

function buildPrompt(
  { title, content, url }: ProcessNewsInput,
  categories: string[],
): string {
  return `Siz texnologiya yangiliklari muharririsiz. Quyidagi yangilikni o'zbek tiliga tarjima qiling va soddalashtiring.

Talablar:
1. Sarlavhani o'zbek tiliga aniq va qiziqarli qilib tarjima qiling.
2. Murakkab texnik terminlarni oddiy, tushunarli tilda izohlab bering.
3. Yangilikni 3 yoki 4 ta asosiy bullet pointda xulosalash (har biri 1–2 jumla).
4. Kategoriyani faqat shu ro'yxatdan tanlang (aynan shu yozuv bilan): ${categories.join(", ")}.
   Hech biriga to'liq mos kelmasa, eng yaqinini tanlang.

Faqat JSON qaytaring (boshqa matn yo'q):
{
  "title_uz": "...",
  "bullets": ["...", "...", "..."],
  "category": "${categories[0]}"
}

Manba URL: ${url}
Asl sarlavha: ${title}
Matn / qisqa mazmun:
${content.slice(0, 4000)}`;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini javobida JSON topilmadi");
    return JSON.parse(match[0]);
  }
}

function readString(raw: unknown, key: string): string | undefined {
  if (typeof raw !== "object" || raw === null || !(key in raw)) return undefined;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export function parseAiPayload(
  raw: unknown,
  fallbackTitle: string,
  resolveCategory: (name: string) => string | null = resolveCategoryName,
): ProcessedNews {
  const parsed = aiResponseSchema.safeParse(raw);

  const rawCategory = parsed.success
    ? parsed.data.category
    : (readString(raw, "category") ?? "");
  const category = resolveCategory(rawCategory);
  if (!category) {
    throw new Error(
      "Aktiv kategoriya yo‘q — admin panelda kamida bittasini qo‘shing",
    );
  }

  if (parsed.success) {
    return {
      title_uz: parsed.data.title_uz.trim(),
      summary_uz: parsed.data.bullets.map((b) => b.trim()).join("\n"),
      category,
    };
  }

  const bullets =
    typeof raw === "object" &&
    raw !== null &&
    Array.isArray((raw as { bullets?: unknown }).bullets)
      ? ((raw as { bullets: unknown[] }).bullets.filter(
          (b): b is string => typeof b === "string" && Boolean(b.trim()),
        ))
      : [];

  if (bullets.length < 3) {
    throw new Error("Bullet pointlar yetarli emas");
  }

  const title_uz = readString(raw, "title_uz") ?? fallbackTitle;

  return {
    title_uz: title_uz.trim() || fallbackTitle,
    summary_uz: bullets.slice(0, 4).map((b) => b.trim()).join("\n"),
    category,
  };
}

export async function processNews(
  input: ProcessNewsInput,
): Promise<ProcessedNews> {
  const categories = listActiveCategoryNames();
  if (categories.length === 0) {
    throw new Error(
      "Aktiv kategoriya yo‘q — admin panelda kamida bittasini qo‘shing",
    );
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await waitForRateLimit();
      const result = await model.generateContent(buildPrompt(input, categories));
      const raw = extractJson(result.response.text());
      return parseAiPayload(raw, input.title);
    } catch (err) {
      lastError = err;

      if (isRateLimitError(err) && attempt < MAX_ATTEMPTS) {
        const delay = retryDelayMs(err, attempt);
        console.warn(
          `Gemini 429 (urinish ${attempt}/${MAX_ATTEMPTS}), ${Math.round(delay / 1000)}s kutilyapti...`,
        );
        await sleep(delay);
        lastRequestAt = 0;
        continue;
      }

      console.warn(`Gemini urinish ${attempt} muvaffaqiyatsiz:`, err);
      if (attempt < MAX_ATTEMPTS && !isRateLimitError(err)) {
        await sleep(1_000 * attempt);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini qayta ishlash muvaffaqiyatsiz");
}
