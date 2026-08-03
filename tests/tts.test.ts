import "./setup.js";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NewsRow } from "../src/db.js";
import { pcmToWav, sampleRateFromMimeType, ttsTextFromNews } from "../src/tts.js";

function makeNews(overrides: Partial<NewsRow> = {}): NewsRow {
  return {
    id: "tts-id",
    source_url: "https://techcrunch.com/a",
    title_original: "Original",
    title_uz: "Sarlavha",
    summary_uz: "🔹 Birinchi\n🔹 Ikkinchi\n🔹 Uchinchi",
    category: "AI",
    published_at: null,
    is_posted: 0,
    is_posted_channel: 0,
    audio_path: null,
    created_at: "2026-01-01 00:00:00",
    ...overrides,
  };
}

describe("ttsTextFromNews", () => {
  it("emoji va belgilarsiz o‘qiladigan matn beradi", () => {
    const text = ttsTextFromNews(makeNews());
    assert.equal(text, "Sarlavha. Birinchi. Ikkinchi. Uchinchi");
    assert.ok(!text.includes("🔹"));
  });

  it("havola va hashtag qo‘shmaydi", () => {
    const text = ttsTextFromNews(makeNews());
    assert.ok(!text.includes("http"));
    assert.ok(!text.includes("#"));
  });

  it("tire bilan boshlangan punktlarni ham tozalaydi", () => {
    const text = ttsTextFromNews(makeNews({ summary_uz: "- Bir\n• Ikki" }));
    assert.equal(text, "Sarlavha. Bir. Ikki");
  });

  it("juda uzun matnni cheklaydi", () => {
    const text = ttsTextFromNews(
      makeNews({ summary_uz: Array.from({ length: 40 }, () => "Uzun gap bu.").join("\n") }),
    );
    assert.ok(text.length <= 1400, `matn ${text.length} belgi`);
  });

  it("bo‘sh yangilik uchun bo‘sh satr", () => {
    assert.equal(
      ttsTextFromNews(makeNews({ title_uz: null, title_original: null, summary_uz: "" })),
      "",
    );
  });
});

describe("sampleRateFromMimeType", () => {
  it("mimeType dan rate ni o‘qiydi", () => {
    assert.equal(sampleRateFromMimeType("audio/L16;codec=pcm;rate=24000"), 24_000);
    assert.equal(sampleRateFromMimeType("audio/L16;rate=16000"), 16_000);
  });

  it("noma’lum bo‘lsa 24000 ga qaytadi", () => {
    assert.equal(sampleRateFromMimeType(undefined), 24_000);
    assert.equal(sampleRateFromMimeType("audio/L16"), 24_000);
    assert.equal(sampleRateFromMimeType("audio/L16;rate=abc"), 24_000);
  });
});

describe("pcmToWav", () => {
  it("to‘g‘ri RIFF/WAVE sarlavhasini yozadi", () => {
    const pcm = { data: Buffer.alloc(100), sampleRate: 24_000 };
    const wav = pcmToWav(pcm);

    assert.equal(wav.length, 144);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
    assert.equal(wav.toString("ascii", 36, 40), "data");
    assert.equal(wav.readUInt32LE(4), 136);
    assert.equal(wav.readUInt16LE(20), 1, "PCM format");
    assert.equal(wav.readUInt16LE(22), 1, "mono");
    assert.equal(wav.readUInt32LE(24), 24_000, "sample rate");
    assert.equal(wav.readUInt32LE(28), 48_000, "byte rate");
    assert.equal(wav.readUInt16LE(34), 16, "bit chuqurligi");
    assert.equal(wav.readUInt32LE(40), 100, "data hajmi");
  });
});
