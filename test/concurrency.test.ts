import { describe, expect, it } from 'vitest';
import { mapLimit } from '../src/lib/concurrency.js';

describe('mapLimit', () => {
  it.each([0, -1, 1.5, NaN])('rejects invalid limits even for empty input: %s', async (limit) => {
    await expect(mapLimit([], limit, async () => 1)).rejects.toThrow(/Concurrency/);
  });

  it('waits for active tasks after a failure and stops scheduling new work', async () => {
    let finish!: () => void;
    const active = new Promise<void>((resolve) => { finish = resolve; });
    const seen: number[] = [];
    let settled = false;
    const result = mapLimit([1, 2, 3], 2, async (item) => {
      seen.push(item);
      if (item === 1) throw new Error('failed');
      await active;
      return item;
    });
    const assertion = expect(result.finally(() => { settled = true; })).rejects.toThrow('failed');
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await assertion;
    expect(seen).toEqual([1, 2]);
  });
});
