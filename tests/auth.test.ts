import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { safeEqual, verifyInitData } from "../src/auth.js";

const BOT_TOKEN = "123456:TEST-BOT-TOKEN";

/** Telegram qanday imzolasa, test uchun ham shunday imzolaymiz */
function signInitData(
  fields: Record<string, string>,
  botToken = BOT_TOKEN,
): string {
  const dataCheckString = Object.keys(fields)
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
