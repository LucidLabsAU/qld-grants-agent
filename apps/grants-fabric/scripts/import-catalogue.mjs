import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureAuthenticated } from '@microsoft/rayfin-cli/auth';
import { RayfinClient } from '@microsoft/rayfin-client';
import { signInWithEntraToken } from '@microsoft/rayfin-auth-provider-fabric';
import { getGrants, importGrants, parseGrantImport } from '../src/services/grants.ts';

const file = process.argv[2];
if (!file) throw new Error('Usage: npm run import:catalogue -- <normalized-grants.json>. Imports all jurisdictions into your private catalogue and archives changed records.');
const input = JSON.parse(readFileSync(resolve(file), 'utf8'));
const expected = parseGrantImport(input);
process.loadEnvFile(resolve('rayfin/.env'));
const token = await ensureAuthenticated(['https://analysis.windows.net/powerbi/api/Item.Execute.All'], {
  tenantId: process.env.RAYFIN_PUBLIC_TENANT_ID, silent: true,
});
const client = new RayfinClient({
  baseUrl: process.env.RAYFIN_PUBLIC_API_URL,
  publishableKey: process.env.RAYFIN_PUBLIC_PUBLISHABLE_KEY,
  authStorage: false,
});

try {
  await signInWithEntraToken(client.auth, { entraToken: token.token });
  const before = new Map((await getGrants(client)).map((grant) => [grant.sourceId, grant]));
  const count = await importGrants(input, client);
  const after = await getGrants(client);
  const saved = new Map(after.map((grant) => [grant.sourceId, grant]));
  for (const record of expected) {
    const persisted = saved.get(record.sourceId);
    assert.ok(persisted?.active, `Imported ${record.sourceId} must remain active after a fresh read.`);
    assert.ok(persisted.importedAt, `Import time for ${record.sourceId} must be stored.`);
    if (before.has(record.sourceId)) assert.equal(persisted.id, before.get(record.sourceId).id, 'Existing review-linked IDs must stay stable.');
    for (const [key, value] of Object.entries(record)) {
      assert.equal(persisted[key] ?? '', value ?? '', `Persisted field ${key} for ${record.sourceId} differs from the complete import.`);
    }
  }
  for (const [sourceId, previous] of before) {
    assert.equal(saved.get(sourceId)?.id, previous.id, `Existing program ${sourceId} must not be removed.`);
  }
  const sources = Object.fromEntries([...new Set(after.map((grant) => grant.source))]
    .sort().map((source) => [source, after.filter((grant) => grant.source === source).length]));
  console.log(JSON.stringify({
    imported: count, persisted: after.length,
    queensland: after.filter((grant) => grant.jurisdictions.split('|').includes('Queensland')).length,
    sources, verified: 'All imported fields, full evidence, stable existing IDs and retained programs match fresh Fabric reads.',
  }, null, 2));
} finally {
  client.auth.destroy();
}
