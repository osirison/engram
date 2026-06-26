import { Module, type DynamicModule, type Provider, Logger } from '@nestjs/common';
import { LiteJsonStore, LITE_STORE_TOKEN, getLiteStore } from './lite-store';
import {
  assertSecureStartup,
  resolveSecureStartupOptions,
  type SecureStartupOptions,
} from './secure-startup';

/**
 * Profile-lite storage module.
 *
 * Resolves the secure startup options from the environment, runs the
 * permission + key checks, then binds a singleton {@link LiteJsonStore}
 * to the {@link LITE_STORE_TOKEN} injection key.
 *
 * Consumers that want to compose the module with their own options
 * (tests, scripts) can use {@link MemoryLiteModule.forRoot}.
 */
@Module({})
export class MemoryLiteModule {
  private static readonly logger = new Logger(MemoryLiteModule.name);

  /**
   * Profile-lite module factory.
   *
   * When `options` is omitted the module reads `LOCAL_DATA_DIR` and
   * `LOCAL_ENCRYPTION_KEY` from the environment and runs the secure
   * startup checks before binding the store.
   */
  static forRoot(options?: SecureStartupOptions): DynamicModule {
    const resolved = options ?? resolveSecureStartupOptions();
    return {
      module: MemoryLiteModule,
      global: true,
      providers: [
        {
          provide: LITE_STORE_TOKEN,
          useFactory: async (): Promise<LiteJsonStore> => {
            await assertSecureStartup(resolved);
            return getLiteStore(resolved.dataDir, resolved.encryptionKey);
          },
        },
        {
          provide: LiteJsonStore,
          inject: [LITE_STORE_TOKEN],
          useFactory: (store: LiteJsonStore) => store,
        },
        {
          provide: 'MEMORY_LITE_OPTIONS',
          useValue: resolved,
        },
      ] satisfies Provider[],
      exports: [LITE_STORE_TOKEN, LiteJsonStore, 'MEMORY_LITE_OPTIONS'],
    };
  }

  /**
   * Run only the secure-startup checks (no Nest DI required).
   *
   * Useful from `main.ts` so the process can fail-fast before booting
   * Nest when permissions or key material are wrong.
   */
  static async runSecureStartup(options?: SecureStartupOptions): Promise<SecureStartupOptions> {
    const resolved = await assertSecureStartup(options);
    MemoryLiteModule.logger.log(`MemoryLite secure startup OK at ${resolved.dataDir}`);
    return resolved;
  }
}
