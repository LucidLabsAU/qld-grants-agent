import type { ContainerClient } from '@azure/storage-blob';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { withSyncLease } from '../src/lib/syncLease.js';

vi.mock('node:timers/promises', () => ({
  setTimeout: vi.fn((_ms: number, _value: unknown, { signal }: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))),
}));

function fake() {
  const lease = {
    acquireLease: vi.fn(async () => ({})),
    renewLease: vi.fn(async () => ({})),
    releaseLease: vi.fn(async () => ({})),
  };
  const container = {
    createIfNotExists: async () => ({}),
    getBlobLeaseClient: () => lease,
  } as unknown as ContainerClient;
  return { lease, container };
}

describe('sync lease', () => {
  it('releases the distributed lease after successful or failed syncs', async () => {
    const { lease, container } = fake();
    expect(await withSyncLease(container, async () => 42)).toBe(42);
    await expect(withSyncLease(container, async () => { throw new Error('Sync failed'); })).rejects.toThrow('Sync failed');
    expect(lease.acquireLease).toHaveBeenCalledWith(60);
    expect(lease.releaseLease).toHaveBeenCalledTimes(2);
  });

  it('never starts ingestion when another instance holds the lease', async () => {
    const { lease, container } = fake();
    lease.acquireLease.mockRejectedValue(new Error('Lease already held'));
    const task = vi.fn();
    await expect(withSyncLease(container, task)).rejects.toThrow('Lease already held');
    expect(task).not.toHaveBeenCalled();
  });

  it('aborts the sync when lease renewal fails', async () => {
    const { lease, container } = fake();
    lease.renewLease.mockRejectedValue(new Error('Lease lost'));
    vi.mocked(delay).mockResolvedValueOnce(undefined);
    const result = withSyncLease(container, async (signal) =>
      new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })));
    const assertion = expect(result).rejects.toThrow('Lease lost');
    await assertion;
    expect(lease.releaseLease).toHaveBeenCalledTimes(1);
  });
});
