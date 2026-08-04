# AI News Aggregator & Telegram Bot

Texnologik yangiliklarni RSS manbalardan yig‘adi, Google Gemini orqali o‘zbek tiliga tarjima/xulosalaydi va Telegram guruh Topics’iga hamda kanalga avto-post qiladi. Ixtiyoriy ravishda har bir postga yangilikni o‘qib beruvchi ovozli xabar ham qo‘shiladi.

## Stack

- Node.js 20+ / TypeScript
- [grammY](https://grammy.dev) — Telegram bot
- SQLite (`better-sqlite3`) — dedupe va saqlash
- `@google/generative-ai` — Gemini (default: `gemini-3.1-flash-lite`)
- `rss-parser` — RSS
- `node-cron` — jadval (Asia/Tashkent)
- `ffmpeg` — TTS audio (OGG/Opus), faqat audio yoqilgan bo‘lsa

## Tezkor start

```bash
cp .env.example .env
# .env ni to‘ldiring — ADMIN_TOKEN yoki ADMIN_USER_IDS majburiy
openssl rand -hex 32          # ADMIN_TOKEN uchun kalit
npm install
npm test                      # testlar
npm run bot                   # Telegram bot (long polling)
npm run admin                 # Admin panel + API + jadval (tavsiya)
npm run cron                  # Faqat jadval (admin ishlamasa)
npm run fetch                 # Bir martalik RSS + AI (test)
```

**Eslatma:** `admin` ichida ham jadval bor — `cron` bilan birga ishlatmang.
(Ikki marta post ketmaydi — postlash atomik `claim` bilan himoyalangan — lekin
Gemini kvotasi bekorga sarflanadi.)

### Node versiyasi

Server va CI **Node 20** da ishlaydi. Lokalda boshqa major versiyaga o‘tsangiz
`better-sqlite3` native moduli mos kelmay qoladi:

```
Error: The module ... was compiled against a different Node.js version
using NODE_MODULE_VERSION 127. This version of Node.js requires
NODE_MODULE_VERSION 137.
```

Yechim — modulni qayta yig‘ish yoki serverdagi versiyaga qaytish:

```bash
npm rebuild better-sqlite3
# yoki
rm -rf node_modules && npm ci
```

## Admin panel

```bash
npm run admin
# http://127.0.0.1:8787
```

Imkoniyatlar:

- Barcha yangiliklar: kategoriya / holat / qidiruv bo‘yicha filtr
- **Kategoriyalarni boshqarish** — qo‘shish, o‘chirish, yoqish/o‘chirish va
  har biriga forum topic ID (`message_thread_id`) biriktirish
- **RSS manbalarini boshqarish** — qo‘shish, o‘chirish, vaqtincha o‘chirib
  qo‘yish; har bir manbaning oxirgi holati va xatosi ko‘rinadi
- **Qayta olib kelish** (RSS + AI) — fon rejimida, jarayon ko‘rsatkichi bilan
- **Telegramga yuborish** — guruh va kanalga alohida
- **Yuborish jadvali** — guruh va kanal uchun alohida: ixtiyoriy sondagi
  vaqt (kanalga standart kuniga 3 marta) va har safar nechta post ketishi
  (kanalga standart 5 ta)
- **Ovozli xabar (TTS)** — yoqish/o‘chirish

## Xavfsizlik

Admin API to‘liq himoyalangan — himoyasiz holda server **ishga tushmaydi**.
Kirishning ikki yo‘li bor:

1. **`ADMIN_TOKEN`** — kamida 24 belgi. Panel uni `x-admin-token` sarlavhasida
   yuboradi. Query parametrida (`?token=`) qabul qilinmaydi, shuning uchun kalit
   nginx loglariga yoki `Referer` ga tushmaydi.
2. **`ADMIN_USER_IDS`** — Telegram Mini App orqali kirganda `initData` imzosi
   bot tokeni bilan tekshiriladi va user ID shu ro‘yxatda bo‘lsa kalit
   so‘ralmaydi.

Ikkalasini birga ishlatish mumkin: o‘zingiz Mini App’dan kalitsiz, brauzerdan
esa kalit bilan kirasiz.

## Kategoriyalar

Kategoriyalar bazada (`categories`) saqlanadi va admin panelidan boshqariladi:

| Maydon      | Ma’nosi                                                     |
| ----------- | ----------------------------------------------------------- |
| `name`      | Kategoriya nomi (AI promptiga va hashtagga tushadi)          |
| `thread_id` | Guruh topic’i. Bo‘sh bo‘lsa — guruhning umumiy topic’i       |
| `is_active` | O‘chirilgani AI ga taklif qilinmaydi va botda ko‘rinmaydi    |

`.env` dagi `TOPIC_*` faqat **birinchi** ishga tushirishda seed uchun ishlatiladi.
Eski o‘rnatmalarda `topic_mappings` jadvali avtomatik ko‘chiriladi.

### Topic ID olish

1. Guruhda Topics (Forum) yoqing va botni admin qiling.
2. Topic ichiga xabar yuboring va Bot API / loglardan `message_thread_id` ni oling.
3. Admin panel → Kategoriyalar → **Topic** tugmasi orqali kiriting.

## RSS manbalari

Manbalar ham bazada (`sources`) va admin panelidan boshqariladi. Standart
ro‘yxat birinchi ishga tushirishda qo‘shiladi: TechCrunch, The Verge, Wired,
Hacker News, MIT Technology Review, The Next Web.

Faqat to‘g‘ridan-to‘g‘ri RSS/Atom feed havolasi qabul qilinadi (`http`/`https`).
Odatiy sahifa URL’i berilsa aniq xato qaytadi. Har bir manba uchun oxirgi
yig‘ish vaqti, qo‘shilgan yangiliklar soni va xatosi saqlanadi.

## Bir xil yangiliklarni birlashtirish

Bitta voqea bir necha manbada chiqsa, ular alohida post bo‘lmaydi. AI har bir
yangilik uchun qisqa **voqea kaliti** (`topic_key`) qaytaradi — masalan
`apple m5 chip launch`. Kalitlar 60% dan ortiq mos kelsa yangilik mavjud
klasterga qo‘shiladi.

Post vaqtida klasterdagi barcha manbalardan **bitta umumiy xulosa** olinadi
(bir marta, natija bazaga yoziladi) va pastda hamma manba havolasi sanaladi:

```
🔗 Manbalar: TechCrunch · The Verge · Wired
```

Umumiy xulosa uchun AI chaqiruvi yiqilsa (kvota) post baribir ketadi — faqat
asosiy manbaning xulosasi bilan. Admin panelda klaster «3 manba» belgisi bilan
ko‘rinadi.

## Gemini kvotasi va ikkinchi model

Tahlil ham, ovoz sintezi ham **ikkita modeldan** foydalanadi. Birinchisining
kvotasi tugasa (429) u vaqtincha chetlatiladi va so‘rov ikkinchisiga o‘tadi;
`GEMINI_COOLDOWN_MINUTES` (default 30) o‘tgach birinchisi yana sinaladi.

```env
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_MODEL_FALLBACK=gemini-2.0-flash
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
GEMINI_TTS_MODEL_FALLBACK=gemini-2.5-pro-preview-tts
```

## Ovozli xabar (TTS)

Audio **faqat kanalga** yuboriladi — guruhga matn ketadi. TTS kvotasi
qimmat bo‘lgani uchun shunday.

Yoqilganda kanal posti ikki xabardan iborat bo‘ladi: matn, keyin unga javob
qilib yuborilgan ovozli xabar (voice). Audio Gemini TTS orqali yaratiladi,
`ffmpeg` bilan OGG/Opus ga o‘tkaziladi va `data/audio/` da keshlanadi.

```bash
sudo apt install -y ffmpeg
```

`ffmpeg` bo‘lmasa yoki audio yaratishda xato chiqsa **post baribir matn
ko‘rinishida ketaveradi** — audio hech qachon postni bloklamaydi. Admin panelda
`ffmpeg` yo‘qligi haqida ogohlantirish chiqadi.

Ovoz va model `.env` orqali sozlanadi: `TTS_VOICE`, `GEMINI_TTS_MODEL`.

## Serverga o‘rnatish

To‘liq yo‘riqnoma: [`deploy/SERVER.md`](deploy/SERVER.md)

- Node 20 + nginx + HTTPS + ffmpeg
- systemd: `news-bot` + `news-admin` (`npm run bot` / `npm run admin`)
- Mini App / BotFather Menu Button
- Yangilash va troubleshooting

GitHub Actions deploy (`.github/workflows/deploy.yml`): repo Secrets ga
`SSH_HOST`, `SSH_USER`, `SSH_KEY` qo‘ying. `main` ga push → `git pull` +
`systemctl restart`.

Nginx: [`deploy/nginx.admin.conf.example`](deploy/nginx.admin.conf.example) —
`public/` ni static, `/api/` ni Node `8787` ga proxy.

Cronni darhol ishlatish:

```bash
npm run pipeline
# yoki
npx tsx src/cron.ts --now
```

## GitHub Actions

1. **CI** (`.github/workflows/ci.yml`) — har push/PR da typecheck + testlar.
2. **Deploy** (`.github/workflows/deploy.yml`) — `main` ga push → serverda
   `git pull` + `systemctl restart`.

Avto-post serverdagi `news-admin` (systemd) orqali ishlaydi.

## .env

| O‘zgaruvchi           | Tavsif                                             |
| --------------------- | -------------------------------------------------- |
| `GEMINI_API_KEY`      | Google AI Studio kaliti                            |
| `GEMINI_MODEL`        | Tarjima/xulosa modeli                              |
| `GEMINI_MODEL_FALLBACK` | Kvota tugaganda ishlatiladigan ikkinchi model    |
| `GEMINI_TTS_MODEL`    | Ovoz sintezi modeli                                |
| `GEMINI_TTS_MODEL_FALLBACK` | Ovoz uchun ikkinchi model                    |
| `GEMINI_COOLDOWN_MINUTES` | Kvotasi tugagan model necha daqiqa chetlatilsin |
| `TTS_VOICE`           | Gemini ovoz nomi (masalan `Kore`)                  |
| `TELEGRAM_BOT_TOKEN`  | @BotFather tokeni                                  |
| `TELEGRAM_GROUP_ID`   | Forum guruh ID (`-100...`)                          |
| `TELEGRAM_CHANNEL_ID` | Kanal (`@username` yoki `-100...`), ixtiyoriy       |
| `ADMIN_TOKEN`         | Admin API kaliti (min 24 belgi)                    |
| `ADMIN_USER_IDS`      | Mini App uchun ruxsat etilgan Telegram user ID lar |
| `TOPIC_*`             | Faqat birinchi seed uchun topic ID lari            |
| `DATABASE_PATH`       | SQLite yo‘li (default `./data/news.db`)             |
| `PORT`                | Admin API port (default `8787`)                    |
| `WEBAPP_URL`          | Telegram Mini App URL (https)                      |

## Buyruqlar

- `/start` — salom + kategoriya tugmalari
- `/news` — kategoriya tanlash
- Inline: kategoriya → yangilik; **Yana yangilik** → keyingisi

Topic ichida `/start` yoki `/news` yozilsa, shu topic’ga biriktirilgan
kategoriya avtomatik aniqlanadi.

## Loyiha tuzilmasi

```
src/
  config.ts      # env (zod)
  auth.ts        # admin token + Telegram initData imzosi
  db.ts          # SQLite sxema, migratsiyalar, CRUD
  url.ts         # URL normalizatsiya va sxema tekshiruvi
  fetcher.ts     # RSS + dedupe
  ai.ts          # Gemini tarjima/xulosa + klaster birlashtirish
  gemini.ts      # model hovuzi (kvota tugaganda fallback)
  tts.ts         # Gemini TTS → OGG/Opus
  publisher.ts   # guruh/kanalga post
  telegram.ts    # umumiy Bot instansiyasi
  fetch-job.ts   # fon rejimidagi fetch + qulf
  pipeline.ts    # fetch + publish zanjiri
  schedule.ts    # node-cron jadvali
  server.ts      # admin API + static
  bot.ts         # interaktiv rejim
  index.ts       # bot entry
  cron.ts        # faqat jadval
tests/           # node --test
public/          # admin panel / Mini App
```

## Post formati

```
📌 Sarlavha (o‘zbekcha)

🔹 Xulosa 1
🔹 Xulosa 2
🔹 Xulosa 3

🏷 Kategoriya: #AI
🕐 28.07.2026, 15:30
🔗 TechCrunch · havola
```

Xabar Telegram limitidan (4096 belgi) oshsa bulletlar avtomatik qisqartiriladi
— havola tegi hech qachon o‘rtasidan kesilmaydi.

## Dedupe

Bir xil yangilik ikki marta chiqmasligi uchun uch qatlam bor:

1. **URL normalizatsiyasi** — `utm_*`, `www.`, oxirgi `/` va fragment tashlanadi.
2. **Sarlavha o‘xshashligi** — so‘nggi 14 kun ichidagi sarlavhalar bilan
   Jaccard koeffitsienti (≥0.85) bo‘yicha solishtiriladi.
3. **O‘chirilgan URL lar** — admin paneldan o‘chirilgan yangilik `deleted_urls`
   ga yoziladi va qayta olib kelinmaydi.
4. **Klasterlash** — turli manbadagi bir voqea `topic_key` bo‘yicha bitta
   postga birlashtiriladi (yuqoriga qarang).
