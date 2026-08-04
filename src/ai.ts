import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { z } from "zod";
import { config, type Category } from "./config.js";
import { listActiveCategoryNames, resolveCategoryName } from "./db.js";
import {
  ModelPool,
  isModelUnavailableError,
  isRateLimitError,
  retryDelayMs,
  sleep,
} from "./gemini.js";

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

export const textModelPool = new ModelPool(
  config.geminiModels,
  "AI",
  config.geminiCooldownMs,
);

const modelCache = new Map<string, GenerativeModel>();

function getModel(name: string): GenerativeModel {
  let model = modelCache.get(name);
  if (!model) {
    model = genAI.getGenerativeModel({
      model: name,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4,
      },
    });
    modelCache.set(name, model);
  }
  return model;
}

/** Free tier ~15 RPM → kamida ~4.5s oralig‘ida so‘rov */
const MIN_REQUEST_INTERVAL_MS = 4_500;
const MAX_ATTEMPTS_PER_MODEL = 3;

let lastRequestAt = 0;

const aiResponseSchema = z.object({
  title_uz: z.string().min(1),
  bullets: z.array(z.string().min(1)).min(3).max(4),
  category: z.string().min(1),
  // Voqeani aniqlovchi qisqa inglizcha kalit — turli manbalardagi bir xil
  // yangilikni klasterlash uchun. Qo'shimcha token deyarli ketmaydi.
  topic_key: z.string().optional(),
});

export type ProcessedNews = {
  title_uz: string;
  summary_uz: string;
  category: Category;
  /** Klasterlash uchun voqea kaliti (masalan "apple m5 chip launch") */
  topic_key: string;
};

export type ProcessNewsInput = {
  title: string;
  content: string;
  url: string;
};

async function waitForRateLimit(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (lastRequestAt > 0 && elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastRequestAt = Date.now();
}

/**
 * So‘rovni modellar bo‘ylab navbat bilan bajaradi: kvota tugasa yoki model
 * mavjud bo‘lmasa keyingisiga o‘tadi.
 */
async function callWithFallback<T>(
  run: (model: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (const model of textModelPool.candidates()) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        await waitForRateLimit();
        return await run(model);
      } catch (err) {
        lastError = err;

        if (isModelUnavailableError(err)) {
          console.warn(`[AI] "${model}" mavjud emas — keyingisiga o‘tilyapti`);
          textModelPool.markExhausted(model);
          break;
        }

        if (isRateLimitError(err)) {
          if (attempt === MAX_ATTEMPTS_PER_MODEL) {
            textModelPool.markExhausted(model);
            break;
          }
          const delay = retryDelayMs(err, attempt);
          console.warn(
            `[AI] ${model} 429 (${attempt}/${MAX_ATTEMPTS_PER_MODEL}), ${Math.round(delay / 1000)}s kutilyapti...`,
          );
          await sleep(delay);
          lastRequestAt = 0;
          continue;
        }

        console.warn(`[AI] ${model} urinish ${attempt} muvaffaqiyatsiz:`, err);
        if (attempt < MAX_ATTEMPTS_PER_MODEL) await sleep(1_000 * attempt);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini qayta ishlash muvaffaqiyatsiz");
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
5. "topic_key" — voqeani aniqlovchi 3-6 ta INGLIZCHA kalit so'z, kichik harflarda.
   Faqat asosiy ishtirokchi va harakatni yozing (kompaniya, mahsulot, hodisa).
   Xuddi shu voqea haqidagi boshqa maqola ham AYNAN shu kalitni olishi kerak.
   Masalan: "apple m5 chip launch", "openai funding round".

Faqat JSON qaytaring (boshqa matn yo'q):
{
  "title_uz": "...",
  "bullets": ["...", "...", "..."],
  "category": "${categories[0]}",
  "topic_key": "..."
}

Manba URL: ${url}
Asl sarlavha: ${title}
Matn / qisqa mazmun:
${content.slice(0, 4000)}`;
}

export type ClusterMember = {
  source: string;
  title: string;
  content: string;
};

/**
 * Bir xil yangilikni bir necha manbadan olib, bitta umumiy xulosa yasaydi.
 */
function buildClusterPrompt(
  members: ClusterMember[],
  categories: string[],
): string {
  const blocks = members
    .map(
      (m, i) =>
        `--- Manba ${i + 1}: ${m.source} ---\nSarlavha: ${m.title}\nMatn: ${m.content.slice(0, 1500)}`,
    )
    .join("\n\n");

  return `Siz texnologiya yangiliklari muharririsiz. Quyida BITTA voqea haqida ${members.length} ta turli manbadan olingan xabar bor.

Talablar:
1. Hammasidan bitta umumiy xulosa yasang — takrorlanmang, manbalardagi qo'shimcha tafsilotlarni birlashtiring.
2. Sarlavhani o'zbek tiliga aniq va qiziqarli qilib yozing.
3. 3 yoki 4 ta bullet point (har biri 1–2 jumla).
4. Manba nomlarini xulosa ichida sanamang — ular alohida ko'rsatiladi.
5. Kategoriyani faqat shu ro'yxatdan tanlang (aynan shu yozuv bilan): ${categories.join(", ")}.

Faqat JSON qaytaring (boshqa matn yo'q):
{
  "title_uz": "...",
  "bullets": ["...", "...", "..."],
  "category": "${categories[0]}"
}

${blocks}`;
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

/**
 * AI topic_key bermasa sarlavhadan zaxira kalit yasaladi. Bunday kalit
 * klasterlashda kamroq ishlaydi, lekin hech bo'lmasa aynan bir xil
 * sarlavhalarni bog'laydi.
 */
export function normalizeTopicKey(raw: string, fallbackTitle: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(" ")
    .trim();

  if (cleaned) return cleaned;

  return fallbackTitle
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 6)
    .join(" ")
    .trim();
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

  const topicKeyRaw = parsed.success
    ? (parsed.data.topic_key ?? "")
    : (readString(raw, "topic_key") ?? "");

  if (parsed.success) {
    return {
      title_uz: parsed.data.title_uz.trim(),
      summary_uz: parsed.data.bullets.map((b) => b.trim()).join("\n"),
      category,
      topic_key: normalizeTopicKey(topicKeyRaw, parsed.data.title_uz),
    };
  }

  const bullets =
    typeof raw === "object" &&
    raw !== null &&
    Array.isArray((raw as { bullets?: unknown }).bullets)
      ? (raw as { bullets: unknown[] }).bullets.filter(
          (b): b is string => typeof b === "string" && Boolean(b.trim()),
        )
      : [];

  if (bullets.length < 3) {
    throw new Error("Bullet pointlar yetarli emas");
  }

  const title_uz = readString(raw, "title_uz") ?? fallbackTitle;

  return {
    title_uz: title_uz.trim() || fallbackTitle,
    summary_uz: bullets
      .slice(0, 4)
      .map((b) => b.trim())
      .join("\n"),
    category,
    topic_key: normalizeTopicKey(topicKeyRaw, title_uz || fallbackTitle),
  };
}

function requireCategories(): string[] {
  const categories = listActiveCategoryNames();
  if (categories.length === 0) {
    throw new Error(
      "Aktiv kategoriya yo‘q — admin panelda kamida bittasini qo‘shing",
    );
  }
  return categories;
}

export async function processNews(
  input: ProcessNewsInput,
): Promise<ProcessedNews> {
  const categories = requireCategories();
  return callWithFallback(async (model) => {
    const result = await getModel(model).generateContent(
      buildPrompt(input, categories),
    );
    return parseAiPayload(extractJson(result.response.text()), input.title);
  });
}

/** Bir voqea haqidagi bir nechta xabardan bitta umumiy post yasaydi */
export async function mergeClusterNews(
  members: ClusterMember[],
): Promise<ProcessedNews> {
  if (members.length === 0) throw new Error("Klaster bo‘sh");
  const categories = requireCategories();

  return callWithFallback(async (model) => {
    const result = await getModel(model).generateContent(
      buildClusterPrompt(members, categories),
    );
    return parseAiPayload(
      extractJson(result.response.text()),
      members[0]!.title,
    );
  });
}
