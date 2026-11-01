import type { TokenCredential } from '@azure/identity';

const FOUNDRY_SCOPE = 'https://ai.azure.com/.default';
const AGENTS_API_VERSION = 'v1';

export interface AgentFile {
  name: string;
  description?: string;
  metadata?: Record<string, string>;
  definition: { kind: string; model: string; [key: string]: unknown };
}

export interface AgentVersion {
  name: string;
  version: string;
  id?: string;
}

/** Minimal Foundry Agent Service + OpenAI-compatible Responses client for a Foundry project (Entra ID auth). */
export class FoundryProjectClient {
  constructor(
    private readonly projectEndpoint: string,
    private readonly credential: TokenCredential,
  ) {}

  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.credential.getToken(FOUNDRY_SCOPE);
    if (!token) throw new Error('Failed to acquire a token for Microsoft Foundry');

    const res = await fetch(`${this.projectEndpoint.replace(/\/+$/, '')}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Publishes a new version of an agent (the agent is created on first publish). */
  createAgentVersion(agent: AgentFile): Promise<AgentVersion> {
    const { name, ...body } = agent;
    return this.request('POST', `/agents/${encodeURIComponent(name)}/versions?api-version=${AGENTS_API_VERSION}`, body);
  }

  createConversation(): Promise<{ id: string }> {
    return this.request('POST', '/openai/v1/conversations', {});
  }

  /** Sends one user turn to an agent within a conversation. */
  respond(agentName: string, conversationId: string, input: string): Promise<AgentResponse> {
    return this.request('POST', '/openai/v1/responses', {
      conversation: conversationId,
      input,
      agent_reference: { type: 'agent_reference', name: agentName },
    });
  }
}

export interface AgentResponse {
  id: string;
  status: string;
  output: Array<{
    type: string;
    name?: string;
    arguments?: string;
    error?: unknown;
    content?: Array<{ type: string; text?: string; annotations?: Array<{ type: string; url?: string; title?: string }> }>;
  }>;
  usage?: { input_tokens: number; output_tokens: number };
}

/** Concatenates the assistant text parts of a Responses API result. */
export function outputText(response: AgentResponse): string {
  return response.output
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text' && c.text)
    .map((c) => c.text)
    .join('\n');
}
