import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSnapshot, validateServices } from '../src/lib/qldClient.js';
import { DIMENSIONS, type Dimensions } from '../src/lib/types.js';

const services: unknown = JSON.parse(readFileSync(new URL('./fixtures/services.json', import.meta.url), 'utf8'));
const dimensions = JSON.parse(readFileSync(new URL('./fixtures/dimensions.json', import.meta.url), 'utf8')) as Dimensions;
afterEach(() => vi.unstubAllGlobals());

describe('QLD snapshot validation', () => {
  it.each([{}, [], null, { error: 'unavailable' }, { '1': { id: '1', name: 'Incomplete' } }])('rejects unsafe snapshots: %j', (value) => {
    expect(() => validateServices(value)).toThrow(/unsafe snapshot/);
  });

  it('accepts the existing feed fixtures and refuses malformed dimension tables', async () => {
    const fetcher = vi.fn(async (url: string) => {
      const key = (Object.keys(DIMENSIONS) as (keyof Dimensions)[]).find((key) => url.endsWith(`/${DIMENSIONS[key]}.json`));
      return Response.json(key ? dimensions[key] : services);
    });
    vi.stubGlobal('fetch', fetcher);
    expect((await fetchSnapshot({ baseUrl: 'https://example.test', retries: 0 })).services).toEqual(services);
    fetcher.mockImplementation(async (url) => Response.json(url.endsWith('/services.json') ? services : { funnels: [] }));
    await expect(fetchSnapshot({ baseUrl: 'https://example.test', retries: 0 })).rejects.toThrow(/unsafe snapshot/);
  });
});
