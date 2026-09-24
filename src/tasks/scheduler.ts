import type { DeviceGateway } from "../devices/types.js";
import type { TaskService } from "./service.js";

/** Max setTimeout delay (~24.8 days). Longer waits wake and re-check. */
const MAX_TIMER_MS = 2_147_483_647;

export interface TaskSchedulerOptions {
  tasks: TaskService;
  gateway: DeviceGateway;
  now?: () => Date;
  /** Optional hook for tests / logging */
  onExecuted?: (taskId: string) => void;
}

/**
 * Single in-process scheduler: setTimeout until next pending dueAt.
 * No busy loop. Call stop() on shutdown.
 */
export class TaskScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private ticking = false;
  private readonly now: () => Date;

  constructor(private readonly options: TaskSchedulerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.tick();
  }

  stop(): void {
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Reschedule after create/cancel. Safe to call anytime. */
  notify(): void {
    if (!this.started) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.armTimer();
  }

  /** Run due tasks now (also used on startup for overdue recovery). */
  async tick(): Promise<void> {
    if (!this.started || this.ticking) {
      this.armTimer();
      return;
    }
    this.ticking = true;
    try {
      const due = this.options.tasks.listPendingDue(this.now().toISOString());
      for (const task of due) {
        // Re-check: may have been canceled while earlier tasks ran.
        const current = this.options.tasks.get(task.id);
        if (!current || current.status !== "pending") continue;
        this.options.tasks.execute(task.id, this.options.gateway);
        this.options.onExecuted?.(task.id);
      }
    } finally {
      this.ticking = false;
      this.armTimer();
    }
  }

  private armTimer(): void {
    if (!this.started) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const next = this.options.tasks.getNextPending();
    if (!next) return;

    const delay = Math.max(
      0,
      new Date(next.dueAt).getTime() - this.now().getTime(),
    );
    const wait = Math.min(delay, MAX_TIMER_MS);

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, wait);

    // Don't keep the process alive solely for the timer in tests if unref'd —
    // production should keep the process alive. Use ref by default.
    if (typeof this.timer.unref === "function" && process.env.VITEST) {
      this.timer.unref();
    }
  }
}
