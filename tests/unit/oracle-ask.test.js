import { describe, it, expect, vi } from 'vitest';
import { askOracle } from '../../js/oracle.js';

// Build a fake streaming Response from an array of SSE text chunks.
function sseResponse(chunks, { status = 200 } = {}) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return { status, ok: status >= 200 && status < 300, body, text: async () => '' };
}

const collect = () => {
  const events = [];
  return {
    handlers: {
      onInk: (t) => events.push(['ink', t]),
      onShow: (id) => events.push(['show', id]),
      onTranscript: (t) => events.push(['transcript', t]),
      onError: (e) => events.push(['error', e]),
    },
    events,
  };
};

const config = { base: 'https://api.example.com/v1/', key: 'k', model: 'm' };
const turn = { imageDataUri: 'data:image/png;base64,AAA', catalogIds: [900, 800] };

describe('askOracle', () => {
  it('streams SSE deltas through the parser to the handlers', async () => {
    const S = '⁂';
    const fetchImpl = vi.fn(async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Hello. "}}]}\n',
      'data: {"choices":[{"delta":{"content":"Who writes? "}}]}\n',
      `data: {"choices":[{"delta":{"content":"${S} it rained"}}]}\n`,
      'data: [DONE]\n',
    ]));
    const { handlers, events } = collect();
    await askOracle(config, turn, handlers, { fetch: fetchImpl });
    // trailing slash trimmed on the URL
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
    expect(events).toEqual([
      ['ink', 'Hello.'],
      ['ink', 'Who writes?'],
      ['transcript', 'it rained'],
    ]);
  });

  it('retries once with max_completion_tokens on a 400 that names it', async () => {
    const bodies = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) {
        return { status: 400, ok: false, text: async () => 'Unsupported parameter: use max_completion_tokens' };
      }
      return sseResponse(['data: {"choices":[{"delta":{"content":"Hi there."}}]}\n', 'data: [DONE]\n']);
    });
    const { handlers, events } = collect();
    await askOracle(config, turn, handlers, { fetch: fetchImpl });
    expect(bodies[0]).toHaveProperty('max_tokens');
    expect(bodies[1]).toHaveProperty('max_completion_tokens');
    expect(bodies[1]).not.toHaveProperty('max_tokens');
    expect(events).toContainEqual(['ink', 'Hi there.']);
  });

  it('reports a provider error as onError', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 401, ok: false, text: async () => 'bad key' }));
    const { handlers, events } = collect();
    await askOracle(config, turn, handlers, { fetch: fetchImpl });
    expect(events).toEqual([['error', 'http 401: bad key']]);
  });

  it('reports a non-naming 400 as onError without retrying', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 400, ok: false, text: async () => 'nonsense' }));
    const { handlers, events } = collect();
    await askOracle(config, turn, handlers, { fetch: fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(events).toEqual([['error', 'http 400: nonsense']]);
  });

  it('reports a network failure as request failed', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    const { handlers, events } = collect();
    await askOracle(config, turn, handlers, { fetch: fetchImpl });
    expect(events).toEqual([['error', 'request failed: offline']]);
  });
});
