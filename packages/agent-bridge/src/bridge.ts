import { EngramClient } from '@engram/client';

import type { BridgeConfig } from './types.js';

/** Rejected by `withDeadline` when an operation exceeds its time budget. */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`operation timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Race a promise against a deadline. A dead or slow server must never add more
 * than `ms` of latency to an agent hook (D5); the underlying request is abandoned
 * when the caller closes the client in its `finally`.
 */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    );
  });
}

/** Factory type so commands can be tested with an injected (in-memory) client. */
export type ClientFactory = () => EngramClient;

/** Build the real HTTP EngramClient from config. */
export function createEngramClient(config: BridgeConfig): EngramClient {
  return new EngramClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
}
