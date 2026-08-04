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
- Har kategoriya uchun `message_thread_id` (topic ID) — keyinchalik admin
  panelidan ham qo‘shsa bo‘ladi
- Ovozli xabar (TTS) ishlatmoqchi bo‘lsangiz — `ffmpeg`

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

Ovozli xabar (TTS) ishlatmoqchi bo‘lsangiz `ffmpeg` ham kerak:

```bash
sudo apt install -y ffmpeg
ffmpeg -version
```

`ffmpeg` bo‘lmasa loyiha baribir ishlaydi — shunchaki postlarga audio
qo‘shilmaydi.

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

# Admin panel himoyasi — kamida bittasi majburiy
# Kalit yaratish: openssl rand -hex 32
ADMIN_TOKEN=bu_yerga_openssl_rand_hex_32_natijasi
# Mini App orqali kalitsiz kirish uchun (ixtiyoriy)
ADMIN_USER_IDS=123456789

# Ovozli xabar (ixtiyoriy)
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
TTS_VOICE=Kore

# HTTPS domen (oxirida / bo‘lishi mumkin)
WEBAPP_URL=https://news.example.com/
```

**Muhim:**

- `.env` da **qator ichida izoh yozmang**. systemd `EnvironmentFile` ni
  dotenv’dan boshqacha o‘qiydi va izohni qiymatga qo‘shib yuboradi:

  ```env
  ADMIN_TOKEN=abc123   # BUNDAY QILMANG — izoh kalitning bir qismi bo‘lib qoladi
  # Izohni alohida qatorga oling
  ADMIN_TOKEN=abc123
  ```

- `TELEGRAM_GROUP_ID` oldida `-` bo‘lishi shart (`-100...`)
- `ADMIN_TOKEN` **kamida 24 belgi** bo‘lishi kerak. `ADMIN_TOKEN` ham,
  `ADMIN_USER_IDS` ham bo‘sh bo‘lsa `news-admin` **ishga tushmaydi** —
  bu admin API ni ochiq internetda himoyasiz qoldirmaslik uchun.
- `WEBAPP_URL` HTTPS bo‘lishi kerak
- `TOPIC_*` faqat birinchi ishga tushirishda ishlatiladi; keyin kategoriyalar
  admin panelidan boshqariladi

```bash
npm ci
npm test
mkdir -p data
```

### Fayl egaligi

`news-admin` va `news-bot` `www-data` nomidan ishlaydi, shuning uchun baza va
audio katalogi shu foydalanuvchiga tegishli bo‘lishi kerak:

```bash
sudo mkdir -p /var/www/news-bot/data/audio
sudo chown -R www-data:www-data /var/www/news-bot/data
```

Deploy `git reset --hard` qilganda `data/` tegilmaydi (u `.gitignore` da).

---

## 3. Systemd bilan ishga tushirish

PM2 shart emas. Misol unit fayllar:

- [`news-bot.service.example`](./news-bot.service.example) → `npm run bot`
- [`news-admin.service.example`](./news-admin.service.example) → `npm run admin`

```bash
sudo cp deploy/news-bot.service.example /etc/systemd/system/news-bot.service
sudo cp deploy/news-admin.service.example /etc/systemd/system/news-admin.service

# User/path ni o‘z serveringizga moslang (nano bilan)
sudo nano /etc/systemd/system/news-bot.service
sudo nano /etc/systemd/system/news-admin.service

sudo systemctl daemon-reload
sudo systemctl enable --now news-bot news-admin
sudo systemctl status news-bot news-admin
```

Foydali buyruqlar:

```bash
sudo systemctl restart news-bot news-admin
sudo journalctl -u news-bot -f
sudo journalctl -u news-admin -f
```

> `news-admin` ichida schedule bor — alohida cron service ishlatmang.

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
3. Topic ID’larni admin panel → **Kategoriyalar** bo‘limida biriktiring
   (`.env` dagi `TOPIC_*` faqat birinchi ishga tushirishda ishlatiladi).
4. `@BotFather` → Bot Settings → **Menu Button** → URL: `https://news.example.com/`
5. `.env` da `WEBAPP_URL` shu URL bilan bir xil bo‘lsin.
6. Restart:

```bash
sudo systemctl restart news-bot news-admin
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
| Holat ko‘rish | `systemctl status` / `journalctl -u news-admin -f` |

Birinchi test tartibi:

1. Mini App → Sozlamalar → **Qayta olib kelish**
2. **Telegramga yuborish**
3. Guruh topic’larida post chiqishini tekshiring

---

## 7. Kodni yangilash

### Qo‘lda

```bash
cd /var/www/news-bot
./deploy.sh
```

Skript: `git pull` → (kerak bo‘lsa) `npm ci` → `systemctl restart` →
**health check**. `package-lock.json` o‘zgarmasa `npm ci` o‘tkazib yuboriladi.

Skript xizmatni ishga tushirgach uni kuzatadi: `NRestarts` o‘smaganini va
`is-active` bo‘lib turganini har 2 soniyada tekshiradi, admin uchun esa
`/api/health` javob berishini kutadi. Shuning uchun yiqilgan yoki crash-loopga
tushgan xizmat "OK" deb hisoblanmaydi. Xato bo‘lsa `journalctl` chiqishi
ko‘rsatiladi.

Sekin serverda `tsx` yuklanishi ~20 soniya olishi mumkin. Kutish vaqtlarini
o‘zgartirish kerak bo‘lsa:

```bash
STARTUP_GRACE_SECONDS=45 HEALTH_TIMEOUT_SECONDS=90 ./deploy.sh
```

### GitHub Actions (avto-deploy)

`.github/workflows/deploy.yml` — `main` ga push bo‘lganda SSH orqali:

`git pull` → `npm ci` → `systemctl restart`

Repo → **Settings → Secrets and variables → Actions**:

| Secret | Tavsif |
|--------|--------|
| `SSH_HOST` | Server IP yoki domen |
| `SSH_USER` | SSH foydalanuvchi |
| `SSH_KEY` | Private SSH key |
| `SSH_PORT` | Ixtiyoriy, default `22` |
| `SERVICE_BOT` | Ixtiyoriy, default `news-bot` |
| `SERVICE_ADMIN` | Ixtiyoriy, default `news-admin` |

SSH user `sudo systemctl` ni **parolsiz** qila olishi shart (`sudo -n`):

```bash
# YOUR_USER ni SSH user bilan almashtiring
echo 'YOUR_USER ALL=(ALL) NOPASSWD: /bin/systemctl' | sudo tee /etc/sudoers.d/news-deploy
sudo chmod 440 /etc/sudoers.d/news-deploy
```

Service fayllarda `TimeoutStopSec=10` va `KillMode=mixed` bo‘lsin — aks holda `systemctl restart` Actions’da osilib qoladi.
Misollar: `deploy/news-bot.service.example`, `deploy/news-admin.service.example`.

Yangilash:

```bash
sudo cp deploy/news-bot.service.example /etc/systemd/system/news-bot.service
sudo cp deploy/news-admin.service.example /etc/systemd/system/news-admin.service
# User/path ni moslang
sudo systemctl daemon-reload
```

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
| API `401 Unauthorized` | `journalctl -u news-admin -n 20` — endi aniq sabab yoziladi (token uzunligi mos emas / user ID ro‘yxatda yo‘q / initData yo‘q) |
| Kalit to‘g‘ri, lekin `401` | `.env` da qator ichida izoh qolmaganini tekshiring: `ADMIN_TOKEN=abc  # izoh`. systemd izohni qiymatga qo‘shib yuboradi — izohni **alohida qatorga** oling |
| Mini App'da user ID ishlamayapti | Jurnalda `user <ID> ro‘yxatda yo‘q` yozuvi haqiqiy ID ni ko‘rsatadi — `.env` dagi `ADMIN_USER_IDS` ga o‘shani yozing |
| Panel eski holatda qolgan | Telegram WebView keshi: nginx'ga `Cache-Control: no-cache` qo‘shing (`nginx.admin.conf.example`), Telegram'da botni yopib qayta oching |
| `news-admin` darhol o‘chadi | `.env` da `ADMIN_TOKEN` yo‘q yoki **24 belgidan qisqa** (jurnalda hozirgi uzunligi yoziladi). `openssl rand -hex 32` bilan yangisini yarating |
| Deploy "OK" deydi, lekin panel ishlamaydi | Xizmat crash-loopda: `systemctl show -p NRestarts --value news-admin` 0 dan katta. Sababi `journalctl -u news-admin -n 40` da |
| `NODE_MODULE_VERSION` mos emas | `node_modules` boshqa Node versiyasida o‘rnatilgan: `npm rebuild better-sqlite3` yoki `rm -rf node_modules && npm ci` |
| Postda audio yo‘q | `ffmpeg -version` ni tekshiring; admin panelda TTS yoqilganmi |
| `data/` ga yozib bo‘lmayapti | `sudo chown -R www-data:www-data /var/www/news-bot/data` |
| Gemini `429` | Free tier limiti; biroz kutib qayta urining |
| Gemini `404` model | `.env` da `GEMINI_MODEL=gemini-2.0-flash` yoki `gemini-3.1-flash-lite` |
| `better-sqlite3` build xato | `build-essential` o‘rnating, keyin `npm ci` |
| Post kelmaydi | Topic ID noto‘g‘ri; `journalctl -u news-admin -n 40` ni ko‘ring |
| Ikki marta post | Ikki marta `news-admin` / schedule ishlayotganini tekshiring |

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
