import cron from "node-cron";
import { runSchedulerTick } from "../services/schedulerService";

/**
 * Runs every minute. Database idempotency keys prevent duplicate activities across
 * repeated ticks or multiple server processes. The in-process `running` guard only
 * avoids piling up work when a tick lasts longer than a minute.
 */
export function startSchedulerJob(): void {
  let running = false;

  cron.schedule("* * * * *", async () => {
    if (running) return;
    running = true;
    try {
      await runSchedulerTick();
    } catch (err) {
      console.error("Scheduler tick failed:", err);
    } finally {
      running = false;
    }
  });
}
