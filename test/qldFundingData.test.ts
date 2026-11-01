import { describe, expect, it } from 'vitest';
import { fetchQldFundingData, normalizeFundingRow } from '../src/lib/qldFundingData.js';

const dataset = {
  id: 'public-dataset', title: 'Current funding', metadata_modified: '2026-10-28T12:00:00Z',
  license_url: 'https://creativecommons.org/licenses/by/4.0/',
  resources: [{ id: 'resource-1', name: 'Current Program Funding', format: 'CSV', datastore_active: true }],
};
const row = {
  'Service ID': 65001, 'Program title': 'Recovery grant', 'Sub-program title': 'Round 2',
  Purpose: 'Support recovery', 'Funding agency': 'Agency', Eligibility: 'Check the guidelines.',
  'Category1': 'Community', 'Applicant type1': 'Business', 'Client group1': 'Businesses',
  'Business specific activity1': 'Disaster relief', 'Assistance type1': 'Grant',
  Status: 'Open', 'Opening date (date format)': '01/01/2026', 'Closing date (date format)': '31/12/2026',
  'Opening date (text)': 'Applications open annually', 'Closing date (text)': 'Until funds are exhausted',
  'Maximum (indicative) grant amount (dollar amount)': '0',
  'Maximum (indicative) grant amount (text)': 'Amounts vary by project',
  'Financial year budget': '100000', 'Additional budget information': 'Subject to appropriation',
  Website: 'https://www.qld.gov.au/grants', "How will I know if I'm successful?": 'By email',
};
const fields = ['Service ID', 'Program title', 'Eligibility', 'Status', 'Website'].map((id) => ({ id }));
const response = (result: unknown) => new Response(JSON.stringify({ success: true, result }));

describe('public Queensland funding data', () => {
  it('preserves funding guidance, classifications, source attribution and zero amounts without interpreting prose as dates', () => {
    const grant = normalizeFundingRow(row, dataset, new Date('2026-11-01T00:00:00Z'))!;
    expect(grant).toMatchObject({
      id: '65001', programName: 'Recovery grant', roundName: 'Round 2', title: 'Round 2 – Recovery grant',
      amount: 0, amountText: 'Amounts vary by project', closingDateText: 'Until funds are exhausted',
      financialYearBudget: '100000', additionalBudgetInformation: 'Subject to appropriation',
      applicantTypes: ['Business'], businessActivities: ['Disaster relief'], isOpen: true,
      sourceDatasetUrl: 'https://www.data.qld.gov.au/dataset/public-dataset',
      sourceUpdatedAt: dataset.metadata_modified, licenseUrl: dataset.license_url,
    });
    expect(normalizeFundingRow({ ...row, 'Maximum (indicative) grant amount (dollar amount)': null }, dataset)?.amount).toBeNull();
    expect(normalizeFundingRow({ ...row, 'Closing date (date format)': null }, dataset)?.closingDate).toBeNull();
    expect(normalizeFundingRow({ ...row, Website: 'www.mhrt.qld.gov.au' }, dataset)?.url).toBe('https://www.mhrt.qld.gov.au');
    for (const placeholder of ['-', ' – ', '—']) {
      expect(normalizeFundingRow({ ...row, 'Program title': 'BreastScreen Qld Sunshine Coast', 'Sub-program title': placeholder }, dataset))
        .toMatchObject({ title: 'BreastScreen Qld Sunshine Coast', roundName: null });
    }
    expect(normalizeFundingRow({ 'Program title': null, 'Service ID': null }, dataset)).toBeNull();
    expect(normalizeFundingRow({ 'Program title': null, 'Service ID': 65100 }, dataset)).toBeNull();
    expect(() => normalizeFundingRow({ 'Program title': null, Eligibility: 'Source evidence' }, dataset)).toThrow('no program title');
    expect(() => normalizeFundingRow({ ...row, 'Maximum (indicative) grant amount (dollar amount)': 'up to $500' }, dataset)).toThrow('amount');
  });

  it('pages the public tables and rejects an incomplete page instead of returning a partial catalogue', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      return url.pathname.endsWith('package_search')
        ? response({ count: 1, results: [dataset] })
        : response({ total: 2, fields, records: url.searchParams.get('offset') === '0' ? [row] : [{ ...row, 'Service ID': 65002 }] });
    };
    expect((await fetchQldFundingData(fetcher)).documents).toHaveLength(2);
    const incomplete: typeof fetch = async (input) => new URL(String(input)).pathname.endsWith('package_search')
      ? response({ count: 1, results: [dataset] })
      : response({ total: 2, fields, records: [] });
    await expect(fetchQldFundingData(incomplete)).rejects.toThrow('incomplete pagination');
  });

  it('rejects conflicting IDs across datasets and a changed funding table schema', async () => {
    const fetcher: typeof fetch = async (input) => new URL(String(input)).pathname.endsWith('package_search')
      ? response({ count: 2, results: [dataset, { ...dataset, id: 'second' }] })
      : response({ total: 1, fields, records: [row] });
    await expect(fetchQldFundingData(fetcher)).rejects.toThrow('Conflicting');
    const changed: typeof fetch = async (input) => new URL(String(input)).pathname.endsWith('package_search')
      ? response({ count: 1, results: [dataset] }) : response({ total: 1, fields: [], records: [row] });
    await expect(fetchQldFundingData(changed)).rejects.toThrow('schema');
  });
});
