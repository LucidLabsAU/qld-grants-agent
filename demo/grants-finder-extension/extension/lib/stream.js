/** Reads a Responses SSE stream and rejects truncated, malformed or unsuccessful responses. */
export async function* responseEvents(body) {
  if (!body) throw new Error('The agent returned no response stream.');
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let boundary;
      while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = block.split(/\r\n|\r|\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        const event = JSON.parse(data);
        if (['response.failed', 'response.incomplete', 'error'].includes(event.type)) {
          const detail = event.error ?? event.response?.error ?? {};
          const error = new Error(detail.message ?? event.message ?? 'The agent could not complete the request.');
          error.rateLimited = /rate_limit|too_many_requests/i.test(`${detail.code} ${detail.type}`);
          throw error;
        }
        yield event;
        if (event.type === 'response.completed') return;
      }
    }
    throw new Error('The agent response was interrupted. Please try again.');
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
