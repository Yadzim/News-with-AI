# Serverga o‘rnatish (Ubuntu/Debian)

AI News Aggregator: Telegram bot + Admin/Mini App + avto-post.

Serverda asosan **2 ta jarayon** ishlaydi:

- `news-bot` — Telegram bot (long polling)
- `news-admin` — Mini App API + schedule (ertalab/kechqurun)

> `npm run cron` ni `news-admin` bilan birga ishlatmang — ikki marta post ketadi.

---

## 0. Talablar

- Ubuntu 22.04+ (yoki shunga o‘xshash)
- `sudo` huquqi
- Domen (Telegram Mini App uchun **HTTPS** majburiy)
- Gemini API key
- Telegram bot token
- Forum guruh ID (`-100...`, minus bilan)
- Har kategoriya uchun `message_thread_id` (topic ID)

---

## 1. Asosiy paketlar

```bash
sudo apt update
sudo apt install -y git curl nginx build-essential python3

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

node -v
npm -v
```

`better-sqlite3` native build uchun `build-essential` kerak.

---

## 2. Loyihani yuklash

```bash
sudo mkdir -p /var/www
cd /var/www
sudo git clone https://github.com/Yadzim/news.git news-bot
sudo chown -R $USER:$USER /var/www/news-bot
cd /var/www/news-bot

cp .env.example .env
nano .env
```

### `.env` namunasi

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.1-flash-lite

TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_GROUP_ID=-100XXXXXXXXXX

TOPIC_AI=1
TOPIC_HARDWARE=2
TOPIC_CYBERSECURITY=3
TOPIC_STARTUPS=4
TOPIC_GENERAL_TECH=5

DATABASE_PATH=./data/news.db
PORT=8787
ADMIN_TOKEN=kuchli_parol_bu_yerda

# HTTPS domen (oxirida / bo‘lishi mumkin)
WEBAPP_URL=https://news.example.com/
```

**Muhim:**

- `TELEGRAM_GROUP_ID` oldida `-` bo‘lishi shart (`-100...`)
- `ADMIN_TOKEN` ni bo‘sh qoldirmang (ochiq internetda)
- `WEBAPP_URL` HTTPS bo‘lishi kerak

```bash
npm ci
mkdir -p data
```

---

## 3. PM2 bilan ishga tushirish

```bash
sudo npm i -g pm2

pm2 start "npx tsx src/index.ts" --name news-bot --cwd /var/www/news-bot
pm2 start "npx tsx src/server.ts" --name news-admin --cwd /var/www/news-bot

pm2 save
pm2 startup
# chiqqan buyruqni nusxa ko‘chirib ishga tushiring

pm2 status
pm2 logs news-bot
pm2 logs news-admin
```

Foydali buyruqlar:

```bash
pm2 restart news-bot news-admin
pm2 stop news-bot news-admin
pm2 delete news-bot news-admin
```

---

## 4. Nginx

Misol fayl: [`nginx.admin.conf.example`](./nginx.admin.conf.example)

```bash
sudo nano /etc/nginx/sites-available/news-bot
```

```nginx
server {
    listen 80;
    server_name news.example.com;

    root /var/www/news-bot/public;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/news-bot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### SSL (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d news.example.com
```

Tekshiruv: brauzerda `https://news.example.com/` ochilsin.

---

## 5. Telegram sozlash

1. Botni guruhga qo‘shing va **admin** qiling.
2. Guruhda **Topics (Forum)** yoqilgan bo‘lsin.
3. Topic ID’larni `.env` dagi `TOPIC_*` ga yozing.
4. `@BotFather` → Bot Settings → **Menu Button** → URL: `https://news.example.com/`
5. `.env` da `WEBAPP_URL` shu URL bilan bir xil bo‘lsin.
6. Restart:

```bash
pm2 restart news-bot news-admin
```

Botga `/start` yuboring — **Mini App — o‘qish** tugmasi chiqishi kerak.

### Topic ID olish

1. Topic’ga test xabar yozing.
2. Bot polling to‘xtatilgan holda:

```text
https://api.telegram.org/bot<TOKEN>/getUpdates
```

3. Javobdan `message_thread_id` ni oling.

---

## 6. Kundalik ishlatish

| Vazifa | Qayerda |
|--------|---------|
| Yangilik o‘qish | Mini App / brauzer |
| RSS + AI yig‘ish | Sozlamalar → **Qayta olib kelish** |
| Qo‘lda Telegramga post | Sozlamalar → **Telegramga yuborish** |
| Avto-post vaqti | Sozlamalar → ertalab / kechqurun |
| Holat ko‘rish | `pm2 status` / `pm2 logs` |

Birinchi test tartibi:

1. Mini App → Sozlamalar → **Qayta olib kelish**
2. **Telegramga yuborish**
3. Guruh topic’larida post chiqishini tekshiring

---

## 7. Kodni yangilash

### Qo‘lda

```bash
cd /var/www/news-bot
git pull
npm ci
pm2 restart news-bot news-admin
```

`.env` o‘zgarmagan bo‘lsa, qayta yozish shart emas.

### GitHub Actions (avto-deploy)

`.github/workflows/deploy.yml` — `main` ga push bo‘lganda SSH orqali yangilanadi.

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Tavsif |
|--------|--------|
| `SSH_HOST` | Server IP yoki domen |
| `SSH_USER` | SSH foydalanuvchi (masalan `ubuntu`) |
| `SSH_KEY` | Private SSH key (to‘liq PEM) |
| `SSH_PORT` | Ixtiyoriy, default `22` |

Workflow ichida `request_pty: true` yoqilgan (ba’zi serverlarda PM2/TTY uchun kerak).

---

## 8. Firewall (ixtiyoriy)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

## Muammolar

| Xato / holat | Yechim |
|--------------|--------|
| `chat not found` | `TELEGRAM_GROUP_ID=-100...`; bot guruhda admin; kerak bo‘lsa botni chiqarib qayta qo‘shing |
| Mini App ochilmaydi | HTTPS, to‘g‘ri `WEBAPP_URL`, BotFather Menu Button |
| API `401 Unauthorized` | Sozlamalarda `ADMIN_TOKEN` ni kiriting |
| Gemini `429` | Free tier limiti; biroz kutib qayta urining |
| Gemini `404` model | `.env` da `GEMINI_MODEL=gemini-2.0-flash` yoki `gemini-3.1-flash-lite` |
| `better-sqlite3` build xato | `build-essential` o‘rnating, keyin `npm ci` |
| Post kelmaydi | Topic ID noto‘g‘ri; `pm2 logs news-admin` ni ko‘ring |
| Ikki marta post | GitHub Actions cron **va** server `news-admin` birgalikda ishlayotgan — bittasini o‘chiring |

---

## Arxitektura (qisqa)

```text
RSS → Gemini → SQLite (data/news.db)
                ↓
         Telegram Topics
                ↑
     Mini App (nginx) → /api → news-admin:8787
Telegram Bot ←──────────── news-bot (long polling)
```

- Static UI: `/var/www/news-bot/public`
- API: `127.0.0.1:8787`
- DB: `/var/www/news-bot/data/news.db`
