import { fetchPages, getHtml, type PageOptions } from './curatedGrants.js';
import type { CuratedSource } from './curatedSources.js';

const SITEMAP = 'https://www.business.qld.gov.au/sitemap.xml';
const MAX_PAGES = 40;
const FUNDING_PATH = /\/(grants?|grant-programs?|funding|funding-support|grants-support|rebates?|financial-assistance)(\/|$)/;
const EXCLUDED = /thank-you|checklist|subsidiary|nested|expression-of-interest|design-files|\/test|\/dev|\/404|workshops|officers|prepare-write-application|transcript|making-changes|\/review$|finding-grants-support|\/closed$/;

/** Comparison key for a program URL: lower-case host and path without query, hash or trailing slash. */
export const urlKey = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

/** Funding-related Business Queensland URLs from the sitemap that no other source already links to. */
export function selectFundingUrls(sitemapXml: string, known: Set<string>): string[] {
  return [...sitemapXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .map((m) => m[1]!)
    .filter((url) => {
      try {
        const { hostname, pathname, protocol } = new URL(url);
        return protocol === 'https:' && hostname === 'www.business.qld.gov.au'
          && FUNDING_PATH.test(pathname) && !EXCLUDED.test(pathname);
      } catch {
        return false;
      }
    })
    .filter((url) => !known.has(urlKey(url)))
    .sort()
    .slice(0, MAX_PAGES);
}

/** Finds funding pages on Business Queensland that the Grants Finder and business.gov.au do not link to. */
export async function fetchBusinessQldPages(known: Set<string>, opts: PageOptions = {}) {
  const xml = await getHtml(SITEMAP, opts.fetcher, opts.signal);
  if (!/<urlset\b/i.test(xml) || !/<loc>/.test(xml)) {
    throw new Error('Business Queensland sitemap markup not recognised; refusing an unsafe snapshot');
  }
  const urls = [...new Set(selectFundingUrls(xml, known))];
  const sources: CuratedSource[] = urls.map((url) => ({
    url,
    issuingAgency: 'Business Queensland',
    assistanceType: null,
    categories: [],
    applicantTypes: [],
    sourceLabel: 'Business Queensland (discovered page)',
  }));
  return fetchPages(sources, { ...opts, idPrefix: 'bq', tolerant: true, concurrency: opts.concurrency ?? 4 });
}
