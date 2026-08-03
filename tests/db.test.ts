import "./setup.js";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCategory,
  createSource,
  deleteCategory,
  deleteNews,
  deleteSource,
  getCategoryByThreadId,
  getThreadId,
  insertNews,
  isUrlBlocked,
  jaccardSimilarity,
  listActiveCategoryNames,
  listActiveSources,
  listSources,
  resolveCategoryName,
  similarTitleExists,
  titleTokens,
  updateCategory,
  updateSource,
} from "../src/db.js";

describe("seed", () => {
  it("standart kategoriyalar va manbalar yaratiladi", () => {
    assert.ok(listActiveCategoryNames().includes("AI"));
    assert.ok(listActiveCategoryNames().includes("General Tech"));
    assert.ok(listSources().length >= 6);
  });
});

describe("kategoriyalar", () => {
  it("qo‘shish va topic biriktirish", () => {
    const created = createCategory({ name: "Kosmos", thread_id: 501 });
    assert.equal(created.name, "Kosmos");
    assert.equal(getThreadId("Kosmos"), 501);
    assert.equal(getCategoryByThreadId(501)?.name, "Kosmos");
  });

  it("topic biriktirilmagan kategoriya null qaytaradi", () => {
    createCategory({ name: "Topiksiz" });
    assert.equal(getThreadId("Topiksiz"), null);
  });

  it("takroriy nomni (registrdan qat’i nazar) rad etadi", () => {
    createCategory({ name: "Biotex" });
    assert.throws(() => createCategory({ name: "biotex" }), /allaqachon mavjud/);
  });

  it("bo‘sh nomni rad etadi", () => {
    assert.throws(() => createCategory({ name: "   " }), /bo‘sh bo‘lmasligi/);
  });

  it("deaktiv kategoriya aktivlar ro‘yxatidan chiqadi", () => {
    const c = createCategory({ name: "Vaqtinchalik" });
    updateCategory(c.id, { is_active: false });
    assert.ok(!listActiveCategoryNames().includes("Vaqtinchalik"));
  });

  it("nom o‘zgarsa mavjud yangiliklar ham ko‘chadi", () => {
    const c = createCategory({ name: "Eski nom" });
    const news = insertNews({
      source_url: "https://example.com/rename-test",
      title_original: "x",
      title_uz: "x",
      summary_uz: "a\nb\nc",
      category: "Eski nom",
      published_at: null,
    });
    updateCategory(c.id, { name: "Yangi nom" });
    assert.equal(listActiveCategoryNames().includes("Yangi nom"), true);
    deleteNews(news.id);
  });

  it("o‘chirilgan kategoriya ro‘yxatdan yo‘qoladi", () => {
    const c = createCategory({ name: "O‘chiriladigan" });
    assert.equal(deleteCategory(c.id), true);
    assert.ok(!listActiveCategoryNames().includes("O‘chiriladigan"));
  });
});

describe("resolveCategoryName", () => {
  it("aynan mos kelganini qaytaradi", () => {
    assert.equal(resolveCategoryName("AI"), "AI");
  });

  it("registr va bo‘shliq farqini kechiradi", () => {
    assert.equal(resolveCategoryName("  general tech "), "General Tech");
    assert.equal(resolveCategoryName("generaltech"), "General Tech");
  });

  it("noma’lum nom uchun fallback beradi", () => {
    assert.equal(resolveCategoryName("Butunlay boshqa narsa"), "General Tech");
  });
});

describe("manbalar", () => {
  it("qo‘shish va www/slash saqlanishi", () => {
    const s = createSource({
      name: "Test Feed",
      url: "https://www.example-feed.com/rss/",
    });
    assert.equal(s.url, "https://www.example-feed.com/rss/");
  });

  it("bir xil feedni ikkinchi marta qo‘shmaydi", () => {
    createSource({ name: "Dubl manba", url: "https://dubl.example.com/feed/" });
    assert.throws(
      () => createSource({ name: "Dubl 2", url: "http://www.dubl.example.com/feed" }),
      /allaqachon qo‘shilgan/,
    );
  });

  it("http(s) bo‘lmagan sxemani rad etadi", () => {
    assert.throws(
      () => createSource({ name: "Yomon", url: "javascript:alert(1)" }),
      /http yoki https/,
    );
  });

  it("deaktiv manba fetch ro‘yxatiga tushmaydi", () => {
    const s = createSource({ name: "O‘chiq manba", url: "https://ochiq.example.com/feed" });
    updateSource(s.id, { is_active: false });
    assert.ok(!listActiveSources().some((x) => x.id === s.id));
    assert.ok(listSources(true).some((x) => x.id === s.id));
    deleteSource(s.id);
  });
});

describe("o‘chirilgan URL lar", () => {
  it("o‘chirilgan yangilik qayta olib kelinmaydi", () => {
    const url = "https://example.com/qayta-kelmasin?utm_source=x";
    const news = insertNews({
      source_url: url,
      title_original: "Bir marta",
      title_uz: "Bir marta",
      summary_uz: "a\nb\nc",
      category: "AI",
      published_at: null,
    });

    assert.equal(isUrlBlocked(url), true, "bazada bor — bloklangan");
    const removed = deleteNews(news.id);
    assert.equal(removed?.id, news.id);
    assert.equal(
      isUrlBlocked("https://example.com/qayta-kelmasin"),
      true,
      "o‘chirilgandan keyin ham bloklangan bo‘lishi kerak",
    );
  });

  it("mavjud bo‘lmagan id uchun undefined", () => {
    assert.equal(deleteNews("yo‘q-id"), undefined);
  });
});

describe("sarlavha o‘xshashligi", () => {
  it("tokenlarga ajratadi va qisqa so‘zlarni tashlaydi", () => {
    assert.deepEqual(
      [...titleTokens("AI, va yangi chip: 2026!")],
      ["yangi", "chip", "2026"],
    );
  });

  it("jaccard bir xil to‘plamlar uchun 1", () => {
    assert.equal(jaccardSimilarity(new Set(["a", "b"]), new Set(["b", "a"])), 1);
  });

  it("bo‘sh to‘plam uchun 0", () => {
    assert.equal(jaccardSimilarity(new Set(), new Set(["a"])), 0);
  });

  it("aynan bir xil sarlavhani aniqlaydi", () => {
    const title = "Apple yangi protsessorini taqdim etdi bugun";
    insertNews({
      source_url: "https://example.com/dedupe-1",
      title_original: title,
      title_uz: title,
      summary_uz: "a\nb\nc",
      category: "AI",
      published_at: null,
    });
    assert.equal(similarTitleExists(title), true);
  });

  it("butunlay boshqa sarlavhani o‘xshash demaydi", () => {
    assert.equal(
      similarTitleExists("Rossiyada kosmik stansiya qurilishi boshlandi"),
      false,
    );
  });

  it("juda qisqa sarlavhani tekshirmaydi", () => {
    assert.equal(similarTitleExists("Qisqa"), false);
  });
});
