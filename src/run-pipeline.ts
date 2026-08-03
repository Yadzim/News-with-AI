import { runGroupPipeline } from "./pipeline.js";

runGroupPipeline()
  .then(({ fetched, published }) => {
    console.log(`Tayyor. Yangi: ${fetched}, post: ${published}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
