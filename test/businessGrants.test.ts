import { describe, expect, it, vi } from 'vitest';
import { fetchBusinessGrants, parseBusinessPage, type BusinessResult } from '../src/lib/businessClient.js';
import { normalizeBusinessGrant, normalizeBusinessGrants, plain } from '../src/lib/businessGrants.js';

const HTML = `<div class="search-connection" data-organizationId="departmentofindustryscienceenergyandresourcesproduxlo9oz8e" data-searchKey="public-key"></div>
  <div id="grantsInterface" data-cq="(@z95xtemplate==grant)"></div>`;
const raw = (extra: Record<string, unknown> = {}): BusinessResult => ({
  title: 'Support for exporters',
  raw: {
    z95xid: 'ABCD1234ABCD1234ABCD1234ABCD1234',
    ctitle: 'Support for exporters',
    curl: '/grants-and-programs/support-for-exporters',
    cloc: ['Queensland', 'New South Wales'],
    cgs: 'Open',
    closez32xdate: Date.parse('2026-09-29T14:00:00Z'),
    noz32xclosez32xtime: '1',
    csearchcarddescription: '<p>Funding &amp; advice for <strong>exporters</strong>.</p>',
    fapplyz32xsection28333: '<p>Must hold an ABN.</p>',
    cst: 'Funding',
    cbt: ['Company', 'Company'],
    ...extra,
  },
});

describe('business.gov.au grants', () => {
  it('reads only the public search configuration without storing the key', () => {
    expect(parseBusinessPage(HTML)).toEqual({
      key: 'public-key',
      cq: '(@z95xtemplate==grant) (@z95xlanguage==en) (@z95xlatestversion==1) (@source=="Coveo_web_index - BGA Prod Environment")',
    });
    expect(() => parseBusinessPage(HTML.replace('data-searchKey', 'data-other'))).toThrow(/data-searchKey/);
  });

  it('pages through a complete snapshot using the site query and scope', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      !init?.body ? new Response(HTML) : Response.json({
        totalCount: 3,
        results: init.body && JSON.parse(String(init.body)).firstResult === 0
          ? [raw(), raw({ z95xid: '22222222222222222222222222222222' })]
          : [raw({ z95xid: '33333333333333333333333333333333' })],
      }));
    const snapshot = await fetchBusinessGrants(fetcher as typeof fetch);
    expect(snapshot.results).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const request = JSON.parse(String(fetcher.mock.calls[1]![1]?.body));
    expect(request.cq).toContain('@z95xlatestversion==1');
    expect(request.firstResult).toBe(0);
    expect(JSON.parse(String(fetcher.mock.calls[2]![1]?.body)).firstResult).toBe(2);
    expect(fetcher.mock.calls[1]![1]?.headers).toMatchObject({ Authorization: 'Bearer public-key' });
  });

  it('fails rather than soft-deleting records when the feed changes mid-pagination', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      !init?.body ? new Response(HTML) : Response.json({
        totalCount: JSON.parse(String(init.body)).firstResult ? 4 : 3,
        results: JSON.parse(String(init.body)).firstResult ? [raw()] : [raw(), raw()],
      }));
    await expect(fetchBusinessGrants(fetcher as typeof fetch)).rejects.toThrow(/partial snapshot/);
  });

  it('normalizes location, URLs, HTML, dates, and stable source-prefixed ids', () => {
    const doc = normalizeBusinessGrant(raw(), new Date('2026-09-30T02:00:00Z'));
    expect(doc).toMatchObject({
      id: 'bga-abcd1234abcd1234abcd1234abcd1234',
      source: 'business.gov.au',
      jurisdictions: ['New South Wales', 'Queensland'],
      url: 'https://business.gov.au/grants-and-programs/support-for-exporters',
      summary: 'Funding & advice for exporters.',
      eligibility: 'Must hold an ABN.',
      closingDate: '2026-09-30T13:59:59.999Z',
      isOpen: true,
      applicantTypes: ['Company'],
    });
    expect(doc.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(normalizeBusinessGrant(raw({ cgs: 'Closed' })).isOpen).toBe(false);
    expect(normalizeBusinessGrants([raw(), raw({ csearchcarddescription: 'x' })]).duplicatesRemoved).toBe(1);
    expect(() => normalizeBusinessGrant(raw({ curl: 'https://example.com/evil' }))).toThrow(/identity or URL/);
  });

  it('decodes malformed numeric entities without crashing a feed sync', () => {
    expect(plain('Help &#99999999; &#xD800; &amp; &#65;')).toBe('Help \uFFFD \uFFFD & A');
  });
});
