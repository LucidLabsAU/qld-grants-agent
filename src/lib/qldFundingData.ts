import { computeContentHash } from './dedupe.js';
import { parseQldDate, parseQldClosingDate } from './dates.js';
import { mapLimit } from './concurrency.js';
import { computeIsOpen, normalizeProgramPart, normalizeUrl } from './normalize.js';
import type { GrantDocument } from './types.js';

const API = 'https://www.data.qld.gov.au/api/3/action/';
type Row = Record<string, unknown>;
interface Resource { id: string; name: string; format: string; datastore_active: boolean }
interface Dataset { id: string; title: string; metadata_modified: string; license_url?: string; resources: Resource[] }

const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (row: Row, key: string): string | null => {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`Invalid funding field ${key}`);
  return String(value).trim() || null;
};
const values = (row: Row, prefix: string): string[] => [...new Set(Object.keys(row)
  .filter((key) => new RegExp(`^${prefix}\\d+$`, 'i').test(key))
  .map((key) => text(row, key)).filter((value): value is string => !!value))].sort();

export function normalizeFundingRow(row: Row, dataset: Pick<Dataset, 'id' | 'metadata_modified' | 'license_url'>, now = new Date()): GrantDocument | null {
  const program = text(row, 'Program title');
  if (!program) {
    if (text(row, 'Purpose') || text(row, 'Eligibility') || text(row, 'Website')) throw new Error('Funding row has evidence but no program title');
    return null; // The published CSV templates contain empty placeholder rows.
  }
  const id = text(row, 'Service ID');
  if (!id || !/^\d+$/.test(id)) throw new Error(`Funding program ${program} has no valid service ID`);
  const round = normalizeProgramPart(text(row, 'Sub-program title'));
  const amountRaw = text(row, 'Maximum (indicative) grant amount (dollar amount)');
  const amount = amountRaw ? Number(amountRaw.replace(/[$,\s]/g, '')) : null;
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new Error(`Invalid funding amount for ${id}`);
  const website = text(row, 'Website');
  const url = normalizeUrl(website);
  if (website && !url) throw new Error(`Invalid funding URL for ${id}`);
  const fundingTypes = values(row, 'Assistance type');
  const status = text(row, 'Status');
  const closingDate = parseQldClosingDate(text(row, 'Closing date (date format)'));
  const document: GrantDocument = {
    id, source: 'Queensland Government open funding data', jurisdictions: ['Queensland'],
    title: round && round.toLowerCase() !== program.toLowerCase() ? `${round} – ${program}` : program,
    programName: program, roundName: round, summary: text(row, 'Purpose'),
    eligibility: text(row, 'Eligibility'), howToApply: null,
    successNotification: text(row, "How will I know if I'm successful?"),
    url, deliveredBy: text(row, 'Funding agency'), issuingAgency: text(row, 'Funding agency'),
    status, isOpen: computeIsOpen(status, closingDate, now),
    openingDate: parseQldDate(text(row, 'Opening date (date format)')), closingDate, amount,
    financialYearBudget: text(row, 'Financial year budget'), assistanceType: fundingTypes.join(', ') || null,
    applicantTypes: values(row, 'Applicant type'), categories: values(row, 'Category'),
    clientGroups: values(row, 'Client group'), fundingTypes,
    businessActivities: values(row, 'Business specific activity'), tagIds: [], sourceIds: [id],
    contentHash: '', lastChangedAt: null,
    sourceDatasetUrl: `https://www.data.qld.gov.au/dataset/${dataset.id}`,
    sourceUpdatedAt: dataset.metadata_modified, licenseUrl: dataset.license_url ?? null,
    openingDateText: text(row, 'Opening date (text)'), closingDateText: text(row, 'Closing date (text)'),
    amountText: text(row, 'Maximum (indicative) grant amount (text)'),
    additionalBudgetInformation: text(row, 'Additional budget information'),
  };
  return { ...document, contentHash: computeContentHash(document) };
}

async function action(name: string, params: Record<string, string>, fetcher: typeof fetch): Promise<Row> {
  const url = new URL(name, API);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetcher(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Queensland funding ${name}: HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!object(body) || body.success !== true || !object(body.result)) throw new Error(`Queensland funding ${name}: invalid API result`);
  return body.result;
}

/** Explicit alternative to the key-protected Grants Finder API, not a silent fallback. */
export async function fetchQldFundingData(fetcher: typeof fetch = fetch, now = new Date()) {
  const datasets: Dataset[] = [];
  let start = 0;
  let total: number;
  do {
    const page = await action('package_search', { q: '"current program funding"', rows: '100', start: String(start) }, fetcher);
    if (!Number.isSafeInteger(page.count) || !Array.isArray(page.results) || !page.results.every((item) =>
      object(item) && typeof item.id === 'string' && typeof item.title === 'string'
      && typeof item.metadata_modified === 'string' && Array.isArray(item.resources)
      && item.resources.every((resource: unknown) => object(resource) && typeof resource.id === 'string'
        && typeof resource.name === 'string' && typeof resource.format === 'string'))) {
      throw new Error('Queensland funding dataset search shape changed');
    }
    total = page.count as number;
    if (total < 0 || (start < total && !page.results.length)) throw new Error('Incomplete Queensland funding dataset search');
    datasets.push(...page.results as Dataset[]);
    start += page.results.length;
  } while (start < total);

  const resources = datasets.flatMap((dataset) => dataset.resources
    .filter((resource) => /^current program funding$/i.test(resource.name) && resource.format.toUpperCase() === 'CSV')
    .map((resource) => ({ dataset, resource })));
  if (!resources.length) throw new Error('No public Queensland current funding resources found');
  const results = await mapLimit(resources, 4, async ({ dataset, resource }) => {
    if (!resource.datastore_active) throw new Error(`Funding resource ${resource.id} has no public data store`);
    const documents: GrantDocument[] = [];
    let offset = 0;
    let count: number;
    do {
      const page = await action('datastore_search', { resource_id: resource.id, limit: '1000', offset: String(offset) }, fetcher);
      const fields = page.fields;
      if (!Array.isArray(page.records) || !page.records.every(object) || !Number.isSafeInteger(page.total)
        || page.total_was_estimated === true || !Array.isArray(fields)
        || !['Service ID', 'Program title', 'Eligibility', 'Status', 'Website'].every((key) =>
          fields.some((field: unknown) => object(field) && field.id === key))) {
        throw new Error(`Funding resource ${resource.id}: invalid table schema or total`);
      }
      count = page.total as number;
      if (count < 0 || (offset < count && !page.records.length)) throw new Error(`Funding resource ${resource.id}: incomplete pagination`);
      for (const row of page.records) {
        const document = normalizeFundingRow(row, dataset, now);
        if (document) documents.push(document);
      }
      offset += page.records.length;
    } while (offset < count);
    return documents;
  });
  const documents = results.flat();
  const ids = new Set<string>();
  for (const document of documents) {
    if (ids.has(document.id)) throw new Error(`Conflicting Queensland funding service ID ${document.id} across datasets`);
    ids.add(document.id);
  }
  if (!documents.length) throw new Error('Public Queensland funding tables contain no programs');
  return { documents, datasets: resources.length };
}
