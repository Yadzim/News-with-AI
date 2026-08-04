import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { initDataKeys, safeEqual, verifyInitData } from "../src/auth.js";

const BOT_TOKEN = "123456:TEST-BOT-TOKEN";

/**
 * Telegram qanday imzolasa, test uchun ham shunday imzolaymiz.
 * @param excludeFromHash HMAC hisobidan chiqariladigan maydonlar — Telegram
 *   `signature` ni kiritish-kiritmasligi mijoz versiyasiga qarab farq qiladi
 */
function signInitData(
  fields: Record<string, string>,
  botToken = BOT_TOKEN,
  excludeFromHash: string[] = [],
): string {
  const dataCheckString = Object.keys(fields)
    .filter((key) => !excludeFromHash.includes(key))
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const params = new URLSearchParams(fields);
  params.set("hash", hash);
  return params.toString();
}

const NOW = 1_800_000_000_000; // barqaror "hozir"
const authDate = String(Math.floor(NOW / 1000) - 60);
const user = JSON.stringify({ id: 777, first_name: "A" });

describe("verifyInitData", () => {
  it("to‘g‘ri imzoni qabul qiladi", () => {
    const initData = signInitData({ auth_date: authDate, user, query_id: "AA" });
    const result = verifyInitData(initData, BOT_TOKEN, 86_400, NOW);
    assert.deepEqual(result, { userId: 777, authDate: Number(authDate) });
  });

  it("signature maydoni HMAC ichida bo‘lganda ham qabul qiladi", () => {
    // Telegram 2024-yildan beri uchinchi tomon tekshiruvi uchun `signature`
    // qo‘shadi; ba’zi mijozlar uni hash hisobiga kiritadi
    const initData = signInitData({
      auth_date: authDate,
      user,
      signature: "Ed25519SignatureBase64Url",
    });
    assert.deepEqual(verifyInitData(initData, BOT_TOKEN, 86_400, NOW), {
      userId: 777,
      authDate: Number(authDate),
    });
  });

  it("signature HMAC dan chiqarilgan bo‘lsa ham qabul qiladi", () => {
    const initData = signInitData(
      { auth_date: authDate, user, signature: "Ed25519SignatureBase64Url" },
      BOT_TOKEN,
      ["signature"],
    );
    assert.deepEqual(verifyInitData(initData, BOT_TOKEN, 86_400, NOW), {
      userId: 777,
      authDate: Number(authDate),
    });
  });

  it("bot tokenidagi ortiqcha bo‘shliqqa qaramay ishlaydi", () => {
    const initData = signInitData({ auth_date: authDate, user });
    assert.ok(verifyInitData(initData, `  ${BOT_TOKEN}\n`, 86_400, NOW));
  });

  it("o‘zgartirilgan ma’lumotni rad etadi", () => {
    const initData = signInitData({ auth_date: authDate, user });
    const tampered = initData.replace("777", "888");
    assert.equal(verifyInitData(tampered, BOT_TOKEN, 86_400, NOW), null);
  });

  it("boshqa bot tokeni bilan imzolanganini rad etadi", () => {
    const initData = signInitData({ auth_date: authDate, user }, "999:BOSHQA");
    assert.equal(verifyInitData(initData, BOT_TOKEN, 86_400, NOW), null);
  });

  it("muddati o‘tganini rad etadi", () => {
    const old = String(Math.floor(NOW / 1000) - 90_000);
    const initData = signInitData({ auth_date: old, user });
    assert.equal(verifyInitData(initData, BOT_TOKEN, 86_400, NOW), null);
  });

  it("hash yo‘q bo‘lsa rad etadi", () => {
    assert.equal(
      verifyInitData(`auth_date=${authDate}&user=${encodeURIComponent(user)}`, BOT_TOKEN, 86_400, NOW),
      null,
    );
  });

  it("user yo‘q bo‘lsa rad etadi", () => {
    const initData = signInitData({ auth_date: authDate });
    assert.equal(verifyInitData(initData, BOT_TOKEN, 86_400, NOW), null);
  });

  it("bo‘sh kirishlarni rad etadi", () => {
    assert.equal(verifyInitData("", BOT_TOKEN), null);
    assert.equal(verifyInitData("a=b", ""), null);
  });
});

describe("safeEqual", () => {
  it("bir xil satrlar uchun true", () => {
    assert.equal(safeEqual("abc123", "abc123"), true);
  });

  it("turli satrlar uchun false", () => {
    assert.equal(safeEqual("abc123", "abc124"), false);
  });

  it("uzunligi har xil bo‘lsa yiqilmaydi", () => {
    assert.equal(safeEqual("abc", "abcdef"), false);
    assert.equal(safeEqual("", "x"), false);
  });
});

describe("initDataKeys", () => {
  it("maydon nomlarini qaytaradi (qiymatlarsiz)", () => {
    assert.deepEqual(
      initDataKeys("user=%7B%22id%22%3A1%7D&auth_date=123&hash=abc"),
      ["auth_date", "hash", "user"],
    );
  });

  it("buzuq kirishda bo‘sh ro‘yxat", () => {
    assert.deepEqual(initDataKeys(""), []);
  });
});
