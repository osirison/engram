import { Debouncer, type Scheduler } from './debounce';

/** Deterministic fake scheduler: timers fire only when `advance()` is called. */
class FakeScheduler implements Scheduler {
  private seq = 0;
  private readonly jobs = new Map<number, () => void>();

  set(fn: () => void): unknown {
    const id = (this.seq += 1);
    this.jobs.set(id, fn);
    return id;
  }
  clear(handle: unknown): void {
    this.jobs.delete(handle as number);
  }
  advance(): void {
    const pending = [...this.jobs.entries()];
    this.jobs.clear();
    for (const [, fn] of pending) fn();
  }
}

describe('Debouncer', () => {
  it('coalesces rapid triggers for the same key into one flush', () => {
    const scheduler = new FakeScheduler();
    const flushed: string[] = [];
    const d = new Debouncer<string>(1000, (k) => flushed.push(k), scheduler);

    d.trigger('a');
    d.trigger('a');
    d.trigger('a');
    expect(d.pending()).toBe(1);
    scheduler.advance();

    expect(flushed).toEqual(['a']);
    expect(d.pending()).toBe(0);
  });

  it('keeps distinct keys independent', () => {
    const scheduler = new FakeScheduler();
    const flushed: string[] = [];
    const d = new Debouncer<string>(1000, (k) => flushed.push(k), scheduler);

    d.trigger('a');
    d.trigger('b');
    expect(d.pending()).toBe(2);
    scheduler.advance();

    expect(flushed.sort()).toEqual(['a', 'b']);
  });

  it('clearAll cancels pending flushes', () => {
    const scheduler = new FakeScheduler();
    const flushed: string[] = [];
    const d = new Debouncer<string>(1000, (k) => flushed.push(k), scheduler);

    d.trigger('a');
    d.clearAll();
    scheduler.advance();

    expect(flushed).toEqual([]);
    expect(d.pending()).toBe(0);
  });
});
