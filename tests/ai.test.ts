import "./setup.js";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeTopicKey, parseAiPayload } from "../src/ai.js";
import {
  ModelPool,
  isModelUnavailableError,
  isRateLimitError,
  retryDelayMs,
  uniqueModels,
} from "../src/gemini.js";

/** Testda DB ga bog‘lanmaslik uchun sodda resolver */
const resolve = (name: string) =>
  ["AI", "Hardware", "General Tech"].find(
    (c) => c.toLowerCase() === name.trim().toLowerCase(),
  ) ?? "General Tech";

describe("parseAiPayload", () => {
  it("to‘g‘ri javobni o‘qiydi", () => {
    const result = parseAiPayload(
      { title_uz: "  Sarlavha  ", bullets: ["a", "b", "c"], category: "AI" },
      "fallback",
      resolve,
    );
    assert.deepEqual(result, {
      title_uz: "Sarlavha",
      summary_uz: "a\nb\nc",
      category: "AI",
      topic_key: "sarlavha",
    });
  });

  it("noma’lum kategoriyani fallbackka moslaydi", () => {
    const result = parseAiPayload(
      { title_uz: "T", bullets: ["a", "b", "c"], category: "Kosmonavtika" },
      "fallback",
      resolve,
    );
    assert.equal(result.category, "General Tech");
  });

  it("dinamik kategoriyani qabul qiladi", () => {
    const result = parseAiPayload(
      { title_uz: "T", bullets: ["a", "b", "c"], category: "Fintex" },
      "fallback",
      (name) => (name === "Fintex" ? "Fintex" : null),
    );
    assert.equal(result.category, "Fintex");
  });

  it("4 tadan ortiq bulletni kesadi", () => {
    const result = parseAiPayload(
      { title_uz: "T", bullets: ["a", "b", "c", "d", "e", "f"], category: "AI" },
      "fallback",
      resolve,
    );
    assert.equal(result.summary_uz.split("\n").length, 4);
  });

  it("title_uz yo‘q bo‘lsa fallback sarlavhani ishlatadi", () => {
    const result = parseAiPayload(
      { bullets: ["a", "b", "c"], category: "AI" },
      "Zaxira sarlavha",
      resolve,
    );
    assert.equal(result.title_uz, "Zaxira sarlavha");
  });

  it("bulletlar yetarli bo‘lmasa xato beradi", () => {
    assert.throws(
      () => parseAiPayload({ title_uz: "T", bullets: ["a"], category: "AI" }, "f", resolve),
      /Bullet pointlar yetarli emas/,
    );
  });

  it("aktiv kategoriya bo‘lmasa aniq xato beradi", () => {
    assert.throws(
      () =>
        parseAiPayload(
          { title_uz: "T", bullets: ["a", "b", "c"], category: "AI" },
          "f",
          () => null,
        ),
      /Aktiv kategoriya yo‘q/,
    );
  });

  it("butunlay noto‘g‘ri javobda ham yiqilmaydi", () => {
    assert.throws(() => parseAiPayload("salom", "f", resolve), /Bullet pointlar/);
  });
});

describe("isRateLimitError", () => {
  it("429 ni aniqlaydi", () => {
    assert.equal(isRateLimitError({ status: 429 }), true);
    assert.equal(isRateLimitError({ message: "got 429 Too Many Requests" }), true);
    assert.equal(isRateLimitError({ message: "quota exceeded" }), true);
  });

  it("boshqa xatolarni rate limit demaydi", () => {
    assert.equal(isRateLimitError({ status: 500 }), false);
    assert.equal(isRateLimitError(null), false);
    assert.equal(isRateLimitError("xato"), false);
  });
});

describe("retryDelayMs", () => {
  it("javobdagi retry vaqtini o‘qiydi", () => {
    assert.equal(retryDelayMs({ message: "retry in 5.2s" }, 1), 5_700);
  });

  it("retry vaqti bo‘lmasa eksponensial kutadi", () => {
    assert.equal(retryDelayMs({ message: "xato" }, 1), 5_000);
    assert.equal(retryDelayMs({ message: "xato" }, 2), 15_000);
    assert.equal(retryDelayMs({ message: "xato" }, 5), 60_000, "60s bilan cheklanadi");
  });
});

describe("normalizeTopicKey", () => {
  it("kalitni kichik harf va so‘zlarga keltiradi", () => {
    assert.equal(normalizeTopicKey("Apple M5 Chip, Launch!", "x"), "apple m5 chip launch");
  });

  it("kalit bo‘sh bo‘lsa sarlavhadan yasaydi", () => {
    assert.equal(
      normalizeTopicKey("", "Apple yangi protsessorini taqdim etdi"),
      "apple yangi protsessorini taqdim etdi",
    );
  });

  it("sarlavhadagi qisqa so‘zlarni tashlab yuboradi", () => {
    assert.equal(normalizeTopicKey("", "AI va yangi chip"), "yangi chip");
  });

  it("juda uzun kalitni cheklaydi", () => {
    const key = normalizeTopicKey("a b c d e f g h i j k l", "x");
    assert.equal(key.split(" ").length, 8);
  });
});

describe("ModelPool", () => {
  const NOW = 1_000_000;

  it("boshida hamma modellar mavjud", () => {
    const pool = new ModelPool(["a", "b"], "test", 60_000);
    assert.deepEqual(pool.candidates(NOW), ["a", "b"]);
  });

  it("kvotasi tugagan model chetlatiladi", () => {
    const pool = new ModelPool(["a", "b"], "test", 60_000);
    pool.markExhausted("a", NOW);
    assert.deepEqual(pool.candidates(NOW), ["b"]);
    assert.equal(pool.isExhausted("a", NOW), true);
  });

  it("cooldown tugagach model qaytadi", () => {
    const pool = new ModelPool(["a", "b"], "test", 60_000);
    pool.markExhausted("a", NOW);
    assert.deepEqual(pool.candidates(NOW + 60_001), ["a", "b"]);
  });

  it("hammasi charchagan bo‘lsa ham urinib ko‘radi", () => {
    const pool = new ModelPool(["a", "b"], "test", 60_000);
    pool.markExhausted("a", NOW);
    pool.markExhausted("b", NOW);
    assert.deepEqual(pool.candidates(NOW), ["a", "b"]);
  });

  it("reset holatni tozalaydi", () => {
    const pool = new ModelPool(["a"], "test", 60_000);
    pool.markExhausted("a", NOW);
    pool.reset();
    assert.equal(pool.isExhausted("a", NOW), false);
  });
});

describe("uniqueModels", () => {
  it("bo‘sh va takrorlangan nomlarni tashlaydi", () => {
    assert.deepEqual(uniqueModels("a", "", undefined, "b", "a", "  "), ["a", "b"]);
  });

  it("bo‘shliqlarni kesadi", () => {
    assert.deepEqual(uniqueModels("  a  ", "b"), ["a", "b"]);
  });
});

describe("isModelUnavailableError", () => {
  it("404 va not found ni aniqlaydi", () => {
    assert.equal(isModelUnavailableError({ status: 404 }), true);
    assert.equal(isModelUnavailableError({ message: "model not found" }), true);
  });

  it("boshqa xatolarni aniqlamaydi", () => {
    assert.equal(isModelUnavailableError({ status: 500 }), false);
    assert.equal(isModelUnavailableError(null), false);
  });
});
