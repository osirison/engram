import {
  Module,
  type DynamicModule,
  type Provider,
  type Type,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { resolve } from 'node:path';
import {
  DeploymentProfile,
  coerceDeploymentProfile,
  resolveCapabilities,
  validateEnv,
  type ProfileCapabilities,
} from '@engram/config';
import { LoggingModule, McpModule } from '@engram/core';
import { PrismaModule } from '@engram/database';
import { RedisModule } from '@engram/redis';
import { QdrantModule } from '@engram/vector-store';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { HealthModule } from './health/health.module';
import { MemoryModule } from './memory/memory.module';

const runValidateEnv = validateEnv as (
  config: Record<string, unknown>,
) => Record<string, unknown>;

const envFileCandidates = [
  resolve(__dirname, '../../../.env'),
  resolve(process.cwd(), '.env'),
];

/**
 * Resolve the active profile from a host process.
 *
 * Reads `DEPLOYMENT_PROFILE` directly from `process.env` so that the module
 * factory can resolve the profile even when no host application has wired
 * configuration yet.
 */
function resolveActiveProfile(): DeploymentProfile {
  return coerceDeploymentProfile(process.env.DEPLOYMENT_PROFILE);
}

/**
 * Token used to expose {@link ProfileCapabilities} to any consumer that needs
 * to know what dependencies the active profile requires (controllers, health
 * indicators, MCP tool registries, etc.).
 */
export const PROFILE_CAPABILITIES = Symbol.for('engram.profile-capabilities');

/**
 * Build the list of NestJS modules to import based on the active profile.
 *
 * Modules are conditionally included so that {@link NestFactory.create} never
 * tries to instantiate providers whose dependencies are unavailable in the
 * current profile (e.g. Prisma in profile-memory).
 */
function buildImportsForProfile(
  capabilities: ProfileCapabilities,
): Array<Type<unknown> | DynamicModule> {
  const imports: Array<Type<unknown> | DynamicModule> = [
    LoggingModule,
    McpModule,
    ApiKeysModule,
    HealthModule.forRoot(capabilities),
    MemoryModule,
  ];

  if (capabilities.requiresDatabase) {
    imports.push(PrismaModule);
  }
  if (capabilities.requiresRedis) {
    imports.push(RedisModule);
  }
  if (capabilities.requiresQdrant) {
    imports.push(QdrantModule);
  }

  return imports;
}

@Module({})
export class AppModule {
  /**
   * Profile-aware module factory.
   *
   * Pass an explicit {@link DeploymentProfile} to override `DEPLOYMENT_PROFILE`
   * (useful for tests). When omitted, the value from `process.env` is used.
   */
  static forRoot(profile?: DeploymentProfile): DynamicModule {
    const activeProfile = profile ?? resolveActiveProfile();
    const capabilities = resolveCapabilities(activeProfile);

    const imports: Array<DynamicModule | Type<unknown>> = [
      ConfigModule.forRoot({
        validate: (config: Record<string, unknown>): Record<string, unknown> =>
          runValidateEnv(config),
        isGlobal: true,
        envFilePath: envFileCandidates,
      }) as unknown as DynamicModule,
      ...buildImportsForProfile(capabilities),
    ];

    const providers: Provider[] = [
      AppService,
      {
        provide: PROFILE_CAPABILITIES,
        useValue: capabilities,
      },
      {
        provide: 'ENGRAM_PROFILE',
        useValue: activeProfile,
      },
    ];

    return {
      module: AppModule,
      global: true,
      imports,
      controllers: [AppController],
      providers,
      exports: [PROFILE_CAPABILITIES, 'ENGRAM_PROFILE'],
    };
  }
}
