import type { ContainerClient } from '@azure/storage-blob';
import type { GrantDocument } from './types.js';
import { mapLimit } from './concurrency.js';
import { recordGrantRevision } from './grantHistory.js';

/** Blob metadata used by the indexer (soft delete) and by the sync (change detection). */
export const META = {
  contentHash: 'contenthash',
  isDeleted: 'IsDeleted',
  deletedAt: 'deletedat',
  revision: 'revision',
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
  contentHash: string | undefined;
  isDeleted: boolean;
  deletedAt: string | undefined;
  revision: number | undefined;
}

const blobName = (id: string) => `${id}.json`;

/** Metadata keys come back lower-cased from some APIs, so read case-insensitively. */
function readMeta(metadata: Record<string, string> | undefined, key: string): string | undefined {
  if (!metadata) return undefined;
  const hit = Object.keys(metadata).find((k) => k.toLowerCase() === key.toLowerCase());
  return hit ? metadata[hit] : undefined;
}

async function listExisting(container: ContainerClient, signal?: AbortSignal): Promise<Map<string, ExistingBlob>> {
  const existing = new Map<string, ExistingBlob>();
  for await (const blob of container.listBlobsFlat({ includeMetadata: true, ...(signal && { abortSignal: signal }) })) {
    if (!blob.name.endsWith('.json')) continue;
    const version = readMeta(blob.metadata, META.revision);
    const revision = version === undefined ? undefined : Number(version);
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) {
      throw new Error(`Invalid grant revision metadata: ${blob.name}`);
    }
    existing.set(blob.name, {
      name: blob.name,
      contentHash: readMeta(blob.metadata, META.contentHash),
      isDeleted: readMeta(blob.metadata, META.isDeleted) === 'true',
      deletedAt: readMeta(blob.metadata, META.deletedAt),
      revision,
    });
  }
  return existing;
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
  { now = new Date(), retentionDays = 30, concurrency = 16, preserveIds = [], signal, historyContainer }: {
    now?: Date;
    retentionDays?: number;
    concurrency?: number;
    preserveIds?: string[];
    signal?: AbortSignal;
    historyContainer?: ContainerClient;
  } = {},
): Promise<BlobSyncStats> {
  const abortOptions = signal ? { abortSignal: signal } : {};
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Concurrency must be a positive integer');
  if (!Number.isFinite(retentionDays) || retentionDays < 0) throw new Error('Retention days must be a non-negative number');
  const ids = new Set<string>();
  for (const doc of docs) {
    if (!/^[a-z0-9_-]+$/i.test(doc.id) || !doc.contentHash || ids.has(doc.id)) throw new Error(`Missing or duplicate grant identity/hash: ${doc.id}`);
    ids.add(doc.id);
  }
  signal?.throwIfAborted();
  await container.createIfNotExists(abortOptions);
  if (historyContainer) {
    if (historyContainer.url === container.url) throw new Error('Grant history must use a separate container');
    await historyContainer.createIfNotExists(abortOptions);
  }
  const existing = await listExisting(container, signal);
  const stats: BlobSyncStats = { created: 0, updated: 0, unchanged: 0, softDeleted: 0, purged: 0 };
  const nowIso = now.toISOString();

  const readGrant = async (blob: ExistingBlob): Promise<GrantDocument> => {
    const body = await container.getBlockBlobClient(blob.name).downloadToBuffer(0, undefined, abortOptions);
    const grant = JSON.parse(body.toString('utf8')) as GrantDocument;
    if (blob.name !== blobName(grant.id) || grant.contentHash !== blob.contentHash) {
      throw new Error(`Grant body and metadata disagree: ${blob.name}`);
    }
    return grant;
  };
  const baseline = async (blob: ExistingBlob): Promise<void> => {
    if (!historyContainer || blob.revision !== undefined) return;
    blob.revision = await recordGrantRevision(historyContainer, await readGrant(blob), 'baseline', blob.isDeleted, nowIso, signal);
  };
  const metadata = (blob: ExistingBlob) => ({
    [META.contentHash]: blob.contentHash ?? '',
    [META.isDeleted]: String(blob.isDeleted),
    ...(blob.deletedAt && { [META.deletedAt]: blob.deletedAt }),
    ...(blob.revision !== undefined && { [META.revision]: String(blob.revision) }),
  });

  await mapLimit(docs, concurrency, async (doc) => {
    signal?.throwIfAborted();
    const current = existing.get(blobName(doc.id));
    const needsBaseline = historyContainer && current && current.revision === undefined;
    if (current) await baseline(current);
    if (current && !current.isDeleted && current.contentHash === doc.contentHash) {
      if (needsBaseline) {
        const body = JSON.stringify({ ...await readGrant(current), revision: current.revision });
        await container.getBlockBlobClient(current.name).upload(body, Buffer.byteLength(body), {
          blobHTTPHeaders: { blobContentType: 'application/json' },
          metadata: metadata(current),
          ...abortOptions,
        });
      }
      stats.unchanged++;
      return;
    }
    const grant = { ...doc, lastChangedAt: nowIso };
    const revision = historyContainer
      ? await recordGrantRevision(historyContainer, grant, !current ? 'created' : current.isDeleted ? 'restored' : 'updated', false, nowIso, signal)
      : undefined;
    const body = JSON.stringify({ ...grant, ...(revision !== undefined && { revision }) });
    await container.getBlockBlobClient(blobName(doc.id)).upload(body, Buffer.byteLength(body), {
      blobHTTPHeaders: { blobContentType: 'application/json' },
      metadata: { [META.contentHash]: doc.contentHash, [META.isDeleted]: 'false', ...(revision !== undefined && { [META.revision]: String(revision) }) },
      ...abortOptions,
    });
    if (current) stats.updated++;
    else stats.created++;
  });

  const liveNames = new Set(docs.map((d) => blobName(d.id)));
  for (const id of preserveIds) liveNames.add(blobName(id));
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const stale = [...existing.values()].filter((b) => !liveNames.has(b.name));

  await mapLimit(stale, concurrency, async (blob) => {
    signal?.throwIfAborted();
    const client = container.getBlockBlobClient(blob.name);
    const needsBaseline = historyContainer && blob.revision === undefined;
    await baseline(blob);
    if (!blob.isDeleted) {
      if (historyContainer) {
        blob.revision = await recordGrantRevision(historyContainer, await readGrant(blob), 'removed', true, nowIso, signal);
      }
      await client.setMetadata({
        ...metadata(blob),
        [META.isDeleted]: 'true',
        [META.deletedAt]: nowIso,
      }, abortOptions);
      stats.softDeleted++;
    } else if (blob.deletedAt && now.getTime() - new Date(blob.deletedAt).getTime() > retentionMs) {
      await client.deleteIfExists(abortOptions);
      stats.purged++;
    } else if (needsBaseline) {
      await client.setMetadata(metadata(blob), abortOptions);
    }
  });

  return stats;
}
