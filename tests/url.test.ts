import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  escapeHtml,
  isHttpUrl,
  isSameFeed,
  normalizeSourceUrl,
  sanitizeFeedUrl,
  sanitizeSourceUrl,
  siteNameFromUrl,
} from "../src/url.js";

describe("normalizeSourceUrl", () => {
  it("www, http va oxirgi slashni bir xil shaklga keltiradi", () => {
    assert.equal(
      normalizeSourceUrl("http://WWW.TechCrunch.com/2026/a/"),
      "https://techcrunch.com/2026/a",
    );
  });

  it("kuzatuv parametrlarini olib tashlaydi, foydalilarini qoldiradi", () => {
    assert.equal(
      normalizeSourceUrl("https://a.com/b?utm_source=x&fbclid=y&id=5"),
      "https://a.com/b?id=5",
    );
  });

  it("fragmentni olib tashlaydi", () => {
    assert.equal(normalizeSourceUrl("https://a.com/b#bolim"), "https://a.com/b");
  });

  it("faqat domen bo‘lsa ildiz yo‘lni saqlaydi", () => {
    assert.equal(normalizeSourceUrl("https://a.com"), "https://a.com/");
  });
});

describe("isHttpUrl", () => {
  it("http va https ga ruxsat beradi", () => {
    assert.equal(isHttpUrl("https://a.com/b"), true);
    assert.equal(isHttpUrl("http://a.com/b"), true);
  });

  it("xavfli sxemalarni rad etadi", () => {
    for (const bad of [
      "javascript:alert(1)",
      "javascript:alert(1)//x.com/a",
      "data:text/html,<script>",
      "file:///etc/passwd",
      "not a url",
      "",
    ]) {
      assert.equal(isHttpUrl(bad), false, `rad etilishi kerak edi: ${bad}`);
    }
  });
});

describe("sanitizeSourceUrl", () => {
  it("javascript: uchun null qaytaradi", () => {
    assert.equal(sanitizeSourceUrl("javascript:alert(1)//x.com/a"), null);
  });

  it("to‘g‘ri URL ni normalizatsiya qiladi", () => {
    assert.equal(
      sanitizeSourceUrl("http://www.a.com/b/?utm_medium=z"),
      "https://a.com/b",
    );
  });
});

describe("sanitizeFeedUrl", () => {
  it("www va oxirgi slashni saqlaydi (feed manzili buzilmasin)", () => {
    assert.equal(
      sanitizeFeedUrl("https://www.theverge.com/rss/index.xml"),
      "https://www.theverge.com/rss/index.xml",
    );
    assert.equal(
      sanitizeFeedUrl("https://techcrunch.com/feed/"),
      "https://techcrunch.com/feed/",
    );
  });

  it("hostni kichik harfga o‘tkazadi va fragmentni olib tashlaydi", () => {
    assert.equal(
      sanitizeFeedUrl("https://Feeds.ArsTechnica.COM/a#x"),
      "https://feeds.arstechnica.com/a",
    );
  });

  it("http(s) bo‘lmasa null", () => {
    assert.equal(sanitizeFeedUrl("javascript:alert(1)"), null);
  });
});

describe("isSameFeed", () => {
  it("www / slash / http farqini bir xil deb biladi", () => {
    assert.equal(
      isSameFeed("https://techcrunch.com/feed/", "http://www.techcrunch.com/feed"),
      true,
    );
  });

  it("boshqa yo‘lni farqlaydi", () => {
    assert.equal(
      isSameFeed("https://a.com/feed", "https://a.com/boshqa-feed"),
      false,
    );
  });
});

describe("siteNameFromUrl", () => {
  it("ma’lum saytlarga chiroyli nom beradi", () => {
    assert.equal(siteNameFromUrl("https://techcrunch.com/a"), "TechCrunch");
    assert.equal(siteNameFromUrl("https://www.theverge.com/a"), "The Verge");
  });

  it("noma’lum sayt uchun domendan nom yasaydi", () => {
    assert.equal(siteNameFromUrl("https://example.org/a"), "Example");
  });

  it("buzuq URL uchun ham yiqilmaydi", () => {
    assert.equal(siteNameFromUrl("not-a-url"), "Manba");
  });
});

describe("escapeHtml", () => {
  it("Telegram HTML uchun xavfli belgilarni almashtiradi", () => {
    assert.equal(
      escapeHtml('<b>"A" & B</b>'),
      "&lt;b&gt;&quot;A&quot; &amp; B&lt;/b&gt;",
    );
  });
});
