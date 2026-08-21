# Logo va rasmlar

Bu papkaga qo‘yilgan fayllar saytda `/images/<nom>` manzilida ochiladi.

## Logo

Sayt sarlavhasidagi belgi `logo.svg` ni ishlatadi:

```
public/images/logo.svg
```

Fayl bo‘lmasa sayt buzilmaydi — o‘rniga standart `◈` belgisi ko‘rinadi.

Tavsiyalar:

- **SVG** afzal — har qanday ekranda tiniq chiqadi va hajmi kichik
- Kvadrat nisbat (1:1), ichida bo‘sh joy qoldirmang — sayt o‘zi 36×36 px
  yumaloq ramka ichiga joylashtiradi
- Yorug‘ va qorong‘i mavzuda ham ko‘rinadigan rang tanlang, yoki
  `currentColor` ishlating

## Favicon

Brauzer yorlig‘i uchun:

```
public/images/favicon.svg          # asosiy
public/images/favicon-180.png      # iOS uchun, 180×180
```

Bular ham ixtiyoriy — bo‘lmasa brauzer standart belgini ko‘rsatadi.
