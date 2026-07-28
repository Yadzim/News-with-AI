# AI News Aggregator & Telegram Bot

Texnologik yangiliklarni RSS manbalardan yig‘adi, Google Gemini orqali o‘zbek tiliga tarjima/xulosalaydi va Telegram guruh Topics’iga avto-post qiladi.

## Stack

- Node.js 20+ / TypeScript
- [grammY](https://grammy.dev) — Telegram bot
- SQLite (`better-sqlite3`) — dedupe va saqlash
- `@google/generative-ai` — Gemini (default: `gemini-3.1-flash-lite`)
- `rss-parser` — RSS
- `node-cron` — 08:00 / 20:00 (Asia/Tashkent)

## Tezkor start

```bash
cp .env.example .env
# .env ni to‘ldiring
npm install
npm run bot      # Telegram bot (long polling)
npm run admin    # Admin panel + API + schedule (tavsiya)
npm run cron     # Faqat schedule (admin bo‘lmasa)
npm run fetch    # Bir martalik RSS + AI (test)
```

**Eslatma:** `admin` ichida ham schedule bor — `cron` bilan birga ishlatmang (ikki marta yuboriladi).

## Admin panel

```bash
npm run admin
# http://127.0.0.1:8787
```

Imkoniyatlar:
- Barcha yangiliklar, kategoriya / status / qidiruv
- **Qayta olib kelish** (RSS + AI)
- **Telegramga yuborish** (pending)
- Yuborish vaqtini sozlash (ertalab / kechqurun, Asia/Tashkent)

Nginx: [`deploy/nginx.admin.conf.example`](deploy/nginx.admin.conf.example) — `public/` ni static, `/api/` ni Node `8787` ga proxy.

Cronni darhol ishlatish:

```bash
npm run pipeline
# yoki
npx tsx src/cron.ts --now
```

## GitHub Actions (CI/CD)

1. **CI** (`.github/workflows/ci.yml`) — `push`/`PR` da TypeScript tekshiruvi.
2. **Pipeline** (`.github/workflows/news-pipeline.yml`) — har kuni **08:00** va **20:00** (Toshkent) RSS → AI → Telegram.

Repo → **Settings → Secrets and variables → Actions** ga qo‘ying:

- `GEMINI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_GROUP_ID`
- `TOPIC_AI`, `TOPIC_HARDWARE`, `TOPIC_CYBERSECURITY`, `TOPIC_STARTUPS`, `TOPIC_GENERAL_TECH`

SQLite `data/news.db` runlar oralig‘ida cache orqali saqlanadi (dedupe uchun). Qo‘lda ishga tushirish: Actions → **News Pipeline** → **Run workflow**.

## .env

| O‘zgaruvchi                       | Tavsif                                   |
| --------------------------------- | ---------------------------------------- |
| `GEMINI_API_KEY`                  | Google AI Studio kaliti                  |
| `TELEGRAM_BOT_TOKEN`              | @BotFather tokeni                        |
| `TELEGRAM_GROUP_ID`               | Forum guruh ID (`-100...`)               |
| `TOPIC_AI` … `TOPIC_GENERAL_TECH` | Har kategoriya uchun `message_thread_id` |
| `DATABASE_PATH`                   | SQLite yo‘li (default `./data/news.db`)  |
| `PORT`                            | Admin API port (default `8787`)          |
| `ADMIN_TOKEN`                     | Admin API token (ixtiyoriy)              |

### Topic ID olish

1. Guruhda Topics (Forum) yoqing.
2. Har bir topic yaratib, botni admin qiling.
3. Topic’ga xabar yuboring; `message_thread_id` ni Bot API / log orqali oling va `.env` ga yozing.

## Buyruqlar

- `/start` — salom + kategoriya tugmalari
- `/news` — kategoriya tanlash
- Inline: kategoriya → yangilik; **Yana yangilik** → keyingisi

## Loyiha tuzilmasi

```
src/
  config.ts      # env (zod)
  db.ts          # SQLite schema + helperlar
  fetcher.ts     # RSS + dedupe
  ai.ts          # Gemini tarjima/xulosa
  publisher.ts   # Topic’larga post
  bot.ts         # Interactive mode
  index.ts       # Bot entry
  cron.ts        # Scheduler
  fetch-once.ts  # Bir martalik fetch
```

## Post formati

```
📌 Sarlavha (o‘zbekcha)

🔹 Xulosa 1
🔹 Xulosa 2
🔹 Xulosa 3

🏷 Kategoriya: #AI
🕐 28.07.2026, 15:30
🔗 https://...
```

## Manbalar

TechCrunch, The Verge, Wired, Hacker News, MIT Technology Review.
