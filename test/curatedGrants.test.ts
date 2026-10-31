import { describe, expect, it, vi } from 'vitest';
import { fetchCuratedGrants, parseCuratedPage } from '../src/lib/curatedGrants.js';
import type { CuratedSource } from '../src/lib/curatedSources.js';

const source: CuratedSource = {
  url: 'https://www.example.qld.gov.au/program/first-start',
  issuingAgency: 'Example Agency',
  assistanceType: 'Loan',
  categories: ['Agriculture'],
  applicantTypes: ['Business'],
};
const body = 'Concessional finance helps new primary producers establish a business. '.repeat(5);
const page = `<html><head><meta name="description" content="Short &amp; sweet summary."/></head>
  <body><nav>Menu</nav><main><h1>First Start <em>Loan</em></h1><p>${body}</p><script>alert(1)</script></main><footer>Footer</footer></body></html>`;

describe('curated official program pages', () => {
  it('maps a page to a stable, unknown-status document', () => {
    const doc = parseCuratedPage(page, source);
    expect(doc).toMatchObject({
      title: 'First Start Loan',
      summary: 'Short & sweet summary.',
      status: null,
      isOpen: false,
      issuingAgency: 'Example Agency',
      assistanceType: 'Loan',
      url: source.url,
    });
    expect(doc.eligibility).not.toMatch(/Menu|Footer|alert/);
    expect(doc.id).toBe(parseCuratedPage(page, source).id);
    expect(doc.id).toMatch(/^cur-[0-9a-f]{16}$/);
  });

  it('drops a visually hidden "Page title" prefix from headings', () => {
    const html = page.replace('<h1>First Start <em>Loan</em></h1>', '<h1><span>Page title </span>\nFirst Start Loan</h1>');
    expect(parseCuratedPage(html, source).title).toBe('First Start Loan');
  });

  it('rejects pages whose structure is unrecognised', () => {
    expect(() => parseCuratedPage('<main><h1>Moved</h1></main>', source)).toThrow(/Unrecognised page structure/);
  });

  it('fails loudly on HTTP errors rather than dropping a program', async () => {
    const fetcher = vi.fn(async () => new Response('gone', { status: 404 })) as unknown as typeof fetch;
    await expect(fetchCuratedGrants([source], { fetcher })).rejects.toThrow(/HTTP 404/);
  });
});
