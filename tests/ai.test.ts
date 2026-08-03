import "./setup.js";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRateLimitError, parseAiPayload, retryDelayMs } from "../src/ai.js";

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
