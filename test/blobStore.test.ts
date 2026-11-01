import type { ContainerClient } from '@azure/storage-blob';
import { describe, expect, it } from 'vitest';
import { syncGrantsToBlob } from '../src/lib/blobStore.js';
import type { GrantDocument } from '../src/lib/types.js';

interface FakeBlob { body: string; metadata: Record<string, string> }

/** Just enough of ContainerClient for syncGrantsToBlob. */
function fakeContainer(name = 'grants') {
  const blobs = new Map<string, FakeBlob>();
  const failUpload = new Set<string>();
  const container = {
    url: `https://example.blob.core.windows.net/${name}`,
    createIfNotExists: async () => ({}),
    async *listBlobsFlat(opts: { prefix?: string } = {}) {
      for (const [name, b] of blobs) if (!opts.prefix || name.startsWith(opts.prefix)) yield { name, metadata: { ...b.metadata } };
    },
    getBlockBlobClient: (name: string) => ({
      upload: async (body: string, _len: number, opts: { metadata: Record<string, string>; conditions?: { ifNoneMatch?: string } }) => {
        if (failUpload.delete(name)) throw new Error('Simulated upload failure');
        if (opts.conditions?.ifNoneMatch === '*' && blobs.has(name)) throw new Error('Immutable revision already exists');
        blobs.set(name, { body, metadata: opts.metadata });
      },
      downloadToBuffer: async () => Buffer.from(blobs.get(name)!.body),
      setMetadata: async (metadata: Record<string, string>) => {
        blobs.get(name)!.metadata = metadata;
      },
      deleteIfExists: async () => blobs.delete(name),
    }),
  };
  return { blobs, failUpload, container: container as unknown as ContainerClient };
}

const doc = (id: string, contentHash: string) => ({ id, contentHash, title: `Grant ${id}` }) as GrantDocument;

describe('syncGrantsToBlob', () => {
  it('rejects invalid concurrency and duplicate IDs before any mutation', async () => {
    const { blobs, container } = fakeContainer();
    await expect(syncGrantsToBlob(container, [doc('1', 'a')], { concurrency: 0 })).rejects.toThrow(/Concurrency/);
    await expect(syncGrantsToBlob(container, [doc('1', 'a'), doc('1', 'b')])).rejects.toThrow(/duplicate/);
    expect(blobs.size).toBe(0);
  });

  it('automatically versions changes, removals and restorations, without versioning quiet syncs', async () => {
    const { blobs, container } = fakeContainer();
    const history = fakeContainer('grants-history');
    const options = { historyContainer: history.container, now: new Date('2026-01-01T00:00:00Z') };
    await syncGrantsToBlob(container, [doc('1', 'a')], options);
    const first = history.blobs.get('1/000001.json')!.body;
    await syncGrantsToBlob(container, [doc('1', 'a')], options);
    expect(history.blobs.size).toBe(1);
    await syncGrantsToBlob(container, [doc('1', 'b')], options);
    await syncGrantsToBlob(container, [], options);
    await syncGrantsToBlob(container, [doc('1', 'b')], options);
    const revisions = [...history.blobs.values()].map((b) => JSON.parse(b.body));
    expect(revisions.map((r) => [r.revision, r.event, r.deleted])).toEqual([
      [1, 'created', false], [2, 'updated', false], [3, 'removed', true], [4, 'restored', false],
    ]);
    expect(history.blobs.get('1/000001.json')!.body).toBe(first);
    expect(JSON.parse(blobs.get('1.json')!.body).revision).toBe(4);
    expect(blobs.get('1.json')!.metadata.revision).toBe('4');
  });

  it('automatically baselines existing grants before overwriting them', async () => {
    const { blobs, container } = fakeContainer();
    const history = fakeContainer('grants-history');
    await syncGrantsToBlob(container, [doc('1', 'old'), doc('2', 'quiet')]);
    const lastChangedAt = JSON.parse(blobs.get('2.json')!.body).lastChangedAt;
    await syncGrantsToBlob(container, [doc('1', 'new'), doc('2', 'quiet')], { historyContainer: history.container });
    expect(JSON.parse(history.blobs.get('1/000001.json')!.body)).toMatchObject({ event: 'baseline', grant: { contentHash: 'old' } });
    expect(JSON.parse(history.blobs.get('1/000002.json')!.body)).toMatchObject({ event: 'updated', grant: { contentHash: 'new' } });
    expect(JSON.parse(blobs.get('2.json')!.body)).toMatchObject({ revision: 1, lastChangedAt });
  });

  it('retains history through purging and continues version numbers on restoration', async () => {
    const { blobs, container } = fakeContainer();
    const history = fakeContainer('grants-history');
    const options = { historyContainer: history.container, now: new Date('2026-01-01T00:00:00Z') };
    await syncGrantsToBlob(container, [doc('1', 'a')], options);
    await syncGrantsToBlob(container, [], options);
    await syncGrantsToBlob(container, [], { ...options, now: new Date('2026-03-01T00:00:00Z') });
    expect(blobs.size).toBe(0);
    expect(history.blobs.size).toBe(2);
    await syncGrantsToBlob(container, [doc('1', 'a')], options);
    expect(JSON.parse(history.blobs.get('1/000003.json')!.body).event).toBe('restored');
    expect(blobs.get('1.json')!.metadata.revision).toBe('3');
  });

  it('does not overwrite current grants when archiving fails, and retries a failed staging write idempotently', async () => {
    const { blobs, container, failUpload } = fakeContainer();
    const history = fakeContainer('grants-history');
    const options = { historyContainer: history.container };
    await syncGrantsToBlob(container, [doc('1', 'a')], options);
    history.failUpload.add('1/000002.json');
    await expect(syncGrantsToBlob(container, [doc('1', 'b')], options)).rejects.toThrow(/upload failure/);
    expect(blobs.get('1.json')!.metadata.contenthash).toBe('a');
    failUpload.add('1.json');
    await expect(syncGrantsToBlob(container, [doc('1', 'b')], options)).rejects.toThrow(/upload failure/);
    const archived = history.blobs.get('1/000002.json')!.body;
    await syncGrantsToBlob(container, [doc('1', 'b')], options);
    expect(history.blobs.size).toBe(2);
    expect(history.blobs.get('1/000002.json')!.body).toBe(archived);
    expect(blobs.get('1.json')!.metadata.revision).toBe('2');
  });

  it('preserves failed-page records without blocking deletion of genuinely removed grants', async () => {
    const { blobs, container } = fakeContainer();
    await syncGrantsToBlob(container, [doc('failed', 'a'), doc('removed', 'b'), doc('deleted-failed', 'c')], {
      now: new Date('2026-01-01T00:00:00Z'),
    });
    await syncGrantsToBlob(container, [doc('failed', 'a'), doc('removed', 'b')], {
      now: new Date('2026-01-02T00:00:00Z'),
    });
    const stats = await syncGrantsToBlob(container, [], {
      now: new Date('2026-03-01T00:00:00Z'),
      preserveIds: ['failed', 'deleted-failed'],
    });
    expect(stats).toMatchObject({ softDeleted: 1, purged: 0 });
    expect(blobs.get('failed.json')!.metadata.IsDeleted).toBe('false');
    expect(blobs.get('removed.json')!.metadata.IsDeleted).toBe('true');
    expect(blobs.has('deleted-failed.json')).toBe(true);
  });

  it('writes only new/changed grants, soft-deletes removed ones and purges after retention', async () => {
    const { blobs, container } = fakeContainer();
    const t0 = new Date('2026-01-01T00:00:00Z');

    expect(await syncGrantsToBlob(container, [doc('1', 'a'), doc('2', 'b')], { now: t0 }))
      .toEqual({ created: 2, updated: 0, unchanged: 0, softDeleted: 0, purged: 0 });
    expect(JSON.parse(blobs.get('1.json')!.body).lastChangedAt).toBe(t0.toISOString());

    const t1 = new Date('2026-01-08T00:00:00Z');
    expect(await syncGrantsToBlob(container, [doc('1', 'a'), doc('3', 'c')], { now: t1 }))
      .toEqual({ created: 1, updated: 0, unchanged: 1, softDeleted: 1, purged: 0 });
    expect(blobs.get('2.json')!.metadata.IsDeleted).toBe('true');
    expect(JSON.parse(blobs.get('1.json')!.body).lastChangedAt).toBe(t0.toISOString());

    const t2 = new Date('2026-01-15T00:00:00Z');
    expect(await syncGrantsToBlob(container, [doc('1', 'a2'), doc('2', 'b'), doc('3', 'c')], { now: t2 }))
      .toEqual({ created: 0, updated: 2, unchanged: 1, softDeleted: 0, purged: 0 });
    expect(blobs.get('2.json')!.metadata.IsDeleted).toBe('false');

    await syncGrantsToBlob(container, [doc('1', 'a2')], { now: t2 });
    const t3 = new Date('2026-03-01T00:00:00Z');
    expect(await syncGrantsToBlob(container, [doc('1', 'a2')], { now: t3, retentionDays: 30 }))
      .toMatchObject({ unchanged: 1, purged: 2 });
    expect([...blobs.keys()]).toEqual(['1.json']);
  });
});
