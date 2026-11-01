import { createHash } from 'node:crypto';
import type { GrantDocument } from './types.js';

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Identity of the grant's *content*, independent of its upstream id – used to detect duplicates. */
export function contentFingerprint(doc: GrantDocument & { revision?: number }): string {
  const { id, sourceIds, contentHash, lastChangedAt, revision, ...content } = doc;
  return sha256(content);
}

/** Hash of everything that ends up in the index (excluding bookkeeping) – used to detect changes. */
export function computeContentHash(doc: GrantDocument & { revision?: number }): string {
  const { contentHash, lastChangedAt, revision, ...indexed } = doc;
  return sha256(indexed);
}

const byNumericId = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export interface DedupeResult {
  documents: GrantDocument[];
  duplicatesRemoved: number;
}

/**
 * Collapses records whose content is identical (apart from their upstream id) into a single document.
 * The lowest upstream id wins so the document key is stable across runs; the other ids are kept in `sourceIds`.
 */
export function dedupeGrants(docs: GrantDocument[]): DedupeResult {
  const groups = new Map<string, GrantDocument[]>();
  for (const doc of docs) {
    const key = contentFingerprint(doc);
    const group = groups.get(key);
    if (group) group.push(doc);
    else groups.set(key, [doc]);
  }

  const documents = [...groups.values()].map((group) => {
    const ids = group.map((d) => d.id).sort(byNumericId);
    const winner = group.find((d) => d.id === ids[0])!;
    const merged: GrantDocument = { ...winner, sourceIds: ids };
    return { ...merged, contentHash: computeContentHash(merged) };
  });

  documents.sort((a, b) => byNumericId(a.id, b.id));
  return { documents, duplicatesRemoved: docs.length - documents.length };
}
