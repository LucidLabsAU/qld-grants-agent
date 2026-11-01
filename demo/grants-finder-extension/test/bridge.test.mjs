import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('bridge rejects invalid requests locally without requesting Azure credentials', { timeout: 10_000 }, async (t) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bridge/server.mjs', import.meta.url))], {
    env: { PORT: '0', FOUNDRY_PROJECT_ENDPOINT: 'https://example.services.ai.azure.com/api/projects/test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  });
  const port = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Bridge exited early: ${code}`)));
    child.stdout.on('data', (chunk) => {
      const match = /localhost:(\d+)/.exec(String(chunk));
      if (match) resolve(Number(match[1]));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/unknown`)).status, 404);
  assert.equal((await fetch(`${base}/v1/responses`, { method: 'POST', headers: { Origin: 'https://example.test' } })).status, 403);
  for (const body of ['{', 'null', '[]', JSON.stringify({ conversation: '', input: 'Question' })]) {
    assert.equal((await fetch(`${base}/v1/responses`, { method: 'POST', body })).status, 400);
  }
  assert.equal((await fetch(`${base}/v1/responses`, { method: 'POST', body: 'x'.repeat(70_000) })).status, 413);
});
