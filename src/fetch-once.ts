import "./db.js";
import { fetchAndProcessNews } from "./fetcher.js";

async function main() {
  const added = await fetchAndProcessNews({ maxPerFeed: 2 });
  console.log(`Tayyor. Yangi: ${added}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
