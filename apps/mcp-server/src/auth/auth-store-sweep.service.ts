import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { PostgresSessionStore } from './postgres-session.store';
import { PostgresRateLimitStore } from './postgres-rate-limit.store';

const DEFAULT_INTERVAL_MS = 900_000; // 15 minutes

/**
 * Periodic hygiene job that bulk-deletes expired auth KV entries (sessions,
 * OAuth state, jti denylist) and lapsed rate-limit counters.
 *
 * Correctness never depends on this — every read filters on expiry and the
 * one-time-state delete carries its own expiry predicate. Interval via
 * `AUTH_STORE_SWEEP_INTERVAL_MS` (default 15 minutes; 0 disables).
 */
@Injectable()
export class AuthStoreSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthStoreSweepService.name);
  private readonly intervalMs: number;
  private handle?: NodeJS.Timeout;

  constructor(
    @Optional() private readonly sessionStore?: PostgresSessionStore,
    @Optional() private readonly rateLimitStore?: PostgresRateLimitStore,
  ) {
    const parsed = Number(
      process.env.AUTH_STORE_SWEEP_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
    );
    this.intervalMs =
      Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_INTERVAL_MS;
  }

  onModuleInit(): void {
    if (this.intervalMs <= 0) {
      this.logger.log(
        'Auth store sweep disabled (AUTH_STORE_SWEEP_INTERVAL_MS=0)',
      );
      return;
    }
    if (!this.sessionStore && !this.rateLimitStore) {
      return;
    }
    this.handle = setInterval(() => {
      void this.run().catch((error: unknown) =>
        this.logger.error('Scheduled auth store sweep failed:', error),
      );
    }, this.intervalMs);
    this.handle.unref?.();
  }

  onModuleDestroy(): void {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = undefined;
    }
  }

  async run(): Promise<number> {
    let swept = 0;
    if (this.sessionStore) {
      swept += await this.sessionStore.sweepExpired();
    }
    if (this.rateLimitStore) {
      swept += await this.rateLimitStore.sweepExpired();
    }
    if (swept > 0) {
      this.logger.debug(`Swept ${swept} expired auth store rows`);
    }
    return swept;
  }
}
