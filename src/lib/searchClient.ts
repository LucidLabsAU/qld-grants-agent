import type { TokenCredential } from '@azure/identity';

/** Data-plane API version used across the repo (knowledge bases/sources need the latest preview). */
export const SEARCH_API_VERSION = '2026-08-01-preview';
const SEARCH_SCOPE = 'https://search.azure.com/.default';

/** Minimal Azure AI Search REST client authenticated with Microsoft Entra ID. */
export class SearchRestClient {
  constructor(
    private readonly endpoint: string,
    private readonly credential: TokenCredential,
    private readonly apiVersion = SEARCH_API_VERSION,
  ) {}

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const token = await this.credential.getToken(SEARCH_SCOPE);
    if (!token) throw new Error('Failed to acquire a token for Azure AI Search');

    const sep = path.includes('?') ? '&' : '?';
    const url = `${this.endpoint.replace(/\/+$/, '')}${path}${sep}api-version=${this.apiVersion}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    const text = await res.text();
    if (!res.ok) {
      const error = new Error(`${method} ${path} failed: ${res.status} ${text}`) as Error & { status: number };
      error.status = res.status;
      throw error;
    }
    const data = (text ? JSON.parse(text) : undefined) as T;
    return { status: res.status, data };
  }

  /** Queues an on-demand indexer run. A 409 means a run is already in progress, which is fine. */
  async runIndexer(name: string): Promise<'started' | 'alreadyRunning'> {
    try {
      await this.request('POST', `/indexers/${encodeURIComponent(name)}/run`);
      return 'started';
    } catch (err) {
      if (err instanceof Error && 'status' in err && err.status === 409) return 'alreadyRunning';
      throw err;
    }
  }
}
