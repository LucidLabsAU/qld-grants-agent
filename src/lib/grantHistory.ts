import type { ContainerClient } from '@azure/storage-blob';
import type { GrantDocument } from './types.js';

export type RevisionEvent = 'baseline' | 'created' | 'updated' | 'removed' | 'restored';
export interface GrantRevision {
  revision: number;
  event: RevisionEvent;
  recordedAt: string;
  deleted: boolean;
  grant: GrantDocument;
}

/** Appends an immutable revision; retries reuse a matching last event after a staging write failed. */
export async function recordGrantRevision(
  history: ContainerClient,
  grant: GrantDocument,
  event: RevisionEvent,
  deleted: boolean,
  recordedAt: string,
  signal?: AbortSignal,
): Promise<number> {
  let latest = 0;
  let metadata: Record<string, string> | undefined;
  const abortOptions = signal ? { abortSignal: signal } : {};
  for await (const blob of history.listBlobsFlat({ prefix: `${grant.id}/`, includeMetadata: true, ...abortOptions })) {
    const match = /\/(\d+)\.json$/.exec(blob.name);
    if (!match) continue;
    const revision = Number(match[1]);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error(`Invalid history revision: ${blob.name}`);
    if (revision > latest) {
      latest = revision;
      metadata = blob.metadata;
    }
  }
  if (event === 'created' && metadata?.deleted === 'true') event = 'restored';
  if (metadata?.contenthash === grant.contentHash && metadata.event === event && metadata.deleted === String(deleted)) {
    return latest;
  }
  const revision = latest + 1;
  const record: GrantRevision = { revision, event, recordedAt, deleted, grant };
  const body = JSON.stringify(record);
  await history.getBlockBlobClient(`${grant.id}/${String(revision).padStart(6, '0')}.json`).upload(body, Buffer.byteLength(body), {
    conditions: { ifNoneMatch: '*' },
    blobHTTPHeaders: { blobContentType: 'application/json' },
    metadata: { contenthash: grant.contentHash, event, deleted: String(deleted) },
    ...abortOptions,
  });
  return revision;
}
