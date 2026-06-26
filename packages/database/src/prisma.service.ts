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
function resolveDeploymentProfile(): 'memory' | 'lite' | 'enterprise' {
  const raw = process.env['DEPLOYMENT_PROFILE'];
  if (raw === undefined || raw === null || raw === '') {
    return 'enterprise';
  }
  const value = String(raw).toLowerCase();
  if (value === 'memory' || value === 'lite' || value === 'enterprise') {
    return value;
  }
  return 'enterprise';
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
 *  - profile=memory: never attempts to connect. The client is built but
 *    no queries are made; calling a method without a backing store
 *    throws a clear runtime error.
 *  - profile=lite:    the client is built, and `$connect()` is invoked
 *    on first DB op (lazy). The profile expects Postgres to be
 *    reachable at runtime, so the constructor does not throw when
 *    `DATABASE_URL` is missing — it is validated lazily on first use.
 *  - profile=enterprise (default): eager `$connect()` so misconfigured
 *    deployments fail loudly at startup. This is the historical
 *    behavior.
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
      if (profile === 'memory') {
        // profile=memory: placeholder adapter. The in-memory LTM
        // adapter is the sanctioned path; we never call $connect()
        // in this mode, and any direct consumer call will throw a
        // clear error from `ensureConnected()`.
        return {
          connectionString: 'postgresql://invalid:invalid@127.0.0.1:65535/invalid',
        };
      }
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
    // Profile=enterprise expects eager connect; the flag is set
    // up-front so onModuleDestroy() can safely call $disconnect even
    // if onModuleInit() never ran (test harness pattern).
    if (profile === 'enterprise') {
      this.hasConnected = true;
    }
  }

  /**
   * Module init: connect eagerly on profile-enterprise, defer
   * everywhere else.
   */
  async onModuleInit(): Promise<void> {
    if (this.profile === 'enterprise') {
      await this.$connect();
      return;
    }
    logger.debug(
      `Profile=${this.profile}: skipping eager Prisma connect; will lazy-connect on first DB op`
    );
  }

  async onModuleDestroy(): Promise<void> {
    // Always disconnect for database-capable profiles; $disconnect() is
    // safe to call even when no connection was established (e.g. profile=lite
    // with lazy connect that never fired).
    if (this.profile !== 'memory') {
      await this.$disconnect();
    }
  }

  /**
   * Ensure the underlying client is connected before running a query.
   *
   * Public consumers that need DB access in profile=memory should
   * never call this — the in-memory LTM adapter is the sanctioned
   * path. profile=lite consumers should call `ensureConnected()` (or
   * `getLtmProvider()`) before issuing Prisma queries.
   */
  async ensureConnected(): Promise<void> {
    if (this.profile === 'enterprise' || this.hasConnected) {
      return;
    }
    if (this.profile === 'memory') {
      throw new Error(
        'PrismaService: profile=memory forbids Postgres access. ' +
          'Use the in-memory LTM adapter for memory storage in this profile.'
      );
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
