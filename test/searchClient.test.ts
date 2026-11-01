import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchRestClient } from '../src/lib/searchClient.js';

const credential = { getToken: async () => ({ token: 'test-token', expiresOnTimestamp: Date.now() + 60_000 }) };
afterEach(() => vi.unstubAllGlobals());

describe('SearchRestClient', () => {
  it('recognizes an indexer conflict even when its HTTP body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Already running', { status: 409 })));
    expect(await new SearchRestClient('https://example.test', credential).runIndexer('grants')).toBe('alreadyRunning');
  });

  it('preserves the HTTP status and response when an upstream returns HTML', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Unavailable</html>', { status: 503 })));
    await expect(new SearchRestClient('https://example.test', credential).request('GET', '/indexes')).rejects.toMatchObject({
      status: 503, message: expect.stringContaining('Unavailable'),
    });
  });
});
