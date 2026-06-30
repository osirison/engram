import type { OAuthProviderName } from '../types.js';
import type { OAuthProvider } from './oauth-provider.js';

/**
 * Registry of configured OAuth providers. A provider only appears here when its
 * client id/secret are configured, so {@link isEnabled} doubles as a
 * "is this login method available?" check.
 */
export class OAuthService {
  private readonly providers: Map<OAuthProviderName, OAuthProvider>;

  constructor(providers: OAuthProvider[]) {
    this.providers = new Map(providers.map((p) => [p.name, p]));
  }

  isEnabled(name: OAuthProviderName): boolean {
    return this.providers.has(name);
  }

  listEnabled(): OAuthProviderName[] {
    return [...this.providers.keys()];
  }

  /** Look up a configured provider, or throw if it is not enabled. */
  getProvider(name: OAuthProviderName): OAuthProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`OAuth provider "${name}" is not configured`);
    }
    return provider;
  }
}
