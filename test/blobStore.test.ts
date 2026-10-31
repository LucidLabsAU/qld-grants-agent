import type { ContainerClient } from '@azure/storage-blob';
import { describe, expect, it } from 'vitest';
import { syncGrantsToBlob } from '../src/lib/blobStore.js';
import type { GrantDocument } from '../src/lib/types.js';

interface FakeBlob { body: string; metadata: Record<string, string> }

/** Just enough of ContainerClient for syncGrantsToBlob. */
function fakeContainer() {
  const blobs = new Map<string, FakeBlob>();
  const container = {
    createIfNotExists: async () => ({}),
    async *listBlobsFlat() {
      for (const [name, b] of blobs) yield { name, metadata: { ...b.metadata } };
    },
    getBlockBlobClient: (name: string) => ({
      upload: async (body: string, _len: number, opts: { metadata: Record<string, string> }) => {
        blobs.set(name, { body, metadata: opts.metadata });
      },
      setMetadata: async (metadata: Record<string, string>) => {
        blobs.get(name)!.metadata = metadata;
      },
      deleteIfExists: async () => blobs.delete(name),
    }),
  };
  return { blobs, container: container as unknown as ContainerClient };
}

const doc = (id: string, contentHash: string) => ({ id, contentHash, title: `Grant ${id}` }) as GrantDocument;

describe('syncGrantsToBlob', () => {
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
