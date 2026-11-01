import { parseQldDate, parseQldClosingDate } from './dates.js';
import type { DimensionKey, Dimensions, GrantDocument, RawService } from './types.js';

/** Detail keys as they appear in services.json. */
const F = {
  subProgram: 'sub_program_title',
  deliveredBy: 'delivered_by',
  summary: 'grant_summary',
  eligibility: 'what_are_the_eligibility_criteria?',
  url: 'url_link',
  howToApply: 'how_can_I_apply_or_get_more_information?',
  status: 'status',
  openingDate: 'opening_date_(date_format)',
  closingDate: 'closing_date_(date_format)',
  issuingAgency: 'issuing_agency',
  amount: 'amount_(currency)',
  success: "how_will_i_know_if_i'm_successful?",
  budget: 'financial_year_budget',
  assistanceType: 'grant_or_assistance?',
} as const;

export type DimensionLookup = Map<string, { dimension: DimensionKey; name: string }>;

/** Builds a tag-id → dimension value lookup, ignoring the "Select all" pseudo options (negative keys). */
export function buildDimensionLookup(dimensions: Dimensions): DimensionLookup {
  const lookup: DimensionLookup = new Map();
  for (const [dimension, dim] of Object.entries(dimensions) as [DimensionKey, Dimensions[DimensionKey]][]) {
    for (const { key, name } of dim.funnels ?? []) {
      if (key.startsWith('-')) continue;
      lookup.set(key, { dimension, name: name.trim() });
    }
  }
  return lookup;
}

function clean(value: string | null | undefined): string | null {
  const s = value?.replace(/\r\n?/g, '\n').replace(/[ \t\u00a0]+/g, ' ').trim();
  return s ? s : null;
}

function detail(raw: RawService, key: string): string | null {
  const sections = raw.details?.[key]?.sections ?? [];
  return clean(sections.map((s) => s.data).filter(Boolean).join('\n\n'));
}

function parseAmount(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^www\./i.test(value)) return `https://${value}`;
  return null;
}

const uniqueSorted = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

export function normalizeProgramPart(value: string | null): string | null {
  const name = value?.trim();
  return name && !/^[-–—\s]+$/.test(name) ? name : null;
}

/** A grant is open when flagged "Open" and its closing date (if any) hasn't passed in QLD time. */
export function computeIsOpen(status: string | null, closingDate: string | null, now: Date): boolean {
  if (status?.toLowerCase() !== 'open') return false;
  if (!closingDate) return true;
  return new Date(closingDate).getTime() >= now.getTime();
}

/** Maps a raw service record + dimension lookup into a flat, index-ready document (hash fields left empty). */
export function normalizeGrant(raw: RawService, lookup: DimensionLookup, now: Date = new Date()): GrantDocument {
  const name = clean(raw.name) ?? `Grant ${raw.id}`;
  const subProgram = normalizeProgramPart(detail(raw, F.subProgram));
  const hasDistinctSubProgram = !!subProgram && subProgram.toLowerCase() !== name.toLowerCase();

  const buckets: Record<DimensionKey, string[]> = {
    applicationType: [], category: [], clientGroup: [], fundingType: [], businessActivity: [],
  };
  const tagIds = uniqueSorted([...(raw.tags ?? []), ...(raw.business_activities ?? [])].map(String));
  for (const tag of tagIds) {
    const hit = lookup.get(tag);
    if (hit) buckets[hit.dimension].push(hit.name);
  }

  const status = detail(raw, F.status);
  const closingDate = parseQldClosingDate(detail(raw, F.closingDate));

  return {
    id: String(raw.id),
    source: 'Queensland Grants Finder',
    jurisdictions: ['Queensland'],
    title: hasDistinctSubProgram ? `${subProgram} – ${name}` : name,
    programName: subProgram ?? name,
    roundName: hasDistinctSubProgram ? name : null,
    summary: detail(raw, F.summary),
    eligibility: detail(raw, F.eligibility),
    howToApply: detail(raw, F.howToApply),
    successNotification: detail(raw, F.success),
    url: normalizeUrl(detail(raw, F.url)),
    deliveredBy: detail(raw, F.deliveredBy),
    issuingAgency: detail(raw, F.issuingAgency),
    status,
    isOpen: computeIsOpen(status, closingDate, now),
    openingDate: parseQldDate(detail(raw, F.openingDate)),
    closingDate,
    amount: parseAmount(detail(raw, F.amount)),
    financialYearBudget: detail(raw, F.budget),
    assistanceType: detail(raw, F.assistanceType),
    applicantTypes: uniqueSorted(buckets.applicationType),
    categories: uniqueSorted(buckets.category),
    clientGroups: uniqueSorted(buckets.clientGroup),
    fundingTypes: uniqueSorted(buckets.fundingType),
    businessActivities: uniqueSorted(buckets.businessActivity),
    tagIds,
    sourceIds: [String(raw.id)],
    contentHash: '',
    lastChangedAt: null,
  };
}
