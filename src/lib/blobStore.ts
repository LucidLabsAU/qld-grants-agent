import type { ContainerClient } from '@azure/storage-blob';
import type { GrantDocument } from './types.js';

/** Blob metadata used by the indexer (soft delete) and by the sync (change detection). */
export const META = {
  contentHash: 'contenthash',
  isDeleted: 'IsDeleted',
  deletedAt: 'deletedat',
} as const;

export interface BlobSyncStats {
  created: number;
  updated: number;
  unchanged: number;
  softDeleted: number;
  purged: number;
}

interface ExistingBlob {
  name: string;
  contentHash?: string;
  isDeleted: boolean;
  deletedAt?: string;
}

const blobName = (id: string) => `${id}.json`;

/** Metadata keys come back lower-cased from some APIs, so read case-insensitively. */
function readMeta(metadata: Record<string, string> | undefined, key: string): string | undefined {
  if (!metadata) return undefined;
  const hit = Object.keys(metadata).find((k) => k.toLowerCase() === key.toLowerCase());
  return hit ? metadata[hit] : undefined;
}

async function listExisting(container: ContainerClient): Promise<Map<string, ExistingBlob>> {
  const existing = new Map<string, ExistingBlob>();
  for await (const blob of container.listBlobsFlat({ includeMetadata: true })) {
    existing.set(blob.name, {
      name: blob.name,
      contentHash: readMeta(blob.metadata, META.contentHash),
      isDeleted: readMeta(blob.metadata, META.isDeleted) === 'true',
      deletedAt: readMeta(blob.metadata, META.deletedAt),
    });
  }
  return existing;
}

async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  });
  await Promise.all(workers);
}

/**
 * Makes the blob container mirror the current set of grants:
 * - writes a blob only when its content hash changed (so the indexer re-embeds only changed grants),
 * - soft-deletes blobs whose grant disappeared (the indexer then removes it from the index),
 * - purges soft-deleted blobs after the retention period.
 */
export async function syncGrantsToBlob(
  container: ContainerClient,
  docs: GrantDocument[],
  { now = new Date(), retentionDays = 30, concurrency = 16, preserveIds = [] }: {
    now?: Date;
    retentionDays?: number;
    concurrency?: number;
    preserveIds?: string[];
  } = {},
): Promise<BlobSyncStats> {
  await container.createIfNotExists();
  const existing = await listExisting(container);
  const stats: BlobSyncStats = { created: 0, updated: 0, unchanged: 0, softDeleted: 0, purged: 0 };
  const nowIso = now.toISOString();

  const writes = docs.filter((doc) => {
    const current = existing.get(blobName(doc.id));
    if (current && !current.isDeleted && current.contentHash === doc.contentHash) {
      stats.unchanged++;
      return false;
    }
    if (current) stats.updated++;
    else stats.created++;
    return true;
  });

  await runLimited(writes, concurrency, async (doc) => {
    const body = JSON.stringify({ ...doc, lastChangedAt: nowIso });
    await container.getBlockBlobClient(blobName(doc.id)).upload(body, Buffer.byteLength(body), {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      metadata: { [META.contentHash]: doc.contentHash, [META.isDeleted]: 'false' },
    });
  });

  const liveNames = new Set(docs.map((d) => blobName(d.id)));
  for (const id of preserveIds) liveNames.add(blobName(id));
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const stale = [...existing.values()].filter((b) => !liveNames.has(b.name));

  await runLimited(stale, concurrency, async (blob) => {
    const client = container.getBlockBlobClient(blob.name);
    if (!blob.isDeleted) {
      await client.setMetadata({
        [META.contentHash]: blob.contentHash ?? '',
        [META.isDeleted]: 'true',
        [META.deletedAt]: nowIso,
      });
      stats.softDeleted++;
    } else if (blob.deletedAt && now.getTime() - new Date(blob.deletedAt).getTime() > retentionMs) {
      await client.deleteIfExists();
      stats.purged++;
    }
  });

  return stats;
}
