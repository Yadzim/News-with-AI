# Logo va rasmlar

Bu papkadagi fayllar saytda `/images/<nom>` manzilida ochiladi.

## Asl fayllar (manba)

| Fayl                  | O‘lcham   | Izoh                              |
| --------------------- | --------- | --------------------------------- |
| `news-logo-main.png`  | 600×600   | Asosiy logo, shaffof burchakli    |
| `news-logo.png`       | 1254×1254 | Keng variant, oq fon              |
| `news-logo.svg`       | 600×600   | SVG konteyner ichida rastr        |

> `news-logo.svg` haqiqiy vektor emas — ichida PNG bor (566 KB). Shuning
> uchun saytda ishlatilmaydi, PNG dan kichraytirilgan variant afzal.

## Saytda ishlatiladiganlar

Bular `news-logo-main.png` dan yaratilgan:

| Fayl                    | Qayerda                        |
| ----------------------- | ------------------------------ |
| `logo-128.png`          | Sayt sarlavhasidagi belgi      |
| `favicon-32.png`        | Brauzer yorlig‘i               |
| `apple-touch-icon.png`  | iOS bosh ekrani (oq fon bilan) |

Asl 600×600 fayl 303 KB — sarlavhada 36 px da ko‘rinadi, shuning uchun
kichraytirilgan 13 KB lik nusxa ishlatiladi.

## Logoni almashtirish

`news-logo-main.png` ni yangisiga almashtiring va quyidagini ishlating:

```bash
pip install Pillow
python3 - <<'PY'
from PIL import Image
src = Image.open("public/images/news-logo-main.png").convert("RGBA")
def save(size, name, bg=None):
    im = src.resize((size, size), Image.LANCZOS)
    if bg:
        flat = Image.new("RGB", (size, size), bg)
        flat.paste(im, mask=im.split()[3])
        im = flat
    im.save(f"public/images/{name}", optimize=True)
save(128, "logo-128.png")
save(32, "favicon-32.png")
save(180, "apple-touch-icon.png", (248, 249, 251))
PY
```

Logo yuklanmasa sayt buzilmaydi — o‘rniga `◈` belgisi ko‘rinadi.
