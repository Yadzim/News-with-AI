import { Bot } from "grammy";
import { config } from "./config.js";

/**
 * Post yuborish uchun bitta umumiy Bot instansiyasi.
 * `bot.ts` dagi instansiyadan alohida: bu yerda handlerlar yo‘q va
 * long polling ishga tushmaydi — faqat `api` chaqiruvlari.
 */
export const publisherBot = new Bot(config.telegramBotToken);
