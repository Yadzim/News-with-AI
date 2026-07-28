import { bot } from "./bot.js";
import { config } from "./config.js";
import "./db.js";

async function main() {
  console.log("Telegram bot ishga tushmoqda...");

  if (config.webappUrl) {
    await bot.api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "Yangiliklar",
        web_app: { url: config.webappUrl },
      },
    });
    console.log(`Mini App menu: ${config.webappUrl}`);
  }

  await bot.start({
    onStart: (info) => {
      console.log(`Bot @${info.username} tayyor.`);
    },
  });
}

main().catch((err) => {
  console.error("Bot ishga tushmadi:", err);
  process.exit(1);
});
