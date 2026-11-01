/**
 * Sample queries against the grants index / knowledge base.
 *
 *   npm run query -- status                          # indexer status + document count
 *   npm run query -- keyword   "fishing"
 *   npm run query -- vector    "help for farmers in financial hardship"
 *   npm run query -- hybrid    "funding for a community sports club"
 *   npm run query -- semantic  "I want to export my product overseas"
 *   npm run query -- facets
 *   npm run query -- filtered  "innovation"
 *   npm run query -- agentic   "What open grants can a small business get for hiring apprentices?"
 *   npm run query -- hybrid "drought" -- --all-jurisdictions  # opt out of the Queensland default
 *
 * Add --raw to print the full JSON response.
 */
import { DefaultAzureCredential } from '@azure/identity';
import { SearchRestClient } from '../src/lib/searchClient.js';
import { loadScriptEnv, positionalArgs, requireEnv } from './env.js';

const env = loadScriptEnv();
const search = new SearchRestClient(requireEnv(env, 'SEARCH_ENDPOINT'), new DefaultAzureCredential());
const index = env.SEARCH_INDEX_NAME;
const [scenario = 'hybrid', text = 'grants for small business'] = positionalArgs();
const raw = process.argv.includes('--raw');
const allJurisdictions = process.argv.includes('--all-jurisdictions');
const LOCATION_FILTER = "jurisdictions/any(j: j eq 'Queensland')";

/** Open = flagged Open and not past its closing date (evaluated at query time, so it never goes stale). */
const OPEN_FILTER = `status eq 'Open' and (closingDate eq null or closingDate ge ${new Date().toISOString()})`
  + (allJurisdictions ? '' : ` and ${LOCATION_FILTER}`);
const SELECT = 'id,title,source,jurisdictions,status,closingDate,amount,issuingAgency,assistanceType,categories,url,revision';
const vectorQuery = (t: string, k = 50) => ({ kind: 'text', text: t, fields: 'titleVector,descriptionVector', k });

const queries: Record<string, () => object> = {
  keyword: () => ({ search: text, searchMode: 'all', filter: OPEN_FILTER, select: SELECT, top: 10, count: true }),

  vector: () => ({ vectorQueries: [vectorQuery(text, 10)], vectorFilterMode: 'preFilter', filter: OPEN_FILTER, select: SELECT, top: 10 }),

  hybrid: () => ({
    search: text,
    vectorQueries: [vectorQuery(text)],
    filter: OPEN_FILTER,
    facets: ['categories,count:10', 'assistanceType', 'applicantTypes', 'source', 'jurisdictions'],
    select: SELECT,
    top: 10,
    count: true,
  }),

  semantic: () => ({
    search: text,
    vectorQueries: [vectorQuery(text)],
    queryType: 'semantic',
    semanticConfiguration: 'grants-semantic',
    captions: 'extractive|highlight-true',
    answers: 'extractive|count-3',
    filter: OPEN_FILTER,
    select: `${SELECT},summary`,
    top: 5,
  }),

  facets: () => ({
    search: '*',
    facets: [
      'status',
      'isOpen',
      'assistanceType',
      'issuingAgency,count:25',
      'categories,count:25',
      'applicantTypes',
      'clientGroups,count:40',
      'fundingTypes',
      'businessActivities',
      'source',
      'jurisdictions',
      'amount,values:10000|50000|100000|500000|1000000',
      'closingDate,interval:month',
    ],
    top: 0,
    filter: allJurisdictions ? undefined : LOCATION_FILTER,
    count: true,
  }),

  filtered: () => ({
    search: text,
    vectorQueries: [vectorQuery(text)],
    queryType: 'semantic',
    semanticConfiguration: 'grants-semantic',
    filter:
      `${OPEN_FILTER} and applicantTypes/any(a: a eq 'Business, start-up or entrepreneur')` +
      ` and (fundingTypes/any(f: f eq 'Grant' or f eq 'Loan')) and (amount eq null or amount ge 10000)`,
    facets: ['categories', 'issuingAgency'],
    select: SELECT,
    top: 10,
    count: true,
  }),
};

type SearchHit = Record<string, unknown> & { '@search.score': number; '@search.rerankerScore'?: number };

function printHits(data: { value: SearchHit[]; '@odata.count'?: number; '@search.facets'?: object; '@search.answers'?: object[] }) {
  if (data['@odata.count'] !== undefined) console.log(`Total matches: ${data['@odata.count']}`);
  for (const a of data['@search.answers'] ?? []) console.log('💡 Answer:', (a as { text: string }).text);
  for (const hit of data.value) {
    const score = hit['@search.rerankerScore'] ?? hit['@search.score'];
    const closing = hit.closingDate ? String(hit.closingDate).slice(0, 10) : 'n/a';
    console.log(`• [${Number(score).toFixed(3)}] ${hit.title}  (${hit.status}, closes ${closing}, amount ${hit.amount ?? 'n/a'}, ${hit.issuingAgency ?? 'agency not stated'}, ${hit.source})`);
  }
  if (data['@search.facets']) {
    for (const [field, buckets] of Object.entries(data['@search.facets'])) {
      const values = (buckets as { value?: unknown; from?: unknown; to?: unknown; count: number }[])
        .map((b) => `${b.value ?? `${b.from ?? ''}..${b.to ?? ''}`}=${b.count}`)
        .join(', ');
      console.log(`▸ ${field}: ${values}`);
    }
  }
}

if (scenario === 'status') {
  const { data: status } = await search.request<{ status: string; lastResult?: object }>('GET', `/indexers/${env.SEARCH_INDEXER_NAME}/status`);
  const { data: stats } = await search.request('GET', `/indexes/${index}/stats`);
  console.log(JSON.stringify({ indexerStatus: status.status, lastResult: status.lastResult, indexStats: stats }, null, 2));
} else if (scenario === 'agentic') {
  const { data } = await search.request<{ response: { content: { text: string }[] }[]; references: unknown[]; activity: unknown[] }>(
    'POST',
    `/knowledgebases/${env.KNOWLEDGE_BASE_NAME}/retrieve`,
    {
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      knowledgeSourceParams: [{ knowledgeSourceName: env.KNOWLEDGE_SOURCE_NAME, kind: 'searchIndex', includeReferenceSourceData: true,
        ...(!allJurisdictions && { filterAddOn: LOCATION_FILTER }) }],
    },
  );
  if (raw) console.log(JSON.stringify(data, null, 2));
  else {
    console.log(data.response?.[0]?.content?.map((c) => c.text).join('\n'));
    console.log(`\n${data.references?.length ?? 0} references, activity:`, JSON.stringify(data.activity, null, 2));
  }
} else {
  const build = queries[scenario];
  if (!build) throw new Error(`Unknown scenario '${scenario}'. Try: status, agentic, ${Object.keys(queries).join(', ')}`);
  const body = build();
  console.log(`▶ ${scenario}:`, JSON.stringify(body));
  const { data } = await search.request<Parameters<typeof printHits>[0]>('POST', `/indexes/${index}/docs/search`, body);
  if (raw) console.log(JSON.stringify(data, null, 2));
  else printHits(data);
}
