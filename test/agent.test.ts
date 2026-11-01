import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../scripts/env.js';
import type { AgentFile } from '../scripts/foundry.js';

const env = {
  CHAT_DEPLOYMENT: 'gpt-5.4-mini',
  SEARCH_ENDPOINT: 'https://srch.search.windows.net',
  KNOWLEDGE_BASE_NAME: 'grants-kb',
  KB_MCP_CONNECTION_NAME: 'grants-kb-mcp',
};

describe('agents/grants-agent.yaml', () => {
  it('renders to a valid prompt agent wired to the knowledge base MCP endpoint', () => {
    const agent = renderTemplate('agents/grants-agent.yaml', env) as AgentFile;

    expect(agent.name).toBe('qld-grants-agent');
    expect(agent.metadata?.welcomeMessage).toBe('Queensland Grants Finder');
    const starters = agent.metadata?.starterPrompts?.split('\n') ?? [];
    expect(starters).toHaveLength(3);
    for (const value of Object.values(agent.metadata ?? {})) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeLessThanOrEqual(512);
    }
    expect(agent.definition).toMatchObject({ kind: 'prompt', model: 'gpt-5.4-mini' });
    expect(agent.definition.instructions).toContain('knowledge_base_retrieve');
    expect(agent.definition.instructions).toContain('isOpen is a sync-time snapshot');
    expect(agent.definition.instructions).toContain('Unknown status is not Closed');
    expect(agent.definition.instructions).toContain('SmartyGrants portals');
    expect(agent.definition.tools).toEqual([
      {
        type: 'mcp',
        server_label: 'qld_grants_kb',
        server_url: 'https://srch.search.windows.net/knowledgebases/grants-kb/mcp?api-version=2026-08-01-preview',
        project_connection_id: 'grants-kb-mcp',
        require_approval: 'never',
        allowed_tools: ['knowledge_base_retrieve'],
      },
    ]);
  });

  it('fails fast when a placeholder has no value', () => {
    expect(() => renderTemplate('agents/grants-agent.yaml', { ...env, KB_MCP_CONNECTION_NAME: '' })).toThrow(
      /KB_MCP_CONNECTION_NAME/,
    );
  });
});
