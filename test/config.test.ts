import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/lib/config.js';

afterEach(() => vi.unstubAllEnvs());

describe('loadConfig', () => {
  it.each(['', ' ', '-1', 'NaN', 'Infinity'])('rejects unsafe retention settings: %s', (value) => {
    vi.stubEnv('SOFT_DELETE_RETENTION_DAYS', value);
    expect(() => loadConfig()).toThrow(/SOFT_DELETE_RETENTION_DAYS/);
  });

  it('requires both extraction settings instead of silently disabling a partial configuration', () => {
    vi.stubEnv('FOUNDRY_OPENAI_ENDPOINT', 'https://example.openai.azure.com');
    vi.stubEnv('CHAT_DEPLOYMENT', '');
    expect(() => loadConfig()).toThrow(/configured together/);
  });
});
