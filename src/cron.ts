import { startScheduleWatcher } from "./schedule.js";

console.log("Cron scheduler (DB schedule) ishga tushdi...");
startScheduleWatcher();

if (process.argv.includes("--now")) {
  import("./pipeline.js")
    .then(({ runGroupPipeline }) => runGroupPipeline())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
