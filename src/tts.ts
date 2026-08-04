import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { config } from "./config.js";
import { isTtsEnabled, setNewsAudioPath, type NewsRow } from "./db.js";
import {
  ModelPool,
  isModelUnavailableError,
  isRateLimitError,
} from "./gemini.js";

export const ttsModelPool = new ModelPool(
  config.geminiTtsModels,
  "TTS",
  config.geminiCooldownMs,
);

export const AUDIO_DIR = resolve(dirname(config.databasePath), "audio");

/** TTS matni juda uzun bo‘lsa ham audio 1–2 daqiqadan oshmasin */
const MAX_TTS_CHARS = 1_400;
/** Gemini free tier RPM ni saqlash uchun so‘rovlar orasidagi minimal tanaffus */
const MIN_TTS_INTERVAL_MS = 4_500;
const TTS_TIMEOUT_MS = 120_000;

let lastTtsRequestAt = 0;
let ffmpegAvailable = false;
let ffmpegCheckedAt = 0;
let ffmpegWarned = false;

/** ffmpeg yo‘q bo‘lsa qayta tekshirishdan oldingi tanaffus */
const FFMPEG_RECHECK_MS = 60_000;

const inFlight = new Map<string, Promise<NewsAudio | null>>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * ffmpeg mavjudligi. Topilgan bo‘lsa natija keshlanadi; topilmagan bo‘lsa
 * har daqiqada qayta tekshiriladi — shunda `apt install ffmpeg` dan keyin
 * xizmatni qayta ishga tushirish shart bo‘lmaydi.
 */
export function hasFfmpeg(): boolean {
  if (ffmpegAvailable) return true;
  if (ffmpegCheckedAt && Date.now() - ffmpegCheckedAt < FFMPEG_RECHECK_MS) {
    return false;
  }

  ffmpegCheckedAt = Date.now();
  const result = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  ffmpegAvailable = !result.error && result.status === 0;

  if (ffmpegAvailable) ffmpegWarned = false;
  return ffmpegAvailable;
}

/**
 * TTS ishlatish mumkinmi: sozlamada yoqilgan + ffmpeg mavjud.
 * ffmpeg yo‘q bo‘lsa post baribir matn ko‘rinishida ketaveradi.
 */
export function ttsAvailable(): boolean {
  if (!isTtsEnabled()) return false;
  if (!hasFfmpeg()) {
    if (!ffmpegWarned) {
      ffmpegWarned = true;
      console.warn(
        "TTS yoqilgan, lekin ffmpeg topilmadi — audio o‘tkazib yuborildi. " +
          "O‘rnatish: sudo apt install -y ffmpeg",
      );
    }
    return false;
  }
  return true;
}

/** Ovoz chiqarib o‘qish uchun toza matn: emoji, hashtag va havolasiz */
export function ttsTextFromNews(news: NewsRow): string {
  const title = (news.title_uz || news.title_original || "").trim();
  const bullets = (news.summary_uz || "")
    .split("\n")
    .map((line) => line.replace(/^[🔹•\-\s]+/u, "").trim())
    .filter(Boolean);

  const text = [title, ...bullets].filter(Boolean).join(". ").replace(/\.\.+/g, ".");
  if (text.length <= MAX_TTS_CHARS) return text;

  // Gap chegarasida kesamiz
  const cut = text.slice(0, MAX_TTS_CHARS);
  const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  return lastStop > MAX_TTS_CHARS * 0.5 ? cut.slice(0, lastStop + 1) : cut;
}

type PcmAudio = { data: Buffer; sampleRate: number };

/** `audio/L16;codec=pcm;rate=24000` dan sample rate ni ajratadi */
export function sampleRateFromMimeType(mimeType: string | undefined): number {
  const match = /rate=(\d+)/i.exec(mimeType ?? "");
  const rate = match ? Number(match[1]) : NaN;
  return Number.isInteger(rate) && rate > 0 ? rate : 24_000;
}

async function requestSpeechFrom(
  model: string,
  text: string,
): Promise<PcmAudio> {
  const elapsed = Date.now() - lastTtsRequestAt;
  if (lastTtsRequestAt > 0 && elapsed < MIN_TTS_INTERVAL_MS) {
    await sleep(MIN_TTS_INTERVAL_MS - elapsed);
  }
  lastTtsRequestAt = Date.now();

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.geminiApiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text:
                "Quyidagi yangilikni o‘zbek tilida, sokin va aniq diktor ovozida o‘qing. " +
                `Faqat matnni o‘qing, izoh qo‘shmang:\n\n${text}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: config.ttsVoice },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const error = new Error(
      `Gemini TTS HTTP ${res.status}: ${body.slice(0, 300)}`,
    ) as Error & { status: number };
    error.status = res.status;
    throw error;
  }

  const json = (await res.json()) as {
    candidates?: {
      content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
    }[];
  };

  const inline = json.candidates?.[0]?.content?.parts?.find(
    (part) => part.inlineData?.data,
  )?.inlineData;

  if (!inline?.data) {
    throw new Error("Gemini TTS javobida audio yo‘q");
  }

  return {
    data: Buffer.from(inline.data, "base64"),
    sampleRate: sampleRateFromMimeType(inline.mimeType),
  };
}

/** Kvota tugagan modeldan keyingisiga o‘tib urinib ko‘radi */
async function requestGeminiSpeech(text: string): Promise<PcmAudio> {
  let lastError: unknown;

  for (const model of ttsModelPool.candidates()) {
    try {
      return await requestSpeechFrom(model, text);
    } catch (err) {
      lastError = err;
      if (isRateLimitError(err) || isModelUnavailableError(err)) {
        ttsModelPool.markExhausted(model);
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini TTS muvaffaqiyatsiz");
}

/**
 * Xom PCM (s16le) ni berilgan kodek bilan faylga o‘tkazadi.
 * Telegram voice OGG/Opus talab qiladi, saytdagi pleyer uchun esa MP3 kerak —
 * Safari/iOS OGG ni ijro eta olmaydi.
 */
function encodePcm(
  pcm: PcmAudio,
  outputPath: string,
  codecArgs: string[],
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-f", "s16le",
        "-ar", String(pcm.sampleRate),
        "-ac", "1",
        "-i", "pipe:0",
        ...codecArgs,
        outputPath,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );

    let stderr = "";
    ffmpeg.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    ffmpeg.on("error", rejectPromise);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`ffmpeg xatosi (${code}): ${stderr.slice(0, 300)}`));
    });

    ffmpeg.stdin.on("error", rejectPromise);
    ffmpeg.stdin.end(pcm.data);
  });
}

const OPUS_ARGS = ["-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-ac", "1"];
const MP3_ARGS = ["-c:a", "libmp3lame", "-b:a", "64k", "-ar", "44100", "-ac", "1"];

export type NewsAudio = { ogg: string; mp3: string | null };

async function buildAudio(news: NewsRow): Promise<NewsAudio | null> {
  // Bir marta yaratilgan fayl guruh, kanal va saytda qayta ishlatiladi
  if (news.audio_path && existsSync(news.audio_path)) {
    return {
      ogg: news.audio_path,
      mp3:
        news.audio_web_path && existsSync(news.audio_web_path)
          ? news.audio_web_path
          : null,
    };
  }

  const text = ttsTextFromNews(news);
  if (!text) return null;

  mkdirSync(AUDIO_DIR, { recursive: true });
  const oggPath = join(AUDIO_DIR, `${news.id}.ogg`);
  const mp3Path = join(AUDIO_DIR, `${news.id}.mp3`);

  try {
    const pcm = await requestGeminiSpeech(text);
    await encodePcm(pcm, oggPath, OPUS_ARGS);

    // MP3 ixtiyoriy: chiqmasa Telegram baribir ishlaydi, faqat saytda
    // pleyer bo‘lmaydi
    let webPath: string | null = mp3Path;
    try {
      await encodePcm(pcm, mp3Path, MP3_ARGS);
    } catch (err) {
      console.error(`MP3 yaratilmadi (${news.id}):`, err);
      rmSync(mp3Path, { force: true });
      webPath = null;
    }

    setNewsAudioPath(news.id, { ogg: oggPath, mp3: webPath });
    return { ogg: oggPath, mp3: webPath };
  } catch (err) {
    console.error(`TTS xatosi (${news.id}):`, err);
    // Yarim yozilgan fayllarni qoldirmaymiz
    rmSync(oggPath, { force: true });
    rmSync(mp3Path, { force: true });
    return null;
  }
}

/**
 * Yangilik uchun audio tayyorlaydi. Xato bo‘lsa `null` qaytaradi —
 * chaqiruvchi baribir matnni yuboraveradi.
 */
export async function generateNewsAudio(
  news: NewsRow,
): Promise<NewsAudio | null> {
  if (!ttsAvailable()) return null;

  const existing = inFlight.get(news.id);
  if (existing) return existing;

  const promise = buildAudio(news).finally(() => inFlight.delete(news.id));
  inFlight.set(news.id, promise);
  return promise;
}

/**
 * Faqat allaqachon yaratilgan audioni qaytaradi — yangi TTS so‘rovi
 * yuborilmaydi. Guruhga post qilishda shu ishlatiladi: fayl bor bo‘lsa
 * ovoz ham ketadi, yo‘q bo‘lsa faqat matn (kvota sarflanmaydi).
 */
export function existingNewsAudio(news: NewsRow): NewsAudio | null {
  if (!news.audio_path || !existsSync(news.audio_path)) return null;
  return {
    ogg: news.audio_path,
    mp3:
      news.audio_web_path && existsSync(news.audio_web_path)
        ? news.audio_web_path
        : null,
  };
}

export function deleteAudioFile(...paths: (string | null | undefined)[]): void {
  for (const path of paths) {
    if (!path) continue;
    // Faqat o‘zimiz yozadigan katalog ichidagi fayllar o‘chiriladi
    if (!resolve(path).startsWith(AUDIO_DIR)) continue;
    rmSync(path, { force: true });
  }
}

/** Test/diagnostika uchun: WAV konteyneriga o‘rash */
export function pcmToWav(pcm: PcmAudio): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = pcm.sampleRate * 2;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(pcm.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.data.length, 40);

  return Buffer.concat([header, pcm.data]);
}

export async function writeWavForDebug(
  pcm: PcmAudio,
  outputPath: string,
): Promise<void> {
  await writeFile(outputPath, pcmToWav(pcm));
}
