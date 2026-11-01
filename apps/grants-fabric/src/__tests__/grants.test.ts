import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askGrants, getChat, getGrants, getGrantVersions, getReviews, importGrants, parseGrantImport, saveReview } from '@/services/grants';
import { evidenceText } from '../../rayfin/functions/src/grantFields';

const mocks = vi.hoisted(() => {
  const page = vi.fn();
  const query = {
    orderBy: vi.fn().mockReturnThis(), first: vi.fn().mockReturnThis(),
    after: vi.fn().mockReturnThis(), executePaginated: page,
  };
  return {
    query, page, create: vi.fn(), update: vi.fn(), review: vi.fn(), archive: vi.fn(), archived: vi.fn(), chat: vi.fn(), invoke: vi.fn(),
    session: { isAuthenticated: true, user: { id: 'owner-1' } },
  };
});
vi.mock('@/services/rayfinClient', () => ({
  getRayfinClient: () => ({
    auth: { getSession: () => mocks.session },
    data: {
      GrantRecord: { select: () => mocks.query, create: mocks.create, update: mocks.update },
      GrantReview: { create: mocks.review, select: () => mocks.query },
      GrantVersion: { select: () => ({ ...mocks.query, where: vi.fn().mockReturnThis(), execute: mocks.archived }), create: mocks.archive },
      ChatTurn: { select: () => mocks.query, create: mocks.chat },
    },
    functions: { askGrants: { invoke: mocks.invoke } },
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
  mocks.archived.mockReset().mockResolvedValue([]);
  mocks.archive.mockReset().mockResolvedValue(undefined);
  mocks.chat.mockReset().mockResolvedValue(undefined);
  mocks.invoke.mockReset().mockResolvedValue({ answer: 'Check the official guidelines.', sources: [{ id: existing.id, url: raw.url, title: raw.title }] });
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
    await expect(importGrants([raw, { ...raw, id: 'qld-2', eligibility: 'x'.repeat(8001) }])).rejects.toThrow('Record 2');
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
    expect(mocks.archive).not.toHaveBeenCalled();
    await importGrants([{ ...raw, contentHash: 'version-2' }]);
    expect(mocks.update).toHaveBeenCalledWith({ id: existing.id }, expect.objectContaining({ contentHash: 'version-2' }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.archive).toHaveBeenCalledWith(expect.objectContaining({
      grantId: existing.id, contentHash: 'version-1', eligibility: existing.eligibility,
      user_id: existing.user_id, archivedAt: expect.any(Date),
    }));
    expect(mocks.archive.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0]);
  });

  it('blocks overwrites when preserving the old evidence fails', async () => {
    mocks.page.mockResolvedValue({ items: [existing], hasNextPage: false });
    mocks.archive.mockRejectedValueOnce(new Error('Archive unavailable'));
    await expect(importGrants([{ ...raw, contentHash: 'version-2' }])).rejects.toThrow('Archive unavailable');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('reuses an already archived snapshot after a failed update', async () => {
    mocks.page.mockResolvedValue({ items: [existing], hasNextPage: false });
    mocks.archived.mockResolvedValue([{ ...existing, id: 'snapshot-1' }]);
    await importGrants([{ ...raw, contentHash: 'version-2' }]);
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalled();
  });

  it('loads every version and review page for reviewer tables', async () => {
    for (const read of [getGrantVersions, getReviews]) {
      mocks.page.mockResolvedValueOnce({ items: [{ id: 'first' }], hasNextPage: true, endCursor: 'more' })
        .mockResolvedValueOnce({ items: [{ id: 'second' }], hasNextPage: false });
      expect(await read()).toHaveLength(2);
      expect(mocks.query.after).toHaveBeenCalledWith('more');
      mocks.page.mockResolvedValueOnce({ items: [], hasNextPage: true });
      await expect(read()).rejects.toThrow('cursor');
    }
  });

  it('reads the full persisted chat history past the old 20-turn limit', async () => {
    mocks.page.mockResolvedValueOnce({ items: Array.from({ length: 200 }, (_, i) => ({ id: `chat-${i}` })), hasNextPage: true, endCursor: 'older' })
      .mockResolvedValueOnce({ items: [{ id: 'oldest' }], hasNextPage: false });
    expect(await getChat()).toHaveLength(201);
    expect(mocks.query.after).toHaveBeenCalledWith('older');
    mocks.page.mockResolvedValueOnce({ items: [], hasNextPage: true });
    await expect(getChat()).rejects.toThrow('Chat pagination');
  });

  it('persists complete question, answer, citations, owner and timestamp in SQL for every successful turn', async () => {
    await askGrants('What should I check?', existing.id, true);
    expect(mocks.chat).toHaveBeenCalledWith({
      user_id: 'owner-1', question: 'What should I check?', answer: 'Check the official guidelines.',
      sourcesJson: JSON.stringify([{ id: existing.id, url: raw.url, title: raw.title }]), createdAt: expect.any(Date),
    });
    mocks.chat.mockRejectedValueOnce(new Error('SQL unavailable'));
    await expect(askGrants('Another question', '', false)).rejects.toThrow('The answer could not be saved. SQL unavailable');
  });

  it('reports partial import writes without claiming success', async () => {
    mocks.create.mockResolvedValueOnce(existing).mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(importGrants([raw, { ...raw, id: 'qld-2' }])).rejects.toThrow('1/2 records');
  });

  it('preserves full page evidence, lineage and qualitative fields, including schema backfills with the same upstream hash', async () => {
    const input = {
      ...raw, eligibility: 'x'.repeat(8000), programName: 'Community program', roundName: 'Round 1',
      sourceIds: ['qld-1', 'qld-2'], applicantTypes: ['Non-profit'], fundingTypes: ['Grant'], isOpen: false,
      amountText: 'Amounts vary', closingDateText: 'Until funds are exhausted',
      sourceDatasetUrl: 'https://www.data.qld.gov.au/dataset/example',
    };
    const parsed = parseGrantImport([input])[0];
    expect(evidenceText({ ...existing, ...parsed }, 'eligibility')).toBe(input.eligibility);
    expect(parsed).toMatchObject({ eligibilityOverflow: 'x'.repeat(4000), sourceIds: 'qld-1|qld-2', isOpen: false });
    mocks.page.mockResolvedValue({ items: [existing], hasNextPage: false });
    await importGrants([input]);
    expect(mocks.archive).toHaveBeenCalledWith(expect.objectContaining({ contentHash: existing.contentHash }));
    expect(mocks.update).toHaveBeenCalledWith({ id: existing.id }, expect.objectContaining({ ...parsed, importedAt: expect.any(Date) }));
    mocks.archived.mockResolvedValue([{ ...existing, id: 'original-snapshot' }]);
    mocks.page.mockResolvedValue({ items: [{ ...existing, ...parsed }], hasNextPage: false });
    await importGrants([{ ...input, amountText: 'Check co-funding terms' }]);
    expect(mocks.archive).toHaveBeenLastCalledWith(expect.objectContaining({ amountText: 'Amounts vary', eligibilityOverflow: parsed.eligibilityOverflow }));
  });

  it('saves a new review against the current grant hash and owner', async () => {
    await saveReview(existing, 'researching', 'Check co-funding requirements.');
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({
      grantId: existing.id, contentHash: 'version-1', user_id: 'owner-1',
      decision: 'researching', notes: 'Check co-funding requirements.',
    }));
  });
});
