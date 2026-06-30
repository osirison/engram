/**
 * Minimal HTTP client abstraction for OAuth flows.
 *
 * OAuth providers depend on this interface (not on `fetch` directly) so that
 * token exchange and profile fetches are trivially mockable in unit tests
 * without spinning up a server or stubbing globals. The default
 * {@link FetchOAuthHttpClient} is a thin wrapper over the platform `fetch`
 * (Node 18+ ships it globally).
 */

export interface OAuthHttpResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

export interface OAuthHttpClient {
  /** POST an `application/x-www-form-urlencoded` body and parse JSON back. */
  postForm(
    url: string,
    form: Record<string, string>,
    headers?: Record<string, string>
  ): Promise<OAuthHttpResponse>;

  /** GET a JSON resource. */
  getJson(url: string, headers?: Record<string, string>): Promise<OAuthHttpResponse>;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Some providers (e.g. GitHub with the wrong Accept header) return
    // form-encoded bodies. Surface the raw text so callers can decide.
    return text;
  }
}

export class FetchOAuthHttpClient implements OAuthHttpClient {
  async postForm(
    url: string,
    form: Record<string, string>,
    headers: Record<string, string> = {}
  ): Promise<OAuthHttpResponse> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        ...headers,
      },
      body: new URLSearchParams(form).toString(),
    });
    return {
      status: response.status,
      ok: response.ok,
      body: await parseBody(response),
    };
  }

  async getJson(url: string, headers: Record<string, string> = {}): Promise<OAuthHttpResponse> {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
    });
    return {
      status: response.status,
      ok: response.ok,
      body: await parseBody(response),
    };
  }
}
