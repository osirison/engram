import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '@engram/database';
import type { SafeApiKey } from '@engram/database';

const KEY_PREFIX_LABEL = 'eng_';
const KEY_SECRET_BYTES = 24; // 24 bytes → 32 base64url chars

export interface CreateApiKeyInput {
  userId: string;
  name: string;
  scopes: string[];
  expiresInDays?: number;
}

export interface CreateApiKeyResult {
  key: SafeApiKey;
  /** Full raw key — shown once; not stored */
  rawKey: string;
}

function generateRawKey(): { rawKey: string; prefix: string; hash: string } {
  const secret = randomBytes(KEY_SECRET_BYTES).toString('base64url');
  const rawKey = `${KEY_PREFIX_LABEL}${secret}`;
  const prefix = rawKey.slice(0, KEY_PREFIX_LABEL.length + 8);
  const hash = createHash('sha256').update(rawKey).digest('hex');
  return { rawKey, prefix, hash };
}

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createApiKey(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
    const { rawKey, prefix, hash } = generateRawKey();

    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null;

    const record = await this.prisma.apiKey.create({
      data: {
        name: input.name,
        prefix,
        hash,
        userId: input.userId,
        scopes: input.scopes,
        expiresAt,
      },
      select: {
        id: true,
        name: true,
        prefix: true,
        userId: true,
        organizationId: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.logger.log(
      `Created API key "${input.name}" (prefix=${prefix}) for user ${input.userId}`,
    );

    return { key: record, rawKey };
  }

  async listApiKeys(userId: string): Promise<SafeApiKey[]> {
    return this.prisma.apiKey.findMany({
      where: { userId, revokedAt: null },
      select: {
        id: true,
        name: true,
        prefix: true,
        userId: true,
        organizationId: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeApiKey(
    userId: string,
    keyId: string,
  ): Promise<SafeApiKey | null> {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id: keyId, userId, revokedAt: null },
    });

    if (!existing) {
      return null;
    }

    const revoked = await this.prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
      select: {
        id: true,
        name: true,
        prefix: true,
        userId: true,
        organizationId: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    this.logger.log(
      `Revoked API key ${keyId} (prefix=${existing.prefix}) for user ${userId}`,
    );

    return revoked;
  }

  /** Verify a raw API key and return the matching record if valid (not revoked, not expired). */
  async verifyApiKey(rawKey: string): Promise<SafeApiKey | null> {
    if (!rawKey.startsWith(KEY_PREFIX_LABEL)) {
      return null;
    }

    const prefix = rawKey.slice(0, KEY_PREFIX_LABEL.length + 8);
    const hash = createHash('sha256').update(rawKey).digest('hex');

    const record = await this.prisma.apiKey.findFirst({
      where: { prefix, hash, revokedAt: null },
      select: {
        id: true,
        name: true,
        prefix: true,
        userId: true,
        organizationId: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!record) {
      return null;
    }

    if (record.expiresAt && record.expiresAt < new Date()) {
      return null;
    }

    // Fire-and-forget: update lastUsedAt without blocking the caller
    void this.prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to update lastUsedAt for key ${record.id}`,
          err,
        );
      });

    return record;
  }
}
