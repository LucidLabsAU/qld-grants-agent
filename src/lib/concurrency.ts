/** Bounds concurrency, preserves order and waits for active tasks before propagating a failure. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Concurrency must be a positive integer');
  const results = new Array<R>(items.length);
  const queue = items.entries();
  let failed = false;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (const [i, item] of queue) {
      if (failed) break;
      try {
        results[i] = await task(item);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });
  const settled = await Promise.allSettled(workers);
  for (const result of settled) if (result.status === 'rejected') throw result.reason;
  return results;
}
