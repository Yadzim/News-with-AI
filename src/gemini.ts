/**
 * Bir nechta Gemini modeli ustidan navbat bilan ishlaydigan hovuz.
 *
 * Free tier kvotasi tugaganda (429) model vaqtincha "charchagan" deb
 * belgilanadi va keyingi so‘rovlar ro‘yxatdagi navbatdagi modelga tushadi.
 * Cooldown tugagach model yana sinab ko‘riladi.
 */
export class ModelPool {
  private readonly exhaustedUntil = new Map<string, number>();

  constructor(
    private readonly models: string[],
    private readonly label: string,
    private readonly cooldownMs = 30 * 60_000,
  ) {}

  /** Hozir ishlatsa bo‘ladigan modellar (charchamaganlari oldinda) */
  candidates(now = Date.now()): string[] {
    const fresh = this.models.filter(
      (model) => (this.exhaustedUntil.get(model) ?? 0) <= now,
    );
    // Hammasi charchagan bo‘lsa ham urinib ko‘ramiz — kvota tiklangan bo‘lishi
    // mumkin va boshqa iloj yo‘q
    return fresh.length > 0 ? fresh : [...this.models];
  }

  markExhausted(model: string, now = Date.now()): void {
    this.exhaustedUntil.set(model, now + this.cooldownMs);
    const rest = this.candidates(now).filter((m) => m !== model);
    console.warn(
      `[${this.label}] "${model}" kvotasi tugadi, ${Math.round(this.cooldownMs / 60_000)} daqiqaga chetlatildi` +
        (rest.length ? `. Keyingisi: "${rest[0]}"` : " (boshqa model yo‘q)"),
    );
  }

  isExhausted(model: string, now = Date.now()): boolean {
    return (this.exhaustedUntil.get(model) ?? 0) > now;
  }

  reset(): void {
    this.exhaustedUntil.clear();
  }

  status(now = Date.now()): { model: string; exhausted: boolean }[] {
    return this.models.map((model) => ({
      model,
      exhausted: this.isExhausted(model, now),
    }));
  }
}

/** 429 / kvota xatosimi */
export function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; message?: string };
  return (
    e.status === 429 ||
    Boolean(e.message?.includes("429")) ||
    Boolean(e.message?.includes("Too Many Requests")) ||
    Boolean(e.message?.includes("RESOURCE_EXHAUSTED")) ||
    Boolean(e.message?.includes("quota"))
  );
}

/** Model umuman yo‘q / mavjud emas (bunda ham keyingi modelga o‘tamiz) */
export function isModelUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; message?: string };
  return (
    e.status === 404 ||
    Boolean(e.message?.includes("404")) ||
    Boolean(e.message?.includes("not found")) ||
    Boolean(e.message?.includes("NOT_FOUND")) ||
    Boolean(e.message?.includes("is not supported"))
  );
}

export function retryDelayMs(err: unknown, attempt: number): number {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);

  const match = msg.match(/retry in ([\d.]+)\s*m?s/i);
  if (match) {
    const secondsOrMs = Number(match[1]);
    // "541.608053ms" yoki "5.2s"
    const ms = /ms/i.test(msg.slice(msg.toLowerCase().indexOf("retry")))
      ? secondsOrMs
      : secondsOrMs * 1000;
    return Math.max(ms, 1_000) + 500;
  }

  // Exponential backoff: 5s, 15s, 30s, 60s...
  return Math.min(5_000 * 3 ** (attempt - 1), 60_000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ro‘yxatdagi bo‘sh bo‘lmagan, takrorlanmagan model nomlari */
export function uniqueModels(...names: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const name of names) {
    const trimmed = (name ?? "").trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen];
}
