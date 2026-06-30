import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { SessionStore } from './session-store.js';

const SESSION_PREFIX = 'auth:session:';
const STATE_PREFIX = 'auth:oauthstate:';
const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const DEFAULT_STATE_TTL_SECONDS = 10 * 60; // 10 minutes
const ID_BYTES = 32;

export interface SessionData {
  userId: string;
  organizationId: string | null;
  email: string | null;
  scopes: string[];
  createdAt: number;
}

const sessionSchema = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().nullable(),
    email: z.string().nullable(),
    scopes: z.array(z.string()),
    createdAt: z.number().int(),
  })
  .strip();

/** Payload bound to an in-flight OAuth login, recovered on the callback. */
export interface OAuthStateData {
  provider: string;
  createdAt: number;
}

const stateSchema = z
  .object({
    provider: z.string().min(1),
    createdAt: z.number().int(),
  })
  .strip();

export interface SessionServiceOptions {
  sessionTtlSeconds?: number;
  stateTtlSeconds?: number;
}

function newId(): string {
  return randomBytes(ID_BYTES).toString('base64url');
}

/**
 * Manages interactive user sessions and one-time OAuth `state` tokens on top of
 * a {@link SessionStore}. Session ids and state tokens are 256-bit random,
 * base64url-encoded values.
 */
export class SessionService {
  private readonly sessionTtl: number;
  private readonly stateTtl: number;

  constructor(
    private readonly store: SessionStore,
    options: SessionServiceOptions = {}
  ) {
    this.sessionTtl = options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
    this.stateTtl = options.stateTtlSeconds ?? DEFAULT_STATE_TTL_SECONDS;
  }

  async createSession(
    data: Omit<SessionData, 'createdAt'>,
    createdAt: number = Math.floor(Date.now() / 1000)
  ): Promise<string> {
    const sessionId = newId();
    const payload: SessionData = { ...data, createdAt };
    await this.store.set(SESSION_PREFIX + sessionId, JSON.stringify(payload), this.sessionTtl);
    return sessionId;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    if (!sessionId) {
      return null;
    }
    const raw = await this.store.get(SESSION_PREFIX + sessionId);
    if (!raw) {
      return null;
    }
    const parsed = sessionSchema.safeParse(safeJsonParse(raw));
    return parsed.success ? parsed.data : null;
  }

  async destroySession(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }
    await this.store.delete(SESSION_PREFIX + sessionId);
  }

  /** Mint a one-time CSRF `state` token bound to the chosen provider. */
  async createOAuthState(
    provider: string,
    createdAt: number = Math.floor(Date.now() / 1000)
  ): Promise<string> {
    const state = newId();
    const payload: OAuthStateData = { provider, createdAt };
    await this.store.set(STATE_PREFIX + state, JSON.stringify(payload), this.stateTtl);
    return state;
  }

  /**
   * Consume an OAuth `state` token. Returns its payload and atomically removes
   * it so the callback cannot be replayed; returns null if unknown/expired.
   */
  async consumeOAuthState(state: string): Promise<OAuthStateData | null> {
    if (!state) {
      return null;
    }
    const raw = await this.store.getDelete(STATE_PREFIX + state);
    if (!raw) {
      return null;
    }
    const parsed = stateSchema.safeParse(safeJsonParse(raw));
    return parsed.success ? parsed.data : null;
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
