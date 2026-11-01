import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeContentHash, contentFingerprint, dedupeGrants } from '../src/lib/dedupe.js';
import { buildDimensionLookup, computeIsOpen, normalizeGrant } from '../src/lib/normalize.js';
import { buildGrantDocuments } from '../src/lib/transform.js';
import type { Dimensions, RawServices } from '../src/lib/types.js';

const load = <T>(name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;
const services = load<RawServices>('services.json');
const dimensions = load<Dimensions>('dimensions.json');
const lookup = buildDimensionLookup(dimensions);
const NOW = new Date('2026-03-01T00:00:00Z');

describe('buildDimensionLookup', () => {
  it('maps tag ids to dimension values and skips "Select all"', () => {
    expect(lookup.get('2008')).toEqual({ dimension: 'category', name: 'Environment, land and water' });
    expect(lookup.get('4004')).toEqual({ dimension: 'fundingType', name: 'Grant' });
    expect(lookup.get('5002')).toEqual({ dimension: 'businessActivity', name: 'Innovation' });
    expect(lookup.has('-2000')).toBe(false);
  });
});

describe('normalizeGrant', () => {
  it('flattens details and joins dimensions', () => {
    const doc = normalizeGrant(services['60001']!, lookup, NOW);
    expect(doc).toMatchObject({
      id: '60001',
      title: 'Recreational Fishing Grant',
      roundName: null,
      status: 'Open',
      isOpen: true,
      issuingAgency: 'DPI',
      assistanceType: 'Grant',
      categories: ['Environment, land and water'],
      clientGroups: ['Primary industry'],
      applicantTypes: ['Business, start-up or entrepreneur'],
      fundingTypes: ['Grant'],
      openingDate: null,
      closingDate: null,
      amount: null,
    });
    expect(doc.url).toMatch(/^https:\/\//);
    expect(doc.summary).toContain('fishing');
  });

  it('builds a meaningful title for "Round N" records and parses dates/amounts', () => {
    const doc = normalizeGrant(services['60847']!, lookup, NOW);
    expect(doc.title).toBe('Innovation Events Fund – Round 1');
    expect(doc.programName).toBe('Innovation Events Fund');
    expect(doc.roundName).toBe('Round 1');
    expect(doc.openingDate).toBe('2026-02-13T00:00:00+10:00');
    expect(doc.closingDate).toBe('2026-03-16T23:59:59.999+10:00');
    expect(doc.amount).toBe(25000);
    expect(doc.businessActivities).toEqual(['Events', 'Innovation']);
  });
});

describe('computeIsOpen', () => {
  it('respects status and closing date (inclusive of closing day, QLD time)', () => {
    const closing = '2026-03-16T23:59:59.999+10:00';
    expect(computeIsOpen('Open', closing, new Date('2026-03-16T13:00:00Z'))).toBe(true);
    expect(computeIsOpen('Open', closing, new Date('2026-03-16T14:00:01Z'))).toBe(false);
    expect(computeIsOpen('Closed', null, NOW)).toBe(false);
    expect(computeIsOpen('open', null, NOW)).toBe(true);
  });
});

describe('dedupeGrants', () => {
  it('collapses identical records to the lowest id and keeps all source ids', () => {
    const { documents, duplicatesRemoved, fetched } = buildGrantDocuments({ services, dimensions }, NOW);
    expect(fetched).toBe(9);
    expect(duplicatesRemoved).toBe(2);
    const teletrial = documents.find((d) => d.sourceIds.length > 1)!;
    expect(teletrial.id).toBe('64310');
    expect(teletrial.sourceIds).toEqual(['64310', '64311', '64312']);
  });

  it('keeps records that only look similar (different tags) as separate documents', () => {
    const { documents } = buildGrantDocuments({ services, dimensions }, NOW);
    expect(documents.map((d) => d.id)).toEqual(expect.arrayContaining(['60603', '60604']));
  });

  it('produces stable content hashes that change when content changes', () => {
    const a = dedupeGrants([normalizeGrant(services['60001']!, lookup, NOW)]).documents[0]!;
    const b = dedupeGrants([normalizeGrant(services['60001']!, lookup, NOW)]).documents[0]!;
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(computeContentHash({ ...a, summary: 'changed' })).not.toBe(a.contentHash);
    expect(computeContentHash({ ...a, lastChangedAt: 'x' })).toBe(a.contentHash);
    expect(computeContentHash({ ...a, revision: 99 })).toBe(a.contentHash);
    expect(contentFingerprint({ ...a, revision: 99 })).toBe(contentFingerprint(a));
  });
});
