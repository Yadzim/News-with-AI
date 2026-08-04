import { createHmac, timingSafeEqual } from "node:crypto";

/** Uzunlik sizib chiqmasligi uchun doimiy vaqtli solishtirish */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type InitDataResult = {
  userId: number;
  authDate: number;
};

/** Diagnostika uchun: initData ichida qaysi maydonlar borligi (qiymatlarsiz) */
export function initDataKeys(initData: string): string[] {
  try {
    return [...new URLSearchParams(initData).keys()].sort();
  } catch {
    return [];
  }
}

/**
 * Telegram Mini App `initData` imzosini tekshiradi.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * @returns imzo to‘g‘ri va muddati o‘tmagan bo‘lsa foydalanuvchi ma’lumoti
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86_400,
  now: number = Date.now(),
): InitDataResult | null {
  if (!initData || !botToken) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const hash = params.get("hash");
  if (!hash) return null;

  const buildCheckString = (excluded: string[]): string =>
    [...params.entries()]
      .filter(([key]) => !excluded.includes(key))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken.trim())
    .digest();

  const matches = (checkString: string): boolean =>
    safeEqual(
      createHmac("sha256", secretKey).update(checkString).digest("hex"),
      hash,
    );

  // Telegram 2024-yilda uchinchi tomon tekshiruvi uchun `signature` maydonini
  // qo‘shdi va uni HMAC hisobiga kiritish-kiritmasligi mijoz versiyasiga
  // qarab farq qiladi. Ikkala variantni ham sinaymiz — ikkalasi ham
  // bot tokeni bilan imzolangani uchun bu himoyani zaiflashtirmaydi.
  if (!matches(buildCheckString(["hash"])) &&
      !matches(buildCheckString(["hash", "signature"]))) {
    return null;
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || authDate <= 0) return null;
  if (Math.floor(now / 1000) - authDate > maxAgeSeconds) return null;

  const rawUser = params.get("user");
  if (!rawUser) return null;

  try {
    const user = JSON.parse(rawUser) as { id?: unknown };
    const userId = Number(user.id);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    return { userId, authDate };
  } catch {
    return null;
  }
}
