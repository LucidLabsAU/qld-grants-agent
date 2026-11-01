import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argValue, loadScriptEnv } from './env.js';

const env = loadScriptEnv();
const workspaceId = argValue('--workspace-id') ?? env.FABRIC_WORKSPACE_ID;
const tenantId = argValue('--tenant') ?? env.FABRIC_TENANT_ID;
const appName = argValue('--app-name') ?? env.FABRIC_APP_NAME ?? 'Grants Workbench';
const endpoint = argValue('--ai-endpoint') ?? env.FABRIC_AI_ENDPOINT;
const deployment = argValue('--ai-deployment') ?? env.FABRIC_AI_DEPLOYMENT;
const dryRun = process.argv.includes('--dry-run');

for (const [name, value] of Object.entries({ FABRIC_WORKSPACE_ID: workspaceId, FABRIC_TENANT_ID: tenantId })) {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Set a valid ${name}, or pass its CLI option. Fabric setup requires an existing workspace.`);
  }
}
if (!endpoint || !deployment) throw new Error('Set FABRIC_AI_ENDPOINT and FABRIC_AI_DEPLOYMENT, or provision the dedicated model with infra/fabric.bicepparam.');
const url = new URL(endpoint);
if (url.protocol !== 'https:' || !url.hostname.endsWith('.openai.azure.com') || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
  throw new Error('FABRIC_AI_ENDPOINT must be the HTTPS root endpoint of an Azure OpenAI resource.');
}

const cwd = fileURLToPath(new URL('../apps/grants-fabric/', import.meta.url));
const rayfin = resolve(cwd, 'node_modules/@microsoft/rayfin-cli/scripts/main');

function run(args: string[], input?: string): void {
  const result = spawnSync(process.execPath, [rayfin, ...args], {
    cwd, encoding: 'utf8', stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    ...(input === undefined ? {} : { input }),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Rayfin ${args[0]} failed (exit ${result.status ?? result.signal}).`);
}

const up = ['up', '--workspace-id', workspaceId!, '--tenant', tenantId!, '--item-name', appName];
if (dryRun) {
  run([...up, '--dry-run']);
} else {
  const result = spawnSync(process.execPath, [resolve(cwd, 'scripts/deploy-fabric.mjs'), ...up.slice(1)], {
    cwd, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Fabric SDK deployment failed (exit ${result.status ?? result.signal}).`);
  run(['secret', 'set', 'AI_ENDPOINT', '--stdin'], url.toString());
  run(['secret', 'set', 'AI_DEPLOYMENT', '--stdin'], deployment);
  run(['up', 'status']);
  console.log('Fabric app published. Import normalized grants in the signed-in app; cloud model access uses the app owner’s permissions.');
}
