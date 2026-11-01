import { createHash } from 'node:crypto';
import { plain } from './businessGrants.js';
import { computeContentHash } from './dedupe.js';
import { CURATED_SOURCES, type CuratedSource } from './curatedSources.js';
import { parseQldDate, parseQldClosingDate } from './dates.js';
import { mapLimit } from './concurrency.js';
export { mapLimit } from './concurrency.js';
import { computeIsOpen } from './normalize.js';
import type { Extraction } from './extractGrantFields.js';
import type { GrantDocument } from './types.js';

const MAX_BODY_CHARS = 8000;
const MIN_BODY_CHARS = 200;
export const USER_AGENT = 'qld-grants-agent/1.0 (grants discovery; official public pages only)';
const DEFAULT_SOURCE = 'Queensland Government (official program page)';

const meta = (html: string, key: string) =>
  plain(html.match(new RegExp(`<meta[^>]+(?:name|property)="${key}"[^>]+content="([^"]*)"`, 'i'))?.[1]);

export const pageId = (prefix: string, url: string) => {
  const { hostname, pathname } = new URL(url);
  return `${prefix}-${createHash('sha256').update(`${hostname}${pathname}`).digest('hex').slice(0, 16)}`;
};

/** Page text with chrome (scripts, navigation, forms) removed and whitespace collapsed. */
export function pageText(html: string): string {
  const stripped = html.replace(/<(script|style|nav|header|footer|aside|form|noscript)\b[\s\S]*?<\/\1>/gi, ' ');
  const main = stripped.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? stripped;
  return plain(main)?.slice(0, MAX_BODY_CHARS) ?? '';
}

export const baseDocument = (id: string, source: CuratedSource, fields: Partial<GrantDocument> & Pick<GrantDocument, 'title'>): GrantDocument => {
  const doc: GrantDocument = {
    id,
    source: source.sourceLabel ?? DEFAULT_SOURCE,
    jurisdictions: ['Queensland'],
    programName: fields.title,
    roundName: null,
    summary: null,
    eligibility: null,
    howToApply: null,
    successNotification: null,
    url: source.url,
    deliveredBy: source.issuingAgency,
    issuingAgency: source.issuingAgency,
    status: null,
    isOpen: false,
    openingDate: null,
    closingDate: null,
    amount: null,
    financialYearBudget: null,
    assistanceType: source.assistanceType,
    applicantTypes: source.applicantTypes,
    categories: source.categories,
    clientGroups: [],
    fundingTypes: source.assistanceType ? [source.assistanceType] : [],
    businessActivities: [],
    tagIds: [],
    sourceIds: [id],
    contentHash: '',
    lastChangedAt: null,
    ...fields,
  };
  return { ...doc, contentHash: computeContentHash(doc) };
};

/** Parses an official program page into a document. The status is unknown, so isOpen stays false. */
export function parseCuratedPage(html: string, source: CuratedSource, idPrefix = 'cur'): GrantDocument {
  const stripped = html.replace(/<(script|style|nav|header|footer|aside|form|noscript)\b[\s\S]*?<\/\1>/gi, ' ');
  const main = stripped.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? stripped;
  const heading = plain(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1])?.replace(/^Page title\s+/i, '').replace(/\s+/g, ' ');
  const title = heading ?? plain(meta(html, 'og:title'))?.split(/\s[|–-]\s/)[0];
  const body = pageText(html);
  if (!title || body.length < MIN_BODY_CHARS) {
    throw new Error(`Unrecognised page structure for ${source.url}; the page may have moved or changed`);
  }
  return baseDocument(pageId(idPrefix, source.url), source, {
    title,
    summary: meta(html, 'description') ?? body.slice(0, 500),
    eligibility: body,
  });
}

export type FieldExtractor = (title: string, pageText: string) => Promise<Extraction | null>;

/** Overlays validated extraction results; values already set deterministically win, unstated fields stay null. */
export function applyExtraction(doc: GrantDocument, extraction: Extraction, now = new Date()): GrantDocument {
  const status = doc.status ?? extraction.status;
  const openingDate = doc.openingDate ?? parseQldDate(extraction.openingDate);
  const closingDate = doc.closingDate ?? parseQldClosingDate(extraction.closingDate);
  const merged: GrantDocument = {
    ...doc,
    status,
    openingDate,
    closingDate,
    isOpen: computeIsOpen(status, closingDate, now),
    amount: doc.amount ?? extraction.amount,
    summary: extraction.summary ?? doc.summary,
  };
  return { ...merged, contentHash: computeContentHash(merged) };
}

export interface PageOptions {
  fetcher?: typeof fetch;
  extract?: FieldExtractor;
  log?: (message: string) => void;
  now?: Date;
  /** Skip pages that fail instead of failing the whole run. */
  tolerant?: boolean;
  concurrency?: number;
  signal?: AbortSignal;
}

export async function getHtml(url: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<string> {
  const response = await fetcher(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

/** Extraction only enriches; a failure leaves the fields null rather than failing the sync. */
export async function enrich(doc: GrantDocument, opts: PageOptions): Promise<GrantDocument> {
  if (!opts.extract) return doc;
  const log = opts.log ?? console.log;
  try {
    const extraction = await opts.extract(doc.title, doc.eligibility ?? '');
    if (extraction) return applyExtraction(doc, extraction, opts.now);
    log(`No verified fields extracted for ${doc.url}`);
  } catch (error) {
    opts.signal?.throwIfAborted();
    log(`Field extraction failed for ${doc.url}: ${error instanceof Error ? error.message : error}`);
  }
  return doc;
}

/**
 * Fetches each page and builds its document. By default any failure aborts the run, so a missing page
 * never soft-deletes a program; `tolerant` skips failures (used for discovered pages).
 */
export async function fetchPages(
  sources: CuratedSource[],
  opts: PageOptions & { idPrefix?: string } = {},
) {
  const log = opts.log ?? console.log;
  const results = await mapLimit(sources, opts.concurrency ?? 1, async (source) => {
    try {
      opts.signal?.throwIfAborted();
      const doc = parseCuratedPage(await getHtml(source.url, opts.fetcher, opts.signal), source, opts.idPrefix);
      return await enrich(doc, opts);
    } catch (error) {
      opts.signal?.throwIfAborted();
      if (!opts.tolerant) throw error;
      log(`Skipping ${source.url}: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  });
  const documents = results.filter((d): d is GrantDocument => d !== null);
  const failedIds = results.flatMap((doc, i) =>
    doc === null ? [pageId(opts.idPrefix ?? 'cur', sources[i]!.url)] : []);
  return { fetched: documents.length, documents, duplicatesRemoved: 0, failedIds };
}

export const fetchCuratedGrants = (sources: CuratedSource[] = CURATED_SOURCES, opts: PageOptions = {}) =>
  fetchPages(sources, opts);
