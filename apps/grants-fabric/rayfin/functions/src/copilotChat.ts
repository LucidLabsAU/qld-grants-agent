import { CopilotClient } from '@github/copilot-sdk';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GrantRecord } from '../../data/GrantRecord.js';
import { citedSources, groundingMessages, type ChatResult } from './grounding.js';

export async function askCopilot(
  question: string,
  evidence: GrantRecord[],
  endpoint: string,
  model: string,
  getBearerToken: () => Promise<string>,
): Promise<ChatResult> {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.openai.azure.com')
    || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('AI_ENDPOINT must be the HTTPS root endpoint of an Azure OpenAI resource.');
  }
  if (!model.trim()) throw new Error('AI_DEPLOYMENT is not configured.');

  const directory = await mkdtemp(join(tmpdir(), 'rayfin-grants-copilot-'));
  const client = new CopilotClient({
    mode: 'empty',
    useLoggedInUser: false,
    baseDirectory: directory,
    workingDirectory: directory,
    env: { PATH: process.env.PATH, HOME: directory, TMPDIR: tmpdir() },
    logLevel: 'error',
  });
  try {
    const [instructions, prompt] = groundingMessages(question, evidence);
    const session = await client.createSession({
      clientName: 'rayfin-grants-workbench',
      model,
      allowedModels: [model],
      provider: {
        type: 'openai',
        // Deployment aliases must not select the SDK's fallback reasoning profile.
        modelId: 'gpt-4.1',
        wireModel: model,
        baseUrl: new URL('openai/v1/', url).toString(),
        wireApi: 'completions',
        bearerTokenProvider: getBearerToken,
        maxOutputTokens: 1000,
      },
      systemMessage: { mode: 'replace', content: instructions.content },
      availableTools: [],
      excludedTools: ['builtin:*', 'mcp:*', 'custom:*'],
      onPermissionRequest: () => ({ kind: 'denied-interactively-by-user' }),
      enableConfigDiscovery: false,
      skipCustomInstructions: true,
      enableSessionTelemetry: false,
      infiniteSessions: { enabled: false },
    });
    const response = await session.sendAndWait({ prompt: prompt.content }, 90_000);
    const answer = response?.data.content?.trim();
    if (!answer) throw new Error('The Copilot SDK returned no answer.');
    if (answer.length > 4000) throw new Error('The AI answer exceeded the storage limit. Ask a more focused question.');
    return { answer, sources: citedSources(answer, evidence) };
  } finally {
    await disposeCopilot(client, directory);
  }
}

async function disposeCopilot(client: CopilotClient, directory: string): Promise<void> {
  let errors: Error[];
  try {
    errors = await client.stop();
    if (errors.length) {
      console.error('Copilot SDK runtime did not shut down cleanly; forcing shutdown.');
      await client.forceStop();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  if (errors.length) throw new AggregateError(errors, 'Copilot SDK runtime cleanup failed.');
}
