import { DIMENSIONS, type DimensionKey, type Dimensions, type RawDimension, type RawServices } from './types.js';

export interface QldClientOptions {
  baseUrl: string;
  apiKey?: string;
  retries?: number;
  signal?: AbortSignal;
}

export interface QldSnapshot {
  services: RawServices;
  dimensions: Dimensions;
}

class NonRetryableError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, apiKey: string | undefined, retries: number, signal?: AbortSignal): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', ...(apiKey ? { 'X-Api-Key': apiKey } : {}) },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
      });
      if (res.ok) return await res.json();
      const message = `GET ${url} failed: ${res.status} ${await res.text()}`;
      // Client errors (other than throttling) won't fix themselves on retry.
      if (res.status < 500 && res.status !== 429) throw new NonRetryableError(message);
      lastError = new Error(message);
    } catch (err) {
      signal?.throwIfAborted();
      if (err instanceof NonRetryableError) throw err;
      lastError = err;
    }

    if (attempt < retries) await sleep(1000 * 2 ** attempt);
  }
  throw lastError;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export function validateServices(value: unknown): RawServices {
  if (!record(value) || !Object.keys(value).length || !Object.entries(value).every(([id, service]) =>
    record(service) && typeof service.id === 'string' && /^\d+$/.test(service.id) && service.id === id
    && typeof service.name === 'string' && !!service.name.trim()
    && strings(service.tags) && strings(service.business_activities) && strings(service.parent_answer_ids)
    && typeof service.location === 'string' && record(service.details)
    && Object.values(service.details).every((detail) =>
      record(detail) && typeof detail.title === 'string' && Array.isArray(detail.sections)
      && detail.sections.every((section: unknown) =>
        record(section) && typeof section.type === 'string' && typeof section.data === 'string')))) {
    throw new Error('QLD services response shape changed or is empty; refusing an unsafe snapshot');
  }
  return value as RawServices;
}

function isDimension(value: unknown): value is RawDimension {
  return record(value) && typeof value.id === 'string' && typeof value.title === 'string'
    && Array.isArray(value.funnels) && value.funnels.length > 0
    && value.funnels.every((funnel: unknown) =>
      record(funnel) && typeof funnel.key === 'string' && typeof funnel.name === 'string');
}

function validateDimension(value: unknown, key: DimensionKey): RawDimension {
  if (!isDimension(value)) throw new Error(`QLD ${key} response shape changed; refusing an unsafe snapshot`);
  return value;
}

/** Fetches the grants fact table and all dimension tables in parallel. */
export async function fetchSnapshot({ baseUrl, apiKey, retries = 3, signal }: QldClientOptions): Promise<QldSnapshot> {
  if (!Number.isSafeInteger(retries) || retries < 0) throw new Error('Retries must be a non-negative integer');
  const base = baseUrl.replace(/\/+$/, '');
  const dimensionKeys = Object.keys(DIMENSIONS) as DimensionKey[];

  const [services, dimensionEntries] = await Promise.all([
    getJson(`${base}/services.json`, apiKey, retries, signal).then(validateServices),
    Promise.all(dimensionKeys.map(async (key) => [
      key, validateDimension(await getJson(`${base}/${DIMENSIONS[key]}.json`, apiKey, retries, signal), key),
    ] as const)),
  ]);

  const dimensions = Object.fromEntries(dimensionEntries) as Dimensions;
  return { services, dimensions };
}
