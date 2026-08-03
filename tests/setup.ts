import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Testlar uchun minimal muhit. Bu modul har bir test faylida BIRINCHI
 * import bo‘lishi kerak — ESM importlarni e’lon tartibida bajargani uchun
 * `config.ts` o‘qilgunga qadar process.env to‘ldirilgan bo‘ladi.
 */
const dbPath = join(tmpdir(), `news-test-${randomUUID()}.db`);

process.env.GEMINI_API_KEY ||= "test-key";
process.env.TELEGRAM_BOT_TOKEN ||= "123456:TEST-BOT-TOKEN";
process.env.TELEGRAM_GROUP_ID ||= "-1001234567890";
process.env.ADMIN_TOKEN ||= "0123456789abcdef0123456789abcdef";
process.env.DATABASE_PATH = dbPath;

process.on("exit", () => {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

export const TEST_DB_PATH = dbPath;
export const TEST_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
