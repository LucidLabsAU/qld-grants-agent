import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getGrants, importGrants, parseGrantImport, saveReview } from '@/services/grants';

const mocks = vi.hoisted(() => {
  const page = vi.fn();
  const query = {
    orderBy: vi.fn().mockReturnThis(), first: vi.fn().mockReturnThis(),
    after: vi.fn().mockReturnThis(), executePaginated: page,
  };
  return {
    query, page, create: vi.fn(), update: vi.fn(), review: vi.fn(),
    session: { isAuthenticated: true, user: { id: 'owner-1' } },
  };
});
vi.mock('@/services/rayfinClient', () => ({
  getRayfinClient: () => ({
    auth: { getSession: () => mocks.session },
    data: {
      GrantRecord: { select: () => mocks.query, create: mocks.create, update: mocks.update },
      GrantReview: { create: mocks.review },
    },
  }),
}));

const raw = {
  id: 'qld-1', source: 'qld', title: 'Community funding', summary: null, eligibility: 'Read the guidelines.',
  howToApply: null, url: 'https://www.qld.gov.au/grants', status: 'Open', closingDate: null, openingDate: null,
  amount: 0, jurisdictions: ['Queensland'], categories: ['Community'], contentHash: 'version-1',
};
const existing = { ...parseGrantImport([raw])[0], id: '00000000-0000-4000-8000-000000000001', user_id: 'owner-1', active: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.page.mockReset().mockResolvedValue({ items: [], hasNextPage: false });
  mocks.create.mockReset().mockResolvedValue(existing);
  mocks.update.mockReset().mockResolvedValue(undefined);
});

describe('grant import and persistence', () => {
  it('preserves unknown amounts separately from zero and validates URLs and dates', () => {
    expect(parseGrantImport([raw])[0].amount).toBe('0');
    expect(parseGrantImport([{ ...raw, amount: null }])[0].amount).toBe('');
    expect(() => parseGrantImport([{ ...raw, url: 'javascript:alert(1)' }])).toThrow('URL');
    expect(() => parseGrantImport([{ ...raw, closingDate: 'not a date' }])).toThrow('date');
  });

  it('rejects duplicate or oversized records before writing anything', async () => {
    await expect(importGrants([raw, raw])).rejects.toThrow('Duplicate');
    await expect(importGrants([raw, { ...raw, id: 'qld-2', eligibility: 'x'.repeat(4001) }])).rejects.toThrow('Record 2');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('reads later pages and refuses an incomplete continuation', async () => {
    mocks.page.mockResolvedValueOnce({ items: [existing], hasNextPage: true, endCursor: 'next' })
      .mockResolvedValueOnce({ items: [{ ...existing, id: 'second' }], hasNextPage: false });
    expect(await getGrants()).toHaveLength(2);
    expect(mocks.query.after).toHaveBeenCalledWith('next');
    mocks.page.mockResolvedValueOnce({ items: [], hasNextPage: true });
    await expect(getGrants()).rejects.toThrow('cursor');
  });

  it('keeps grant IDs stable and skips unchanged versions', async () => {
    mocks.page.mockResolvedValue({ items: [existing], hasNextPage: false });
    await importGrants([raw]);
    expect(mocks.update).not.toHaveBeenCalled();
    await importGrants([{ ...raw, contentHash: 'version-2' }]);
    expect(mocks.update).toHaveBeenCalledWith({ id: existing.id }, expect.objectContaining({ contentHash: 'version-2' }));
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('reports partial import writes without claiming success', async () => {
    mocks.create.mockResolvedValueOnce(existing).mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(importGrants([raw, { ...raw, id: 'qld-2' }])).rejects.toThrow('1/2 records');
  });

  it('saves a new review against the current grant hash and owner', async () => {
    await saveReview(existing, 'researching', 'Check co-funding requirements.');
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({
      grantId: existing.id, contentHash: 'version-1', user_id: 'owner-1',
      decision: 'researching', notes: 'Check co-funding requirements.',
    }));
  });
});
