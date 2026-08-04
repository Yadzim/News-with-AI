import cron, { type ScheduledTask } from "node-cron";
import { getTargetScheduleSettings, type ScheduleSettings } from "./db.js";
import { runGroupPipeline, runPublishChannel } from "./pipeline.js";

const TZ = "Asia/Tashkent";

let tasks: ScheduledTask[] = [];
let lastFingerprint = "";

export function parseHourMinute(
  value: string,
): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function scheduleFingerprint(): string {
  return JSON.stringify(getTargetScheduleSettings());
}

function stopTasks(): void {
  for (const task of tasks) task.stop();
  tasks = [];
}

/**
 * Har bir vaqt uchun alohida cron ishi. Vaqtlar soni ixtiyoriy —
 * kanalga kuniga 3 marta yuborish shu orqali sozlanadi.
 */
function registerSchedule(
  label: string,
  settings: ScheduleSettings,
  run: () => void,
): string {
  if (!settings.enabled) return `${label}: o‘chirilgan`;

  const registered: string[] = [];
  for (const time of settings.times) {
    const parsed = parseHourMinute(time);
    if (!parsed) continue;

    const expr = `${parsed.minute} ${parsed.hour} * * *`;
    if (!cron.validate(expr)) continue;

    tasks.push(cron.schedule(expr, run, { timezone: TZ }));
    registered.push(time);
  }

  if (registered.length === 0) return `${label}: noto‘g‘ri vaqt`;
  return `${label}: ${registered.join(", ")} (har safar ${settings.limit} ta)`;
}

export function applyScheduleFromDb(): { ok: boolean; message: string } {
  const settings = getTargetScheduleSettings();
  stopTasks();
  lastFingerprint = scheduleFingerprint();

  const parts = [
    registerSchedule("Guruh", settings.group, () => {
      void runGroupPipeline().catch((err) => {
        console.error("Guruh schedule xatosi:", err);
      });
    }),
    registerSchedule("Kanal", settings.channel, () => {
      void runPublishChannel().catch((err) => {
        console.error("Kanal schedule xatosi:", err);
      });
    }),
  ];

  return { ok: true, message: `${parts.join(" · ")} (${TZ})` };
}

export function startScheduleWatcher(intervalMs = 30_000): void {
  console.log(applyScheduleFromDb().message);

  setInterval(() => {
    if (scheduleFingerprint() !== lastFingerprint) {
      console.log(`Schedule yangilandi: ${applyScheduleFromDb().message}`);
    }
  }, intervalMs);
}
