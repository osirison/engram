/** Injectable timer surface so the debouncer can be tested with a fake clock. */
export interface Scheduler {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Coalesce rapid keyed events. Editors write files in bursts (temp file + rename,
 * multiple saves); the watcher debounces per key so one import runs after the
 * writes settle instead of one per raw filesystem event.
 */
export class Debouncer<K> {
  private readonly timers = new Map<K, unknown>();

  constructor(
    private readonly delayMs: number,
    private readonly onFlush: (key: K) => void,
    private readonly scheduler: Scheduler = realScheduler,
  ) {}

  trigger(key: K): void {
    const existing = this.timers.get(key);
    if (existing !== undefined) this.scheduler.clear(existing);
    this.timers.set(
      key,
      this.scheduler.set(() => {
        this.timers.delete(key);
        this.onFlush(key);
      }, this.delayMs),
    );
  }

  pending(): number {
    return this.timers.size;
  }

  clearAll(): void {
    for (const handle of this.timers.values()) this.scheduler.clear(handle);
    this.timers.clear();
  }
}
