import "./setup.js";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMergedSummary,
  createCategory,
  createSource,
  deleteCategory,
  deleteNews,
  deleteSource,
  findClusterForTopic,
  getCategoryByThreadId,
  getClusterMembers,
  getClusterSize,
  getNewsById,
  getPendingNewsForChannel,
  getTargetScheduleSettings,
  getThreadId,
  insertNews,
  isUrlBlocked,
  jaccardSimilarity,
  listActiveCategoryNames,
  listActiveSources,
  listSources,
  markClusterPosted,
  parseTimeList,
  resolveCategoryName,
  saveTargetSchedule,
  similarTitleExists,
  titleTokens,
  topicKeyTokens,
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

describe("klasterlash", () => {
  it("o‘xshash topic_key bir klasterga tushadi", () => {
    const first = insertNews({
      source_url: "https://techcrunch.com/apple-m5",
      title_original: "Apple unveils M5 chip",
      title_uz: "Apple M5 chipini taqdim etdi",
      summary_uz: "a\nb\nc",
      category: "AI",
      published_at: null,
      topic_key: "apple m5 chip launch",
    });
    assert.equal(first.is_primary, 1);
    assert.equal(first.cluster_id, first.id);

    // Boshqa manba, xuddi shu voqea
    const cluster = findClusterForTopic("apple m5 chip announcement");
    assert.equal(cluster, first.cluster_id);

    const second = insertNews({
      source_url: "https://www.theverge.com/apple-m5",
      title_original: "Apple's new M5 processor",
      title_uz: "Apple yangi M5 protsessori",
      summary_uz: "d\ne\nf",
      category: "AI",
      published_at: null,
      topic_key: "apple m5 chip announcement",
      cluster_id: cluster,
    });

    assert.equal(second.is_primary, 0, "ikkinchisi alohida post qilinmaydi");
    assert.equal(second.cluster_id, first.cluster_id);
    assert.equal(getClusterSize(first.cluster_id!), 2);
    assert.equal(getClusterMembers(first.cluster_id!).length, 2);
  });

  it("boshqa voqea alohida klaster bo‘ladi", () => {
    insertNews({
      source_url: "https://techcrunch.com/tesla-robot",
      title_original: "Tesla robot",
      title_uz: "Tesla roboti",
      summary_uz: "a\nb\nc",
      category: "AI",
      published_at: null,
      topic_key: "tesla optimus robot demo",
    });
    assert.equal(findClusterForTopic("microsoft azure outage report"), null);
  });

  it("faqat primary yozuv post navbatiga tushadi", () => {
    const before = getPendingNewsForChannel(100).length;
    const primary = insertNews({
      source_url: "https://a.example.com/x1",
      title_original: "X", title_uz: "X", summary_uz: "a\nb\nc",
      category: "AI", published_at: null, topic_key: "unique event alpha beta",
    });
    insertNews({
      source_url: "https://b.example.com/x2",
      title_original: "X2", title_uz: "X2", summary_uz: "a\nb\nc",
      category: "AI", published_at: null, topic_key: "unique event alpha beta",
      cluster_id: primary.cluster_id,
    });
    assert.equal(
      getPendingNewsForChannel(100).length,
      before + 1,
      "ikkita yozuv qo‘shildi, lekin navbatga bittasi tushishi kerak",
    );
  });

  it("klaster butunlay yuborilgan deb belgilanadi", () => {
    const primary = insertNews({
      source_url: "https://a.example.com/y1",
      title_original: "Y", title_uz: "Y", summary_uz: "a\nb\nc",
      category: "AI", published_at: null, topic_key: "gamma delta epsilon zeta",
    });
    insertNews({
      source_url: "https://b.example.com/y2",
      title_original: "Y2", title_uz: "Y2", summary_uz: "a\nb\nc",
      category: "AI", published_at: null, topic_key: "gamma delta epsilon zeta",
      cluster_id: primary.cluster_id,
    });

    markClusterPosted(primary.cluster_id!, "channel");
    for (const member of getClusterMembers(primary.cluster_id!)) {
      assert.equal(member.is_posted_channel, 1);
    }
  });

  it("umumiy xulosa primary yozuvga yoziladi", () => {
    const primary = insertNews({
      source_url: "https://a.example.com/z1",
      title_original: "Z", title_uz: "Eski sarlavha", summary_uz: "a\nb\nc",
      category: "AI", published_at: null, topic_key: "theta iota kappa lambda",
    });

    applyMergedSummary(primary.id, {
      title_uz: "Umumiy sarlavha",
      summary_uz: "1\n2\n3",
      category: "AI",
    });

    const updated = getNewsById(primary.id)!;
    assert.equal(updated.title_uz, "Umumiy sarlavha");
    assert.equal(updated.summary_uz, "1\n2\n3");
    assert.ok(updated.merged_at, "merged_at to‘ldirilishi kerak");
  });
});

describe("topicKeyTokens", () => {
  it("qisqa so‘zlarni tashlaydi va kichik harfga o‘tkazadi", () => {
    assert.deepEqual([...topicKeyTokens("Apple M5 Chip, a Launch!")], [
      "apple", "m5", "chip", "launch",
    ]);
  });
});

describe("jadval vaqtlari", () => {
  it("standart holatda kanalga kuniga 3 marta, 5 tadan", () => {
    const channel = getTargetScheduleSettings().channel;
    assert.equal(channel.times.length, 3);
    assert.equal(channel.limit, 5);
  });

  it("vaqtlarni saqlaydi va tartiblaydi", () => {
    const saved = saveTargetSchedule("channel", {
      times: ["21:00", "07:30", "13:00"],
      enabled: true,
      limit: 7,
    });
    assert.deepEqual(saved.times, ["07:30", "13:00", "21:00"]);
    assert.equal(saved.limit, 7);
  });

  it("bir xil vaqtni takrorlamaydi va formatlaydi", () => {
    const saved = saveTargetSchedule("group", {
      times: ["8:00", "08:00", "20:00"],
      enabled: true,
    });
    assert.deepEqual(saved.times, ["08:00", "20:00"]);
  });

  it("bitta ham to‘g‘ri vaqt bo‘lmasa xato", () => {
    assert.throws(
      () => saveTargetSchedule("group", { times: ["salom", "25:99"], enabled: true }),
      /Kamida bitta vaqt/,
    );
  });

  it("limit chegaralanadi", () => {
    assert.equal(
      saveTargetSchedule("channel", { times: ["09:00"], enabled: true, limit: 9999 }).limit,
      100,
    );
    assert.equal(
      saveTargetSchedule("channel", { times: ["09:00"], enabled: true, limit: 0 }).limit,
      1,
    );
  });
});

describe("parseTimeList", () => {
  it("turli ajratgichlarni qabul qiladi", () => {
    assert.deepEqual(parseTimeList("08:00, 14:00 20:00"), ["08:00", "14:00", "20:00"]);
  });

  it("noto‘g‘ri qiymatlarni tashlaydi", () => {
    assert.deepEqual(parseTimeList("08:00, salom, 25:00, 12:99"), ["08:00"]);
  });

  it("bo‘sh satr uchun bo‘sh ro‘yxat", () => {
    assert.deepEqual(parseTimeList(""), []);
  });
});
