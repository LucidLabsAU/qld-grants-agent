/** The public Grants and programs finder uses a page-scoped Coveo search key and query scope. */
const PAGE = 'https://business.gov.au/Grants-and-Programs';
const ORGANIZATION = 'departmentofindustryscienceenergyandresourcesproduxlo9oz8e';
const SEARCH = `https://${ORGANIZATION}.org.coveo.com/rest/search/v2?organizationId=${ORGANIZATION}`;
const PAGE_SIZE = 100;
const FIELDS = [
  'z95xid', 'permanentid', 'ctitle', 'curl', 'cloc', 'cgs', 'cind', 'cst', 'cbt',
  'cobj', 'csearchcarddescription', 'flongz32xdescription28333', 'foverview28333',
  'fapplyz32xsection28333', 'whatz32xyouz32xget', 'whoz32xthisz32xisz32xfor',
  'startz32xdate', 'closez32xdate',
  'noz32xclosez32xtime',
];

export interface BusinessResult {
  title: string;
  raw: Record<string, unknown>;
}

export interface BusinessSnapshot {
  total: number;
  results: BusinessResult[];
}

function attribute(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = new RegExp(`\\b${escaped}="([^"]+)"`, 'i').exec(html)?.[1];
  if (!value) throw new Error(`business.gov.au no longer exposes ${name}; cannot safely sync the feed`);
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

export function parseBusinessPage(html: string): { key: string; cq: string } {
  const connection = /<[^>]*class="[^"]*\bsearch-connection\b[^"]*"[^>]*>/i.exec(html)?.[0];
  const interfaceTag = /<[^>]*id="grantsInterface"[^>]*>/i.exec(html)?.[0];
  if (!connection || !interfaceTag) throw new Error('business.gov.au search configuration was not found');
  const org = attribute(connection, 'data-organizationId');
  if (org !== ORGANIZATION) throw new Error(`Unexpected business.gov.au Coveo organization: ${org}`);
  return {
    key: attribute(connection, 'data-searchKey'),
    cq: `${attribute(interfaceTag, 'data-cq')} (@z95xlanguage==en) (@z95xlatestversion==1) (@source=="Coveo_web_index - BGA Prod Environment")`,
  };
}

export async function fetchBusinessGrants(fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<BusinessSnapshot> {
  const timeout = () => signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
  const landing = await fetcher(PAGE, { signal: timeout() });
  if (!landing.ok) throw new Error(`business.gov.au page returned HTTP ${landing.status}`);
  const { key, cq } = parseBusinessPage(await landing.text());
  const results: BusinessResult[] = [];
  let total = -1;

  do {
    const response = await fetcher(SEARCH, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: '', cq, searchHub: 'Grants and programs', sortCriteria: '@cgrantsort ascending',
        firstResult: results.length, numberOfResults: PAGE_SIZE, fieldsToInclude: FIELDS,
      }),
      signal: timeout(),
    });
    if (!response.ok) throw new Error(`business.gov.au search returned HTTP ${response.status} at offset ${results.length}`);
    const page: unknown = await response.json();
    if (!isPage(page)) throw new Error('business.gov.au search response shape changed');
    if (total < 0) total = page.totalCount;
    if (page.totalCount !== total || !page.results.length || results.length + page.results.length > total) {
      throw new Error('business.gov.au search changed during pagination; refusing a partial snapshot');
    }
    results.push(...page.results);
  } while (results.length < total);

  return { total, results };
}

function isPage(value: unknown): value is { totalCount: number; results: BusinessResult[] } {
  if (!value || typeof value !== 'object') return false;
  const page = value as { totalCount?: unknown; results?: unknown };
  return Number.isSafeInteger(page.totalCount) && typeof page.totalCount === 'number' && page.totalCount > 0
    && Array.isArray(page.results) && page.results.every((r: unknown) =>
      !!r && typeof r === 'object' && typeof (r as BusinessResult).title === 'string'
      && typeof (r as BusinessResult).raw === 'object' && (r as BusinessResult).raw !== null
      && !Array.isArray((r as BusinessResult).raw));
}
