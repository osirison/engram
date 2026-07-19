import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Resolve the active deployment profile from the environment.
 *
 * The Prisma service is intentionally a low-level module that does not
 * import `@engram/config` so the dependency graph stays one-way
 * (config → app → packages). Reading the env directly keeps the
 * service decoupled while still respecting the profile contract.
 */
function resolveDeploymentProfile(): 'lite' | 'standard' {
  const raw = process.env['DEPLOYMENT_PROFILE'];
  if (raw === undefined || raw === null || raw === '') {
    return 'standard';
  }
  const value = String(raw).toLowerCase();
  if (value === 'lite') {
    return value;
  }
  // 'enterprise' is the legacy alias for the default profile; anything else
  // falls back to standard (env validation rejects it upstream).
  return 'standard';
}

function getDatabaseUrl(): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };
  const databaseUrl = runtime.process?.env?.['DATABASE_URL'];
  return databaseUrl;
}

const logger = new Logger('PrismaService');

/**
 * Profile-aware Prisma client.
 *
 * Boot semantics:
 *  - profile=lite:     the client is built, and `$connect()` is invoked
 *    on first DB op (lazy). The profile expects Postgres to be
 *    reachable at runtime, so the constructor does not throw when
 *    `DATABASE_URL` is missing — it is validated lazily on first use.
 *  - profile=standard (default): eager `$connect()` so misconfigured
 *    deployments fail loudly at startup.
 *
 * The eager/lazy toggle is driven entirely by the `DEPLOYMENT_PROFILE`
 * env var so callers do not need to know about the toggle; the service
 * just does the right thing.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly profile: ReturnType<typeof resolveDeploymentProfile>;
  private connectPromise: Promise<void> | null = null;
  private hasConnected = false;

  constructor() {
    // Resolve everything BEFORE calling super() so we can pass the
    // right adapter to the base class. This avoids the "super must
    // be called before accessing this" TypeScript error.
    const profile = resolveDeploymentProfile();
    const databaseUrl = getDatabaseUrl();
    const adapterConfig = ((): { connectionString: string } => {
      if (!databaseUrl) {
        logger.warn(
          `Profile=${profile}: DATABASE_URL is not set. ` +
            'Queries will fail with a configuration error until it is provided.'
        );
        return {
          connectionString: 'postgresql://invalid:invalid@127.0.0.1:65535/invalid',
        };
      }
      return { connectionString: databaseUrl };
    })();

    super({
      adapter: new PrismaPg(adapterConfig) as PrismaPg,
    });

    this.profile = profile;
    // Profile=standard expects eager connect; the flag is set
    // up-front so onModuleDestroy() can safely call $disconnect even
    // if onModuleInit() never ran (test harness pattern).
    if (profile === 'standard') {
      this.hasConnected = true;
    }
  }

  /**
   * Module init: connect eagerly on profile-standard, defer on lite.
   */
  async onModuleInit(): Promise<void> {
    if (this.profile === 'standard') {
      await this.$connect();
      return;
    }
    logger.debug(
      `Profile=${this.profile}: skipping eager Prisma connect; will lazy-connect on first DB op`
    );
  }

  async onModuleDestroy(): Promise<void> {
    // $disconnect() is safe to call even when no connection was established
    // (e.g. profile=lite with lazy connect that never fired).
    await this.$disconnect();
  }

  /**
   * Optional pre-flight check: verifies DB connectivity before a batch
   * operation. In profile=lite Prisma lazy-connects on the first query, so
   * calling this is not required for correctness but lets callers fail-fast
   * before a long operation.
   */
  async ensureConnected(): Promise<void> {
    if (this.profile === 'standard' || this.hasConnected) {
      return;
    }
    if (!this.connectPromise) {
      this.connectPromise = this.$connect()
        .then(() => {
          this.hasConnected = true;
        })
        .catch((error: unknown) => {
          // Reset the cached promise so subsequent attempts can retry
          // (a transient failure should not permanently block the
          // application).
          this.connectPromise = null;
          throw error;
        });
    }
    await this.connectPromise;
  }
}
