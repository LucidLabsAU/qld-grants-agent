import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';

test('a worker restart recovers an interrupted turn and reset clears its cached history', async (t) => {
  const stored = { gc: { open: true, busy: true, picks: { 1: {} }, messages: [
    { id: 'u', role: 'user', text: 'Question' },
    { id: 'a', role: 'assistant', status: 'streaming', text: 'Partial', steps: [] },
  ] } };
  let listener;
  t.mock.method(globalThis, 'setInterval', () => { throw new Error('No agent call expected'); });
  globalThis.chrome = {
    storage: { local: {
      get: async () => structuredClone(stored),
      set: async (patch) => Object.assign(stored, structuredClone(patch)),
    } },
    runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
    action: { onClicked: { addListener() {} } },
    commands: { onCommand: { addListener() {} } },
  };
  t.after(() => { delete globalThis.chrome; });
  await import('../extension/background.js');
  await tick();
  assert.equal(stored.gc.busy, false);
  assert.equal(stored.gc.messages.at(-1).status, 'error');
  const message = (msg) => new Promise((resolve) => listener(msg, {}, resolve));
  assert.deepEqual(await message({ type: 'reset' }), { ok: true });
  await message({ type: 'setOpen', open: false });
  assert.deepEqual(stored.gc.messages, []);
  assert.deepEqual(stored.gc.picks, {});
});
