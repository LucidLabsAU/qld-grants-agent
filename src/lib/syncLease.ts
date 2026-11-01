import type { ContainerClient } from '@azure/storage-blob';
import { setTimeout as delay } from 'node:timers/promises';

/** Serializes timer/manual syncs across Function instances; a crashed host's lease expires after 60 seconds. */
export async function withSyncLease<T>(container: ContainerClient, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  await container.createIfNotExists();
  const lease = container.getBlobLeaseClient();
  await lease.acquireLease(60);
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8 * 60_000)]);
  const stop = new AbortController();
  const renew = (async () => {
    try {
      while (!stop.signal.aborted) {
        await delay(20_000, undefined, { signal: stop.signal });
        await lease.renewLease({ abortSignal: AbortSignal.timeout(20_000) });
      }
    } catch (error) {
      if (!stop.signal.aborted) controller.abort(error);
    }
  })();
  try {
    const result = await task(signal);
    signal.throwIfAborted();
    return result;
  } finally {
    stop.abort();
    await renew;
    await lease.releaseLease({ abortSignal: AbortSignal.timeout(20_000) });
  }
}
