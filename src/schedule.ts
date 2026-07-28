import cron, { type ScheduledTask } from "node-cron";
import { getScheduleSettings } from "./db.js";
import { runPipeline } from "./pipeline.js";

const TZ = "Asia/Tashkent";

let tasks: ScheduledTask[] = [];
let lastFingerprint = "";

function parseHourMinute(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function buildCronExpression(morning: string, evening: string): string | null {
  const a = parseHourMinute(morning);
  const b = parseHourMinute(evening);
  if (!a || !b) return null;

  const hours = [...new Set([a.hour, b.hour])].sort((x, y) => x - y);
  // Agar daqiqalar farq qilsa — ikkita alohida ifoda kerak
  if (a.minute === b.minute) {
    return `${a.minute} ${hours.join(",")} * * *`;
  }
  return null;
}

export function scheduleFingerprint(): string {
  const s = getScheduleSettings();
  return `${s.enabled}|${s.morning}|${s.evening}`;
}

function stopTasks(): void {
  for (const task of tasks) {
    task.stop();
  }
  tasks = [];
}

export function applyScheduleFromDb(): { ok: boolean; message: string } {
  const settings = getScheduleSettings();
  stopTasks();
  lastFingerprint = scheduleFingerprint();

  if (!settings.enabled) {
    return { ok: true, message: "Avto-yuborish o‘chirilgan" };
  }

  const a = parseHourMinute(settings.morning);
  const b = parseHourMinute(settings.evening);
  if (!a || !b) {
    return { ok: false, message: "Noto‘g‘ri vaqt formati (HH:MM)" };
  }

  const run = () => {
    void runPipeline().catch((err) => {
      console.error("Schedule pipeline xatosi:", err);
    });
  };

  if (a.minute === b.minute) {
    const expr = `${a.minute} ${[...new Set([a.hour, b.hour])].sort((x, y) => x - y).join(",")} * * *`;
    if (!cron.validate(expr)) {
      return { ok: false, message: `Noto‘g‘ri cron: ${expr}` };
    }
    tasks.push(cron.schedule(expr, run, { timezone: TZ }));
    return {
      ok: true,
      message: `Reja: har kuni ${settings.morning} va ${settings.evening} (${TZ})`,
    };
  }

  const exprA = `${a.minute} ${a.hour} * * *`;
  const exprB = `${b.minute} ${b.hour} * * *`;
  if (!cron.validate(exprA) || !cron.validate(exprB)) {
    return { ok: false, message: "Noto‘g‘ri cron ifodalar" };
  }
  tasks.push(cron.schedule(exprA, run, { timezone: TZ }));
  tasks.push(cron.schedule(exprB, run, { timezone: TZ }));
  return {
    ok: true,
    message: `Reja: har kuni ${settings.morning} va ${settings.evening} (${TZ})`,
  };
}

/** DB o‘zgarsa cron’ni qayta yuklaydi */
export function startScheduleWatcher(intervalMs = 30_000): void {
  const applied = applyScheduleFromDb();
  console.log(applied.message);

  setInterval(() => {
    const next = scheduleFingerprint();
    if (next !== lastFingerprint) {
      const result = applyScheduleFromDb();
      console.log(`Schedule yangilandi: ${result.message}`);
    }
  }, intervalMs);
}

export { parseHourMinute };
