import { baseDocument, getHtml, mapLimit, pageId, pageText, type PageOptions } from './curatedGrants.js';
import type { CuratedSource } from './curatedSources.js';
import { parseQldDate, parseQldClosingDate } from './dates.js';
import { plain } from './businessGrants.js';
import { computeIsOpen } from './normalize.js';
import type { GrantDocument } from './types.js';

/**
 * Public SmartyGrants funder portals. Only the portal home page and each round's public information page are
 * read; /applicant and the application forms are disallowed by the portals' robots.txt and never touched.
 */
export const SMARTYGRANTS_PORTALS = [
  { slug: 'brisbane', funder: 'Brisbane City Council' },
  { slug: 'ipswich', funder: 'Ipswich City Council' },
];

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE = new RegExp(`(\\d{1,2}) (${MONTHS}) (\\d{4})`);
const SLUG = /^[a-z0-9-]+$/;
const PATH = /^\/[A-Za-z0-9_.-]+$/;
const RESERVED_PATH = /^\/(?:applicant|start|login|register)(?:[._-]|$)/i;

export interface PortalRound {
  path: string;
  title: string;
  upcoming: boolean;
  blurb: string;
  openingDate: string | null;
  closingDate: string | null;
}

const isoDate = (text: string | undefined, closing = false) => {
  const m = text && DATE.exec(text);
  if (!m) return null;
  const date = (closing ? parseQldClosingDate : parseQldDate)(`${m[1]} ${m[2]} ${m[3]}`);
  if (!date || !text) return date;
  if (/\bmidnight\b/i.test(text)) {
    return /start of day/i.test(text) ? date.replace(/T.*$/, 'T00:00:00+10:00') : date;
  }
  const time = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (!time) return date;
  const hour = Number(time[1]);
  const minute = Number(time[2] ?? 0);
  if (hour < 1 || hour > 12 || minute > 59) throw new Error(`Invalid SmartyGrants time: ${text}`);
  const hours = hour % 12 + (time[3]?.toLowerCase() === 'pm' ? 12 : 0);
  return date.replace(/T.*$/, `T${String(hours).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+10:00`);
};

/** Reads the "Current Rounds" and "Upcoming Rounds" lists from a portal home page. */
export function parsePortalRounds(html: string): PortalRound[] {
  const upcomingAt = html.search(/<h2[^>]*id="sgUpcomingRounds"/i);
  const currentAt = html.search(/<h2[^>]*id="sgCurrentRounds"/i);
  if (currentAt < 0 && upcomingAt < 0) throw new Error('SmartyGrants portal markup not recognised');
  const rounds: PortalRound[] = [];
  const blocks = html.matchAll(/<div class="chooseform">\s*<h3><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h3>([\s\S]*?)(?=<div class="chooseform">|$)/g);
  for (const block of blocks) {
    const path = block[1]!;
    const rawTitle = block[2]!;
    const rest = block[3]!;
    const title = plain(rawTitle)?.replace(/\s+/g, ' ');
    if (!title || !PATH.test(path) || RESERVED_PATH.test(path)) continue;
    let depth = 1;
    let end: number | undefined;
    for (const tag of rest.matchAll(/<\/?div\b[^>]*>/gi)) {
      depth += /^<\/div/i.test(tag[0]) ? -1 : 1;
      if (depth === 0) {
        end = tag.index;
        break;
      }
    }
    if (end === undefined) throw new Error(`SmartyGrants round markup not recognised: ${path}`);
    const blurb = plain(rest.slice(0, end).replace(/<a [^>]*>[^<]*Find out more[^<]*<\/a>/i, '')) ?? '';
    const upcoming = upcomingAt >= 0 && (block.index ?? 0) > upcomingAt;
    const opens = /\bopen at [^.]*?\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/i.exec(blurb);
    const closes = /\bclose[^.]*?\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/i.exec(blurb);
    rounds.push({ path, title, upcoming, blurb, openingDate: isoDate(opens?.[0]), closingDate: isoDate(closes?.[0], true) });
  }
  return rounds;
}

/** Status and dates come from the portal's own list, so they are deterministic and never model-derived. */
export function roundToDocument(portal: { slug: string; funder: string }, round: PortalRound, roundPageHtml: string | null, now = new Date()): GrantDocument {
  if (!SLUG.test(portal.slug)) throw new Error(`Invalid SmartyGrants portal slug: ${portal.slug}`);
  if (!PATH.test(round.path) || RESERVED_PATH.test(round.path)) throw new Error(`Invalid SmartyGrants round path: ${round.path}`);
  const url = `https://${portal.slug}.smartygrants.com.au${round.path}`;
  const source: CuratedSource = {
    url,
    issuingAgency: portal.funder,
    assistanceType: 'Grant',
    categories: [],
    applicantTypes: [],
    sourceLabel: `SmartyGrants (${portal.funder})`,
  };
  const open = !round.upcoming && /now open|now being accepted/i.test(round.blurb);
  const status = round.upcoming ? 'Upcoming' : open ? 'Open' : null;
  return baseDocument(pageId('sg', url), source, {
    title: round.title,
    summary: round.blurb,
    eligibility: roundPageHtml ? pageText(roundPageHtml) : round.blurb,
    status,
    isOpen: computeIsOpen(status, round.closingDate, now),
    openingDate: round.openingDate,
    closingDate: round.closingDate,
    deliveredBy: portal.funder,
  });
}

export async function fetchSmartyGrants(opts: PageOptions & { portals?: typeof SMARTYGRANTS_PORTALS } = {}) {
  const log = opts.log ?? console.log;
  const jobs: { portal: (typeof SMARTYGRANTS_PORTALS)[number]; round: PortalRound }[] = [];
  for (const portal of opts.portals ?? SMARTYGRANTS_PORTALS) {
    if (!SLUG.test(portal.slug)) throw new Error(`Invalid SmartyGrants portal slug: ${portal.slug}`);
    try {
      const home = await getHtml(`https://${portal.slug}.smartygrants.com.au/`, opts.fetcher, opts.signal);
      for (const round of parsePortalRounds(home)) jobs.push({ portal, round });
    } catch (error) {
      throw new Error(`SmartyGrants portal ${portal.slug} failed`, { cause: error });
    }
  }
  const results = await mapLimit(jobs, opts.concurrency ?? 4, async ({ portal, round }) => {
    const html = await getHtml(`https://${portal.slug}.smartygrants.com.au${round.path}`, opts.fetcher, opts.signal).catch((error: unknown) => {
      opts.signal?.throwIfAborted();
      log(`SmartyGrants round ${portal.slug}${round.path}: using listing only after page fetch failed: ${error instanceof Error ? error.message : error}`);
      return null;
    });
    const doc = roundToDocument(portal, round, html, opts.now);
    // Status and dates are deterministic; no model call, which also keeps the sync inside its time limit.
    return doc;
  });
  const documents = results.filter((d, i) => results.findIndex((o) => o.id === d.id) === i);
  return { fetched: results.length, documents, duplicatesRemoved: results.length - documents.length };
}
