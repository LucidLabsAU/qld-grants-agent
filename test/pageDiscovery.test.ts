import { describe, expect, it, vi } from 'vitest';
import { selectFundingUrls, urlKey, fetchBusinessQldPages } from '../src/lib/businessQldDiscovery.js';
import { fetchSmartyGrants, parsePortalRounds, roundToDocument } from '../src/lib/smartyGrants.js';

const B = 'https://www.business.qld.gov.au';
const sitemap = ['/running-business/support-services/financial/grants/growth-fund',
  '/running-business/support-services/financial/grants/growth-fund/thank-you',
  '/running-business/support-services/financial/grants/prepare-write-application/writing',
  '/industries/hospitality/liquor/checklists/subsidiary-on-premises-meals',
  '/industries/manufacturing/grant-programs/ai-uplift',
  '/running-business/starting-business/licences',
].map((p) => `<url><loc>${B}${p}</loc></url>`).join('')
  + '<url><loc>https://evil.example/grants/x</loc></url>';

describe('Business Queensland discovery', () => {
  it('selects funding pages, excluding guidance, noise, other hosts and known URLs', () => {
    expect(selectFundingUrls(sitemap, new Set())).toEqual([
      `${B}/industries/manufacturing/grant-programs/ai-uplift`,
      `${B}/running-business/support-services/financial/grants/growth-fund`,
    ]);
    expect(selectFundingUrls(sitemap, new Set([urlKey(`${B}/running-business/support-services/financial/grants/growth-fund/`)]))).toHaveLength(1);
  });

  it('skips pages that fail rather than failing the run', async () => {
    const body = '<main><h1>AI Uplift</h1><p>' + 'Funding for manufacturers to adopt AI tools. '.repeat(10) + '</p></main>';
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('sitemap.xml')) return new Response(sitemap);
      return u.includes('ai-uplift') ? new Response(body) : new Response('no', { status: 500 });
    }) as unknown as typeof fetch;
    const result = await fetchBusinessQldPages(new Set(), { fetcher, log: () => {} });
    expect(result.documents.map((d) => d.title)).toEqual(['AI Uplift']);
    expect(result.documents[0].id).toMatch(/^bq-/);
    expect(result.failedIds).toHaveLength(1);
    expect(result.failedIds[0]).toMatch(/^bq-/);
  });
});

const HOME = `<h2 id="sgCurrentRounds">Current Rounds</h2>
<div class="chooseform"><h3><a href="/ENV26-27">Environment Grants 2026-2027</a></h3><div class="sg-indent">
<div>Submissions are now open.</div><div>Submissions close midnight (end of day) 2 November 2026 (AEST).</div>
<div><a href="/ENV26-27">Find out more about Environment Grants...</a></div></div></div>
<div class="chooseformheader"><h2 id="sgUpcomingRounds">Upcoming Rounds</h2></div>
<div class="chooseform"><h3><a href="/CCA27">Conservation 2027</a></h3><div class="sg-indent">
<div>Submissions will open at 8:00am 25 January 2027 (AEST).</div><div>Submissions close midnight (end of day) 26 February 2027 (AEST).</div></div></div>
<div class="chooseform"><h3><a href="//evil.example/x">Bad</a></h3></div>`;

describe('SmartyGrants portals', () => {
  it('reads status and dates deterministically from the portal list', () => {
    const rounds = parsePortalRounds(HOME);
    expect(rounds.map((r) => [r.path, r.upcoming, r.openingDate, r.closingDate])).toEqual([
      ['/ENV26-27', false, null, '2026-11-02T00:00:00+10:00'],
      ['/CCA27', true, '2027-01-25T00:00:00+10:00', '2027-02-26T00:00:00+10:00'],
    ]);
    expect(() => parsePortalRounds('<html></html>')).toThrow(/not recognised/);
  });

  it('keeps section headings and trailing portal content out of round descriptions', () => {
    const html = HOME.replace(/<div class="chooseform"><h3><a href="\/\/evil[\s\S]*$/, '<footer>Website footer</footer>');
    const rounds = parsePortalRounds(html);
    expect(rounds).toHaveLength(2);
    expect(rounds[0].blurb).not.toContain('Upcoming Rounds');
    expect(rounds[1].blurb).not.toContain('Website footer');
    expect(() => parsePortalRounds(html.slice(0, html.indexOf('<div>Submissions')))).toThrow(/round markup not recognised/);
  });

  it('builds documents with status, funder and no application-form access', async () => {
    const doc = roundToDocument({ slug: 'brisbane', funder: 'Brisbane City Council' }, parsePortalRounds(HOME)[0], null);
    expect(doc).toMatchObject({ status: 'Open', url: 'https://brisbane.smartygrants.com.au/ENV26-27', source: 'SmartyGrants (Brisbane City Council)' });
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      new Response(String(url).endsWith('.com.au/') ? HOME : '<main>round</main>')) as unknown as typeof fetch;
    const result = await fetchSmartyGrants({ fetcher, portals: [{ slug: 'brisbane', funder: 'Brisbane City Council' }], log: () => {} });
    expect(result.documents).toHaveLength(2);
    expect(vi.mocked(fetcher).mock.calls.every(([u]) => !/applicant|\/start|special/.test(String(u)))).toBe(true);
  });

  it('computes availability using the end of the Queensland closing day', () => {
    const portal = { slug: 'brisbane', funder: 'Brisbane City Council' };
    const round = parsePortalRounds(HOME)[0];
    expect(roundToDocument(portal, round, null, new Date('2026-11-02T23:59:00+10:00')).isOpen).toBe(true);
    expect(roundToDocument(portal, round, null, new Date('2026-11-03T00:00:00+10:00')).isOpen).toBe(false);
    expect(roundToDocument(portal, parsePortalRounds(HOME)[1], null, new Date('2026-11-01T00:00:00+10:00')).isOpen).toBe(false);
  });

  it('rejects a failed portal snapshot rather than removing its existing grants', async () => {
    const fetcher = vi.fn(async () => new Response('unavailable', { status: 503 })) as unknown as typeof fetch;
    await expect(fetchSmartyGrants({
      fetcher,
      portals: [{ slug: 'brisbane', funder: 'Brisbane City Council' }],
    })).rejects.toThrow('SmartyGrants portal brisbane failed');
  });

  it('logs round-page failures and retains the public listing', async () => {
    const log = vi.fn();
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('.com.au/') ? new Response(HOME) : new Response('unavailable', { status: 503 })) as unknown as typeof fetch;
    const result = await fetchSmartyGrants({
      fetcher,
      log,
      portals: [{ slug: 'brisbane', funder: 'Brisbane City Council' }],
    });
    expect(result.documents).toHaveLength(2);
    expect(result.documents[0].eligibility).toBe(parsePortalRounds(HOME)[0].blurb);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('using listing only after page fetch failed'));
  });
});
