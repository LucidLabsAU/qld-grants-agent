import assert from 'node:assert/strict';
import { test } from 'node:test';
import { responseEvents } from '../extension/lib/stream.js';

async function collect(chunks) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  const events = [];
  for await (const event of responseEvents(body)) events.push(event);
  return events;
}

test('SSE handles CRLF split across chunks and comment keep-alives', async () => {
  const events = await collect([
    ': ping\r\n\r\ndata: {"type":"response.output_text.delta","delta":"hello"}\r',
    '\n\r\n', 'data: {"type":"response.completed"}\r\n\r\n',
  ]);
  assert.deepEqual(events.map((event) => event.type), ['response.output_text.delta', 'response.completed']);
});

test('SSE rejects EOF and DONE markers without a completed response', async () => {
  await assert.rejects(collect(['data: {"type":"response.output_text.delta","delta":"partial"}\n\n']), /interrupted/);
  await assert.rejects(collect(['data: [DONE]\n\n']), /interrupted/);
});

test('SSE rejects malformed frames and incomplete responses', async () => {
  await assert.rejects(collect(['data: not-json\n\n']), SyntaxError);
  await assert.rejects(collect(['data: {"type":"response.incomplete"}\n\n']), /could not complete/);
});

test('SSE exposes rate limits for automatic retries', async () => {
  await assert.rejects(collect(['data: {"type":"response.failed","response":{"error":{"code":"rate_limit_exceeded","message":"Busy"}}}\n\n']),
    (error) => error.rateLimited === true && error.message === 'Busy');
});
