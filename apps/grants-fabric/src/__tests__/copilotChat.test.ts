import { access } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GrantRecord } from '../../rayfin/data/GrantRecord';

const sdk = vi.hoisted(() => ({
  options: [] as { baseDirectory: string; env: Record<string, string> }[],
  createSession: vi.fn(),
  sendAndWait: vi.fn(),
  stop: vi.fn(),
  forceStop: vi.fn(),
}));
vi.mock('../../rayfin/functions/node_modules/@github/copilot-sdk/dist/index.js', () => ({
  CopilotClient: class {
    constructor(options: typeof sdk.options[number]) { sdk.options.push(options); }
    createSession = sdk.createSession;
    stop = sdk.stop;
    forceStop = sdk.forceStop;
  },
}));
import { askCopilot } from '../../rayfin/functions/src/copilotChat';

const grant: GrantRecord = {
  id: 'g1', user_id: 'owner', sourceId: 'qld-1', source: 'qld', title: 'Community funding',
  summary: 'Support for projects.', eligibility: 'Check guidelines.', howToApply: 'Read the source.',
  url: 'https://www.qld.gov.au/grants', status: 'Open', closingDate: '', openingDate: '',
  amount: '', jurisdictions: 'Queensland', categories: 'Community', contentHash: 'v1', active: true,
};
const endpoint = 'https://example.openai.azure.com/';

afterEach(() => {
  vi.resetAllMocks();
  sdk.options.length = 0;
});

function configure(answer = 'Check the guidelines [1].') {
  sdk.createSession.mockResolvedValue({ sendAndWait: sdk.sendAndWait });
  sdk.sendAndWait.mockResolvedValue({ data: { content: answer } });
  sdk.stop.mockResolvedValue([]);
}

describe('Copilot SDK grant chat', () => {
  it('uses the platform bearer callback, grounded evidence, and no ambient tools or credentials', async () => {
    configure();
    const tokenProvider = vi.fn().mockResolvedValue('platform-token');
    const result = await askCopilot('How do I apply?', [grant], endpoint, 'model', tokenProvider);
    const config = sdk.createSession.mock.calls[0][0];
    expect(config.provider.baseUrl).toBe(`${endpoint}openai/v1/`);
    expect(config.provider.bearerTokenProvider).toBe(tokenProvider);
    expect(config.provider.wireModel).toBe('model');
    expect(config.provider.modelId).toBe('gpt-4.1');
    expect(config.availableTools).toEqual([]);
    expect(config.onPermissionRequest({})).toEqual({ kind: 'denied-interactively-by-user' });
    expect(config.systemMessage.content).toContain('untrusted evidence');
    expect(sdk.sendAndWait.mock.calls[0][0].prompt).toContain(grant.title);
    expect(result.sources[0]).toEqual({ id: grant.id, title: grant.title, url: grant.url, contentHash: 'v1' });
    expect(sdk.options[0].env).not.toHaveProperty('GITHUB_TOKEN');
    await expect(access(sdk.options[0].baseDirectory)).rejects.toThrow();
  });

  it.each(['', 'No evidence cited.', 'Unknown program [2].', `${'a'.repeat(4001)} [1].`])(
    'rejects unusable answers and cleans up the runtime',
    async (answer) => {
      configure(answer);
      await expect(askCopilot('Question', [grant], endpoint, 'model', async () => 'token')).rejects.toThrow();
      expect(sdk.stop).toHaveBeenCalledOnce();
      await expect(access(sdk.options[0].baseDirectory)).rejects.toThrow();
    },
  );

  it('propagates SDK failures and forces shutdown when graceful cleanup fails', async () => {
    configure();
    sdk.sendAndWait.mockRejectedValueOnce(new Error('Model unavailable'));
    await expect(askCopilot('Question', [grant], endpoint, 'model', async () => 'token')).rejects.toThrow('Model unavailable');
    configure();
    sdk.stop.mockResolvedValueOnce([new Error('Shutdown failed')]);
    await expect(askCopilot('Question', [grant], endpoint, 'model', async () => 'token')).rejects.toThrow('cleanup failed');
    expect(sdk.forceStop).toHaveBeenCalledOnce();
  });

  it('isolates concurrent questions and rejects endpoints before starting a runtime', async () => {
    configure();
    await Promise.all([
      askCopilot('First', [grant], endpoint, 'model', async () => 'one'),
      askCopilot('Second', [grant], endpoint, 'model', async () => 'two'),
    ]);
    expect(sdk.options[0].baseDirectory).not.toBe(sdk.options[1].baseDirectory);
    await expect(askCopilot('Question', [grant], 'https://other.example/', 'model', async () => 'token')).rejects.toThrow('AI_ENDPOINT');
    expect(sdk.options).toHaveLength(2);
  });
});
