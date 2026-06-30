/**
 * Key/value store backing sessions and one-time OAuth state.
 *
 * The package defines only the interface; the host application provides a
 * concrete implementation (Redis in enterprise). Unit tests use an in-memory
 * fake. Every write carries an explicit TTL so entries cannot leak.
 */
export interface SessionStore {
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  /**
   * Atomically read a key and delete it, returning the prior value (or null).
   * Used for one-time OAuth `state` so a callback cannot be replayed.
   */
  getDelete(key: string): Promise<string | null>;
}
