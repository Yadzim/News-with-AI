const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Faqat http/https ga ruxsat. `javascript:`, `data:` va boshqalar rad etiladi,
 * shunda RSS dan kelgan zararli havola admin paneliga yoki postga tushmaydi.
 */
export function isHttpUrl(raw: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(raw.trim()).protocol.toLowerCase());
  } catch {
    return false;
  }
}

/** URL ni dedupe uchun bir xil shaklga keltirish (utm, www, trailing slash) */
export function normalizeSourceUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const u = new URL(trimmed);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    u.protocol = u.protocol.toLowerCase() === "http:" ? "https:" : u.protocol;

    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$)/i.test(key)) {
        u.searchParams.delete(key);
      }
    }

    let path = u.pathname.replace(/\/+$/, "");
    if (!path) path = "/";

    const query = u.searchParams.toString();
    return `${u.protocol}//${u.hostname}${path}${query ? `?${query}` : ""}`;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

/** Normalizatsiya + sxema tekshiruvi. http/https bo‘lmasa `null`. */
export function sanitizeSourceUrl(raw: string): string | null {
  if (!isHttpUrl(raw)) return null;
  const normalized = normalizeSourceUrl(raw);
  return isHttpUrl(normalized) ? normalized : null;
}

/**
 * Feed URL uchun yumshoq tozalash: sxema tekshiriladi, host kichik harfga
 * o‘tadi, `#` fragment olib tashlanadi — lekin `www.` va oxirgi `/`
 * saqlanadi, chunki ular feed manzilining bir qismi bo‘lishi mumkin.
 */
export function sanitizeFeedUrl(raw: string): string | null {
  if (!isHttpUrl(raw)) return null;
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    return u.href;
  } catch {
    return null;
  }
}

/** Ikki feed URL amalda bir xilmi (www / oxirgi slash / http-https farqisiz) */
export function isSameFeed(a: string, b: string): boolean {
  return normalizeSourceUrl(a) === normalizeSourceUrl(b);
}

const SITE_NAMES: Record<string, string> = {
  "techcrunch.com": "TechCrunch",
  "theverge.com": "The Verge",
  "wired.com": "Wired",
  "news.ycombinator.com": "Hacker News",
  "hnrss.org": "Hacker News",
  "technologyreview.com": "MIT Tech Review",
  "thenextweb.com": "The Next Web",
  "arstechnica.com": "Ars Technica",
  "engadget.com": "Engadget",
  "zdnet.com": "ZDNet",
  "bleepingcomputer.com": "BleepingComputer",
};

export function siteNameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (SITE_NAMES[host]) return SITE_NAMES[host];
    const base = host.split(".")[0] || host;
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return "Manba";
  }
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
