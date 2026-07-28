import { runPipeline } from "./pipeline.js";

runPipeline()
  .then(({ fetched, published }) => {
    console.log(`Tayyor. Yangi: ${fetched}, post: ${published}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
