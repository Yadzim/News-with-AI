import "./setup.js";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NewsRow } from "../src/db.js";
import {
  TELEGRAM_TEXT_LIMIT,
  formatNewsMessage,
  formatPublishedAt,
  formatVoiceCaption,
  sourcesFromRows,
} from "../src/publisher.js";

function makeNews(overrides: Partial<NewsRow> = {}): NewsRow {
  return {
    id: "test-id",
    source_url: "https://techcrunch.com/2026/01/maqola",
    title_original: "Original title",
    title_uz: "Sinov sarlavhasi",
    summary_uz: "Birinchi punkt\nIkkinchi punkt\nUchinchi punkt",
    category: "AI",
    published_at: "2026-01-15T10:30:00Z",
    is_posted: 0,
    is_posted_channel: 0,
    audio_path: null,
    cluster_id: null,
    is_primary: 1,
    topic_key: null,
    merged_at: null,
    created_at: "2026-01-15 10:00:00",
    ...overrides,
  };
}

describe("formatNewsMessage", () => {
  it("sarlavha, bulletlar, kategoriya va havolani chiqaradi", () => {
    const text = formatNewsMessage(makeNews());
    assert.match(text, /^📌 Sinov sarlavhasi\n/);
    assert.match(text, /🔹 Birinchi punkt/);
    assert.match(text, /🔹 Uchinchi punkt/);
    assert.match(text, /🏷 Kategoriya: #AI/);
    assert.match(
      text,
      /🔗 <a href="https:\/\/techcrunch\.com\/2026\/01\/maqola">TechCrunch<\/a>$/,
    );
  });

  it("kategoriya nomidagi bo‘shliqni hashtagdan olib tashlaydi", () => {
    const text = formatNewsMessage(makeNews({ category: "General Tech" }));
    assert.match(text, /#GeneralTech/);
  });

  it("dinamik (yangi) kategoriya nomi bilan ham ishlaydi", () => {
    const text = formatNewsMessage(makeNews({ category: "Fintex va bank" }));
    assert.match(text, /#Fintexvabank/);
  });

  it("HTML belgilarini escape qiladi", () => {
    const text = formatNewsMessage(
      makeNews({ title_uz: '<script>alert("x")</script>' }),
    );
    assert.ok(!text.includes("<script>"), "xom <script> qolmasligi kerak");
    assert.match(text, /&lt;script&gt;/);
  });

  it("juda uzun matnni Telegram limitiga sig‘diradi", () => {
    const text = formatNewsMessage(
      makeNews({
        title_uz: "T".repeat(600),
        summary_uz: Array.from({ length: 12 }, (_, i) => `${i} ${"B".repeat(900)}`).join("\n"),
      }),
    );
    assert.ok(
      text.length <= TELEGRAM_TEXT_LIMIT,
      `xabar ${text.length} belgi — limitdan oshdi`,
    );
  });

  it("qisqartirishda havola tegi butun qoladi", () => {
    const text = formatNewsMessage(
      makeNews({ summary_uz: Array.from({ length: 30 }, () => "X".repeat(500)).join("\n") }),
    );
    assert.ok(text.endsWith("</a>"), "havola tegi kesilib qolgan");
    const opens = (text.match(/<a /g) || []).length;
    const closes = (text.match(/<\/a>/g) || []).length;
    assert.equal(opens, closes, "ochilgan/yopilgan teglar mos emas");
  });

  it("bulletlar bo‘lmasa ham yiqilmaydi", () => {
    const text = formatNewsMessage(makeNews({ summary_uz: "" }));
    assert.match(text, /📌 Sinov sarlavhasi/);
    assert.match(text, /TechCrunch<\/a>$/);
  });

  it("title_uz bo‘lmasa asl sarlavhaga qaytadi", () => {
    const text = formatNewsMessage(makeNews({ title_uz: null }));
    assert.match(text, /📌 Original title/);
  });
});

describe("formatPublishedAt", () => {
  it("Toshkent vaqtida formatlaydi (UTC+5)", () => {
    const when = formatPublishedAt(makeNews());
    assert.ok(when, "sana bo‘sh bo‘lmasligi kerak");
    // Ajratgich ICU versiyasiga bog‘liq — kun/oy/yil va soatni tekshiramiz
    assert.match(when, /\b15\b/);
    assert.match(when, /\b01\b/);
    assert.match(when, /2026/);
    assert.match(when, /15:30/, "10:30 UTC → 15:30 Asia/Tashkent");
  });

  it("noto‘g‘ri sana uchun null", () => {
    assert.equal(
      formatPublishedAt(makeNews({ published_at: "buzuq", created_at: "buzuq" })),
      null,
    );
  });
});

describe("formatVoiceCaption", () => {
  it("sarlavhani karnay belgisi bilan beradi", () => {
    assert.equal(formatVoiceCaption(makeNews()), "🔊 Sinov sarlavhasi");
  });

  it("caption limitidan oshmaydi", () => {
    const caption = formatVoiceCaption(makeNews({ title_uz: "U".repeat(3000) }));
    assert.ok(caption.length <= 1024, `caption ${caption.length} belgi`);
  });
});

describe("klaster (bir voqea, bir nechta manba)", () => {
  it("bitta manba bo‘lsa oddiy havola qatori", () => {
    const text = formatNewsMessage(makeNews());
    assert.ok(!text.includes("Manbalar:"), "bitta manbada 'Manbalar' bo‘lmasin");
    assert.match(text, /🔗 <a href=".+">TechCrunch<\/a>$/);
  });

  it("bir nechta manba pastda sanaladi", () => {
    const text = formatNewsMessage(makeNews(), [
      { name: "TechCrunch", url: "https://techcrunch.com/a" },
      { name: "The Verge", url: "https://www.theverge.com/b" },
      { name: "Wired", url: "https://www.wired.com/c" },
    ]);
    assert.match(text, /🔗 Manbalar: /);
    assert.match(text, /<a href="https:\/\/techcrunch\.com\/a">TechCrunch<\/a>/);
    assert.match(text, /<a href="https:\/\/www\.theverge\.com\/b">The Verge<\/a>/);
    assert.match(text, /<a href="https:\/\/www\.wired\.com\/c">Wired<\/a>/);
    assert.equal((text.match(/<a /g) || []).length, 3);
  });

  it("ko‘p manba bo‘lsa ham 4096 limitidan oshmaydi", () => {
    const sources = Array.from({ length: 12 }, (_, i) => ({
      name: `Manba ${i}`,
      url: `https://example${i}.com/juda/uzun/yol/${"x".repeat(80)}`,
    }));
    const text = formatNewsMessage(
      makeNews({ summary_uz: Array.from({ length: 20 }, () => "B".repeat(400)).join("\n") }),
      sources,
    );
    assert.ok(text.length <= TELEGRAM_TEXT_LIMIT, `${text.length} belgi`);
    assert.equal((text.match(/<a /g) || []).length, (text.match(/<\/a>/g) || []).length);
  });
});

describe("sourcesFromRows", () => {
  it("takrorlanuvchi manbalarni bir marta oladi", () => {
    const rows = [
      makeNews({ source_url: "https://techcrunch.com/a" }),
      makeNews({ source_url: "https://techcrunch.com/b" }),
      makeNews({ source_url: "https://www.wired.com/c" }),
    ];
    assert.deepEqual(sourcesFromRows(rows), [
      { name: "TechCrunch", url: "https://techcrunch.com/a" },
      { name: "Wired", url: "https://www.wired.com/c" },
    ]);
  });

  it("bo‘sh ro‘yxat uchun bo‘sh natija", () => {
    assert.deepEqual(sourcesFromRows([]), []);
  });
});
