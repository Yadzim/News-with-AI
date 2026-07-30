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

const SITE_NAMES: Record<string, string> = {
  "techcrunch.com": "TechCrunch",
  "theverge.com": "The Verge",
  "wired.com": "Wired",
  "news.ycombinator.com": "Hacker News",
  "hnrss.org": "Hacker News",
  "technologyreview.com": "MIT Tech Review",
  "thenextweb.com": "The Next Web",
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
