import cron, { type ScheduledTask } from "node-cron";
import { getTargetScheduleSettings, type ScheduleSettings } from "./db.js";
import { runGroupPipeline, runPublishChannel } from "./pipeline.js";

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

export function scheduleFingerprint(): string {
  const s = getTargetScheduleSettings();
  return JSON.stringify(s);
}

function stopTasks(): void {
  for (const task of tasks) {
    task.stop();
  }
  tasks = [];
}

function registerSchedule(
  label: string,
  settings: ScheduleSettings,
  run: () => void,
): string[] {
  const messages: string[] = [];

  if (!settings.enabled) {
    messages.push(`${label}: o‘chirilgan`);
    return messages;
  }

  const a = parseHourMinute(settings.morning);
  const b = parseHourMinute(settings.evening);
  if (!a || !b) {
    messages.push(`${label}: noto‘g‘ri vaqt`);
    return messages;
  }

  if (a.minute === b.minute) {
    const expr = `${a.minute} ${[...new Set([a.hour, b.hour])].sort((x, y) => x - y).join(",")} * * *`;
    if (!cron.validate(expr)) {
      messages.push(`${label}: noto‘g‘ri cron ${expr}`);
      return messages;
    }
    tasks.push(cron.schedule(expr, run, { timezone: TZ }));
    messages.push(`${label}: ${settings.morning}, ${settings.evening}`);
    return messages;
  }

  const exprA = `${a.minute} ${a.hour} * * *`;
  const exprB = `${b.minute} ${b.hour} * * *`;
  if (!cron.validate(exprA) || !cron.validate(exprB)) {
    messages.push(`${label}: noto‘g‘ri cron`);
    return messages;
  }
  tasks.push(cron.schedule(exprA, run, { timezone: TZ }));
  tasks.push(cron.schedule(exprB, run, { timezone: TZ }));
  messages.push(`${label}: ${settings.morning}, ${settings.evening}`);
  return messages;
}

export function applyScheduleFromDb(): { ok: boolean; message: string } {
  const settings = getTargetScheduleSettings();
  stopTasks();
  lastFingerprint = scheduleFingerprint();

  const parts: string[] = [];

  parts.push(
    ...registerSchedule("Guruh", settings.group, () => {
      void runGroupPipeline().catch((err) => {
        console.error("Guruh schedule xatosi:", err);
      });
    }),
  );

  parts.push(
    ...registerSchedule("Kanal", settings.channel, () => {
      void runPublishChannel().catch((err) => {
        console.error("Kanal schedule xatosi:", err);
      });
    }),
  );

  return {
    ok: true,
    message: `${parts.join(" · ")} (${TZ})`,
  };
}

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
