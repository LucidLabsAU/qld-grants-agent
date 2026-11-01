/**
 * Local dry run – no Azure needed. Fetches the live QLD API, normalizes + dedupes and prints a summary.
 *   QLD_API_KEY=... npm run preview [-- --out grants.preview.json]
 */
import { writeFileSync } from 'node:fs';
import { fetchSnapshot } from '../src/lib/qldClient.js';
import { buildGrantDocuments } from '../src/lib/transform.js';
import { fetchBusinessGrants } from '../src/lib/businessClient.js';
import { normalizeBusinessGrants } from '../src/lib/businessGrants.js';
import { fetchCuratedGrants } from '../src/lib/curatedGrants.js';
import { fetchBusinessQldPages, urlKey } from '../src/lib/businessQldDiscovery.js';
import { fetchSmartyGrants } from '../src/lib/smartyGrants.js';
import { fetchQldFundingData } from '../src/lib/qldFundingData.js';
import { argValue, loadScriptEnv } from './env.js';

const env = loadScriptEnv();
const publicFundingData = process.argv.includes('--qld-open-data');
const publicQld = publicFundingData ? await fetchQldFundingData() : undefined;
const snapshot = !publicFundingData ? await fetchSnapshot({
  baseUrl: env.QLD_API_BASE_URL ?? 'https://api.jus-checklist.services.qld.gov.au/v1/api/legacy/resources/grants',
  ...(env.QLD_API_KEY && { apiKey: env.QLD_API_KEY }),
}) : undefined;
const qld = snapshot ? buildGrantDocuments(snapshot) : {
  documents: publicQld!.documents, fetched: publicQld!.documents.length, duplicatesRemoved: 0,
};
if (publicQld) console.log(`Using ${publicQld.datasets} public Queensland funding datasets instead of the Grants Finder API.`);
const business = normalizeBusinessGrants((await fetchBusinessGrants()).results);
const curated = await fetchCuratedGrants();
const known = new Set([...qld.documents, ...business.documents, ...curated.documents].map((d) => d.url).filter((u): u is string => !!u).map(urlKey));
const discovered = await fetchBusinessQldPages(known);
const smarty = await fetchSmartyGrants();
const extra = [curated, discovered, smarty];
const documents = [...qld.documents, ...business.documents, ...extra.flatMap((e) => e.documents)];
const fetched = qld.fetched + business.fetched + extra.reduce((n, e) => n + e.fetched, 0);
const duplicatesRemoved = qld.duplicatesRemoved + business.duplicatesRemoved
  + extra.reduce((n, e) => n + e.duplicatesRemoved, 0);

const count = (values: (string | null)[]) =>
  Object.fromEntries(
    Object.entries(values.reduce<Record<string, number>>((acc, v) => ((acc[v ?? '(none)'] = (acc[v ?? '(none)'] ?? 0) + 1), acc), {}))
      .sort((a, b) => b[1] - a[1]),
  );

console.log({
  fetched,
  duplicatesRemoved,
  qldDocuments: qld.documents.length,
  businessDocuments: business.documents.length,
  curatedDocuments: curated.documents.length,
  businessQldDocuments: discovered.documents.length,
  smartyGrantsDocuments: smarty.documents.length,
  availableInQueensland: documents.filter((d) => d.jurisdictions.includes('Queensland')).length,
  source: count(documents.map((d) => d.source)),
  documents: documents.length,
  open: documents.filter((d) => d.isOpen).length,
  status: count(documents.map((d) => d.status)),
  assistanceType: count(documents.map((d) => d.assistanceType)),
  withClosingDate: documents.filter((d) => d.closingDate).length,
  withAmount: documents.filter((d) => d.amount !== null).length,
  withoutSummary: documents.filter((d) => !d.summary).length,
  mergedDuplicates: documents.filter((d) => d.sourceIds.length > 1).map((d) => d.sourceIds),
});
console.log('Sample document:', JSON.stringify(documents.find((d) => d.isOpen) ?? documents[0], null, 2));

const out = argValue('--out');
if (out) {
  writeFileSync(out, JSON.stringify(documents, null, 2));
  console.log(`Wrote ${documents.length} documents to ${out}`);
}
