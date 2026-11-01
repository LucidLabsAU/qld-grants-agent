import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const app = fileURLToPath(new URL('../', import.meta.url));
const functions = resolve(app, 'rayfin/functions');
if (existsSync(resolve(app, 'rayfin/.env'))) process.loadEnvFile(resolve(app, 'rayfin/.env'));
const args = process.argv.slice(2);
if (!args.includes('--workspace-id')) args.push('--workspace-id', process.env.RAYFIN_PUBLIC_WORKSPACE_ID);
if (!args.includes('--tenant')) args.push('--tenant', process.env.RAYFIN_PUBLIC_TENANT_ID);
if (args.some((arg) => !arg)) throw new Error('Supply --workspace-id and --tenant for the target Fabric deployment.');
if (!args.includes('--item-name')) args.push('--item-name', 'Grants Workbench');

function run(command, args, cwd = app, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (exit ${result.status ?? result.signal}).`);
}

run('npm', ['run', 'build'], functions);
try {
  // Fabric runs Linux x64; never upload the developer machine's native SDK binaries.
  run('npm', ['ci', '--os=linux', '--cpu=x64', '--libc=glibc', '--include=optional', '--ignore-scripts'], functions);
  if (!existsSync(resolve(functions, 'node_modules/@github/copilot-sdk-linux-x64/prebuilds/linux-x64/runtime.node'))) {
    throw new Error('The Linux Copilot SDK runtime was not installed.');
  }
  run('npx', ['--no-install', 'rayfin', 'up', ...args], app, {
    ...process.env, RAYFIN_FUNCTIONS_NO_BUNDLE: '1',
  });
  run('npx', ['--no-install', 'rayfin', 'up', 'status']);
} finally {
  run('npm', ['ci'], functions);
}
