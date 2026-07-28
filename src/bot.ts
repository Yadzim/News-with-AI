import { Bot, InlineKeyboard, type Context } from "grammy";
import { CATEGORIES, config, type Category } from "./config.js";
import { getCategoryByThreadId, getNewsByCategory } from "./db.js";
import { formatNewsMessage } from "./publisher.js";

export const bot = new Bot(config.telegramBotToken);

function categoryKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (config.webappUrl) {
    keyboard.webApp("📱 Mini App — o‘qish", config.webappUrl).row();
  }
  for (const [i, category] of CATEGORIES.entries()) {
    keyboard.text(category, `cat:${category}:0`);
    if (i % 2 === 1) keyboard.row();
  }
  if (CATEGORIES.length % 2 === 1) keyboard.row();
  return keyboard;
}

function moreNewsKeyboard(category: Category, nextOffset: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yana yangilik", `cat:${category}:${nextOffset}`)
    .row()
    .text("Kategoriyalar", "menu:categories");
}

/** Topic ichidan yozilganda message_thread_id → kategoriya */
function resolveTopicCategory(ctx: Context): Category | null {
  const threadId = ctx.message?.message_thread_id;
  if (threadId == null) return null;
  return getCategoryByThreadId(threadId);
}

async function sendNewsByCategory(
  ctx: Context,
  category: Category,
  offset = 0,
): Promise<void> {
  const rows = getNewsByCategory(category, offset, 1);
  if (rows.length === 0) {
    await ctx.reply(
      offset === 0
        ? `"${category}" bo‘yicha hozircha yangilik yo‘q.`
        : `"${category}" bo‘yicha boshqa yangilik qolmadi.`,
      { reply_markup: categoryKeyboard() },
    );
    return;
  }

  const news = rows[0]!;
  await ctx.reply(formatNewsMessage(news), {
    reply_markup: moreNewsKeyboard(category, offset + 1),
    link_preview_options: { is_disabled: true },
  });
}

async function sendWelcome(ctx: Context) {
  const category = resolveTopicCategory(ctx);
  if (category) {
    await ctx.reply(
      `Salom! Bu topic: ${category}. Eng so‘nggi yangilik:`,
    );
    await sendNewsByCategory(ctx, category, 0);
    return;
  }

  await ctx.reply(
    "Salom! Men AI News Aggregator botiman.\n\nTexnologik yangiliklarni o‘zbek tilida o‘qing. Kategoriyani tanlang:",
    { reply_markup: categoryKeyboard() },
  );
}

bot.command("start", async (ctx) => {
  await sendWelcome(ctx);
});

bot.command("news", async (ctx) => {
  const category = resolveTopicCategory(ctx);
  if (category) {
    await sendNewsByCategory(ctx, category, 0);
    return;
  }

  await ctx.reply("Qaysi kategoriyadagi yangiliklarni ko‘rmoqchisiz?", {
    reply_markup: categoryKeyboard(),
  });
});

bot.callbackQuery("menu:categories", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Kategoriyani tanlang:", {
    reply_markup: categoryKeyboard(),
  });
});

bot.callbackQuery(/^cat:(.+):(\d+)$/, async (ctx) => {
  const category = ctx.match[1] as Category;
  const offset = Number(ctx.match[2]);

  if (!(CATEGORIES as readonly string[]).includes(category)) {
    await ctx.answerCallbackQuery({ text: "Noma’lum kategoriya" });
    return;
  }

  await ctx.answerCallbackQuery();
  await sendNewsByCategory(ctx, category, offset);
});

bot.catch((err) => {
  console.error("Bot xatosi:", err.error);
});
