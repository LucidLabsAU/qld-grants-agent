import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureAuthenticated } from '@microsoft/rayfin-cli/auth';
import { RayfinClient } from '@microsoft/rayfin-client';
import { signInWithEntraToken } from '@microsoft/rayfin-auth-provider-fabric';
import { parseGrantImport } from '../src/services/grants.ts';
import { askCopilot } from '../rayfin/functions/src/copilotChat.ts';

const file = process.argv[2];
const chatOnly = process.argv.includes('--chat-only');
const sdkLocal = process.argv.includes('--sdk-local');
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
if (!file) throw new Error('Usage: npm run smoke -- <normalized-grants.json>. This writes real imported grants, a labelled review, and a chat turn.');
process.loadEnvFile(resolve('rayfin/.env'));
const token = await ensureAuthenticated(['https://analysis.windows.net/powerbi/api/Item.Execute.All'], {
  tenantId: process.env.RAYFIN_PUBLIC_TENANT_ID, silent: true,
});
const config = {
  baseUrl: process.env.RAYFIN_PUBLIC_API_URL,
  publishableKey: process.env.RAYFIN_PUBLIC_PUBLISHABLE_KEY,
  authStorage: false,
};
const client = new RayfinClient(config);
const anonymous = new RayfinClient(config);

try {
  await signInWithEntraToken(client.auth, { entraToken: token.token });
  const owner = client.auth.getSession().user;
  assert.ok(owner, 'Authenticated session must have a user.');
  const grants = parseGrantImport(JSON.parse(readFileSync(resolve(file), 'utf8')))
    .filter((grant) => grant.jurisdictions.split('|').includes('Queensland'));
  assert.ok(grants.length, 'Supply a catalogue with Queensland grants.');

  if (!chatOnly && !sdkLocal) {
  for (const grant of grants) {
    const previous = await client.data.GrantRecord.select(['id']).where({ sourceId: { eq: grant.sourceId } }).first(1).execute();
    if (previous.length) await client.data.GrantRecord.update({ id: previous[0].id }, { ...grant, active: true });
    else await client.data.GrantRecord.create({ ...grant, user_id: owner.id, active: true });
  }
  console.log(`Imported ${grants.length} real Queensland grants.`);
  }
  const selected = await client.data.GrantRecord.select(['id', 'title', 'contentHash']).orderBy({ id: 'asc' }).first(1).execute();
  assert.equal(selected.length, 1);
  const grant = selected[0];
  if (!chatOnly && !sdkLocal) {
  const review = await client.data.GrantReview.create({
    user_id: owner.id, grantId: grant.id, contentHash: grant.contentHash, decision: 'researching',
    notes: '[Automated validation] Storage and revision binding check, not an eligibility assessment.', createdAt: new Date(),
  });
  assert.ok(await client.data.GrantReview.findById(review.id), 'Review must persist after a fresh read.');
  await assert.rejects(() => client.data.GrantReview.update({ id: review.id }, { notes: 'tampered' }));
  await assert.rejects(() => anonymous.data.GrantRecord.select(['id']).first(1).execute());
  await assert.rejects(() => client.data.GrantRecord.create({ ...grants[0], user_id: 'not-the-caller', active: true }));
  console.log('Verified authenticated persistence, immutable reviews, anonymous denial, and owner policy enforcement.');
  }

  const question = `What should I check about ${grant.title} before applying? Cite the retrieved evidence.`;
  let result;
  if (sdkLocal) {
    const endpoint = option('--ai-endpoint');
    const model = option('--ai-deployment');
    if (!endpoint || !model) throw new Error('--sdk-local requires --ai-endpoint and --ai-deployment.');
    const rows = await client.data.GrantRecord.select([
      'id', 'user_id', 'sourceId', 'source', 'title', 'summary', 'eligibility', 'howToApply',
      'url', 'status', 'openingDate', 'closingDate', 'amount', 'jurisdictions', 'categories', 'contentHash', 'active',
    ]).where({ id: { eq: grant.id } }).first(1).execute();
    const record = rows[0];
    assert.ok(record, 'Retrieved grant must still exist.');
    result = await askCopilot(question, [record], endpoint, model, async () => {
      const ai = JSON.parse(execFileSync('az', [
        'account', 'get-access-token', '--resource', 'https://cognitiveservices.azure.com',
        '--tenant', process.env.RAYFIN_PUBLIC_TENANT_ID, '--output', 'json',
      ], { encoding: 'utf8' }));
      assert.ok(typeof ai.accessToken === 'string' && ai.accessToken, 'Azure CLI must return an AI resource token.');
      return ai.accessToken;
    });
    console.log('Verified real Copilot SDK inference using the authenticated Rayfin catalogue and Entra BYOK.');
  } else {
    result = await client.functions.askGrants.invoke({
      question, selectedId: grant.id, openOnly: false,
    }, { timeoutMs: 120_000 });
  }
  assert.ok(result.answer && result.sources.some((source) => source.id === grant.id), 'Chat must cite the selected grant.');
  const turn = await client.data.ChatTurn.create({
    user_id: owner.id, question: `What should I check about ${grant.title} before applying?`,
    answer: result.answer, sourcesJson: JSON.stringify(result.sources), createdAt: new Date(),
  });
  const saved = await client.data.ChatTurn.select(['id', 'answer', 'sourcesJson'])
    .where({ id: { eq: turn.id } }).first(1).execute();
  assert.equal(saved[0]?.answer, result.answer, 'Chat answer must persist after a fresh read.');
  assert.deepEqual(JSON.parse(saved[0].sourcesJson), result.sources, 'Stored citations must match the answer.');
  console.log(`Verified ${sdkLocal ? 'local Copilot SDK' : 'deployed'} grounded AI chat and saved chat history.`);
} finally {
  client.auth.destroy();
  anonymous.auth.destroy();
}
