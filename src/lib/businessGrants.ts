import { computeContentHash } from './dedupe.js';
import type { BusinessResult } from './businessClient.js';
import type { GrantDocument } from './types.js';

const BASE = 'https://business.gov.au';
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const values = (value: unknown): string[] =>
  [...new Set((Array.isArray(value) ? value : value ? [value] : []).filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim()))].sort();

function codePoint(value: number): string {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
    ? String.fromCodePoint(value) : '\uFFFD';
}

export function plain(value: unknown): string | null {
  const html = text(value);
  if (!html) return null;
  const result = html
    .replace(/<\s*br\s*\/?>|<\/(?:p|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_m, n: string) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => codePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_m, n: string) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[n.toLowerCase()]!)
    .replace(/[ \t\u00a0]+/g, ' ').replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\n\s*/g, '\n').trim();
  return result || null;
}

function date(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function normalizeBusinessGrant(result: BusinessResult, now = new Date()): GrantDocument {
  const raw = result.raw;
  const upstreamId = text(raw.z95xid) ?? text(raw.permanentid);
  const path = text(raw.curl);
  if (!upstreamId || !/^[0-9a-f]{32}$/i.test(upstreamId) || !path || !/^\/grants-and-programs\/[a-z0-9/-]+$/i.test(path)) {
    throw new Error(`Invalid business.gov.au grant identity or URL: ${result.title}`);
  }
  const title = text(raw.ctitle) ?? text(result.title);
  if (!title) throw new Error(`Missing business.gov.au grant title: ${upstreamId}`);
  const status = text(raw.cgs);
  // Coveo emits date-only closing dates as midnight at the *start* of the displayed Australian day.
  const closingDate = date(
    typeof raw.closez32xdate === 'number' && raw.noz32xclosez32xtime === '1'
      ? raw.closez32xdate + 24 * 60 * 60 * 1000 - 1
      : raw.closez32xdate,
  );
  const jurisdictions = values(raw.cloc);
  const doc: GrantDocument = {
    id: `bga-${upstreamId.toLowerCase()}`,
    source: 'business.gov.au',
    jurisdictions,
    title,
    programName: title,
    roundName: null,
    summary: plain(raw.csearchcarddescription) ?? plain(raw.flongz32xdescription28333)
      ?? plain(raw.foverview28333) ?? plain(raw.fshortz32xdescription28333),
    eligibility: plain(raw.fapplyz32xsection28333) ?? plain(raw.whoz32xthisz32xisz32xfor),
    howToApply: null,
    successNotification: null,
    url: new URL(path, BASE).href,
    deliveredBy: null,
    issuingAgency: null,
    status,
    isOpen: status?.toLowerCase() === 'open' && (!closingDate || new Date(closingDate) >= now),
    openingDate: date(raw.startz32xdate),
    closingDate,
    amount: null,
    financialYearBudget: null,
    assistanceType: text(raw.cst),
    applicantTypes: values(raw.cbt),
    categories: values(raw.cobj),
    clientGroups: [],
    fundingTypes: values(raw.cst),
    businessActivities: values(raw.cind),
    tagIds: [],
    sourceIds: [upstreamId.toLowerCase()],
    contentHash: '',
    lastChangedAt: null,
  };
  return { ...doc, contentHash: computeContentHash(doc) };
}

export function normalizeBusinessGrants(results: BusinessResult[], now = new Date()) {
  const documents = new Map<string, GrantDocument>();
  for (const raw of results) {
    const doc = normalizeBusinessGrant(raw, now);
    const current = documents.get(doc.id);
    // Some Coveo result variants share an ID; retain the one with the richer description.
    if (!current || (doc.summary?.length ?? 0) + (doc.eligibility?.length ?? 0) >
      (current.summary?.length ?? 0) + (current.eligibility?.length ?? 0)) documents.set(doc.id, doc);
  }
  return { fetched: results.length, documents: [...documents.values()], duplicatesRemoved: results.length - documents.size };
}
