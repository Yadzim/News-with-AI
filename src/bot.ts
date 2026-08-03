import { Bot, InlineKeyboard, type Context } from "grammy";
import { config } from "./config.js";
import {
  getCategoryById,
  getCategoryByThreadId,
  getNewsByCategory,
  listActiveCategories,
  type CategoryRow,
} from "./db.js";
import { formatNewsMessage } from "./publisher.js";

export const bot = new Bot(config.telegramBotToken);

/** Kategoriyalar dinamik — klaviatura har safar DB dan quriladi */
function categoryKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (config.webappUrl) {
    keyboard.webApp("📱 Mini App — o‘qish", config.webappUrl).row();
  }

  const categories = listActiveCategories();
  for (const [i, category] of categories.entries()) {
    // callback_data 64 baytdan oshmasligi uchun nom emas, id ishlatiladi
    keyboard.text(category.name, `cat:${category.id}:0`);
    if (i % 2 === 1) keyboard.row();
  }
  if (categories.length % 2 === 1) keyboard.row();

  return keyboard;
}

function moreNewsKeyboard(
  category: CategoryRow,
  nextOffset: number,
): InlineKeyboard {
  return new InlineKeyboard()
    .text("Yana yangilik", `cat:${category.id}:${nextOffset}`)
    .row()
    .text("Kategoriyalar", "menu:categories");
}

/** Topic ichidan yozilganda message_thread_id → kategoriya */
function resolveTopicCategory(ctx: Context): CategoryRow | null {
  const threadId = ctx.message?.message_thread_id;
  if (threadId == null) return null;
  return getCategoryByThreadId(threadId) ?? null;
}

async function sendNewsByCategory(
  ctx: Context,
  category: CategoryRow,
  offset = 0,
): Promise<void> {
  const rows = getNewsByCategory(category.name, offset, 1);
  if (rows.length === 0) {
    await ctx.reply(
      offset === 0
        ? `"${category.name}" bo‘yicha hozircha yangilik yo‘q.`
        : `"${category.name}" bo‘yicha boshqa yangilik qolmadi.`,
      { reply_markup: categoryKeyboard() },
    );
    return;
  }

  await ctx.reply(formatNewsMessage(rows[0]!), {
    reply_markup: moreNewsKeyboard(category, offset + 1),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

async function sendWelcome(ctx: Context): Promise<void> {
  const category = resolveTopicCategory(ctx);
  if (category) {
    await ctx.reply(`Salom! Bu topic: ${category.name}. Eng so‘nggi yangilik:`);
    await sendNewsByCategory(ctx, category, 0);
    return;
  }

  if (listActiveCategories().length === 0) {
    await ctx.reply(
      "Salom! Hozircha kategoriyalar sozlanmagan. Admin panelda kategoriya qo‘shing.",
    );
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

bot.callbackQuery(/^cat:([0-9a-fA-F-]{36}):(\d+)$/, async (ctx) => {
  const category = getCategoryById(ctx.match[1]!);
  const offset = Number(ctx.match[2]);

  if (!category || !category.is_active) {
    await ctx.answerCallbackQuery({ text: "Bu kategoriya endi mavjud emas" });
    return;
  }

  await ctx.answerCallbackQuery();
  await sendNewsByCategory(ctx, category, offset);
});

bot.catch((err) => {
  console.error("Bot xatosi:", err.error);
});
