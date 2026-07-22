import { describe, it, expect } from 'vitest';
import { buildMessages, buildRequestBody, sseDeltaContent, PERSONA } from '../../js/oracle.js';

describe('buildMessages', () => {
  it('assembles system, text-only history pairs, then the image turn', () => {
    const msgs = buildMessages({
      remember: false,
      history: [['I wrote about rain', 'The ink blurred, but I felt it.']],
      catalogLines: [],
      imageDataUri: 'data:image/png;base64,ABC',
    });
    expect(msgs[0]).toEqual({ role: 'system', content: PERSONA });
    expect(msgs[1]).toEqual({ role: 'user', content: '(an earlier page) I wrote about rain' });
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'The ink blurred, but I felt it.' });
    // history messages carry no image
    expect(typeof msgs[1].content).toBe('string');
    const turn = msgs[3];
    expect(turn.role).toBe('user');
    expect(turn.content[0]).toEqual({ type: 'text', text: 'Reply to what is written in the diary.' });
    expect(turn.content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,ABC' } });
    expect('detail' in turn.content[1].image_url).toBe(false);
  });
});

describe('buildRequestBody', () => {
  const messages = [{ role: 'system', content: 'x' }];
  it('sends model, stream, the cap field, and messages — no sampling params', () => {
    const b = buildRequestBody({ model: 'gpt-4o-mini', maxTokens: 2000, messages });
    expect(b.model).toBe('gpt-4o-mini');
    expect(b.stream).toBe(true);
    expect(b.max_tokens).toBe(2000);
    expect(b.messages).toBe(messages);
    expect('temperature' in b).toBe(false);
    expect('top_p' in b).toBe(false);
    expect('reasoning_effort' in b).toBe(false);
  });
  it('renames the cap field for the retry', () => {
    const b = buildRequestBody({ model: 'm', maxTokens: 500, capField: 'max_completion_tokens', messages });
    expect(b.max_completion_tokens).toBe(500);
    expect('max_tokens' in b).toBe(false);
  });
  it('includes reasoning_effort only when configured', () => {
    expect('reasoning_effort' in buildRequestBody({ model: 'm', maxTokens: 1, reasoning: 'low', messages })).toBe(true);
    expect(buildRequestBody({ model: 'm', maxTokens: 1, reasoning: 'low', messages }).reasoning_effort).toBe('low');
  });
});

describe('sseDeltaContent', () => {
  it('extracts choices[0].delta.content', () => {
    expect(sseDeltaContent('{"choices":[{"delta":{"content":"Hello"},"index":0}]}')).toBe('Hello');
  });
  it('returns null for a role-only frame', () => {
    expect(sseDeltaContent('{"choices":[{"delta":{"role":"assistant"}}]}')).toBeNull();
  });
  it('decodes unicode and newlines', () => {
    expect(sseDeltaContent('{"choices":[{"delta":{"content":"Déjà vu — oui"}}]}')).toBe('Déjà vu — oui');
    expect(sseDeltaContent('{"choices":[{"delta":{"content":"line\\nbreak"}}]}')).toBe('line\nbreak');
  });
  it('returns null on malformed JSON', () => {
    expect(sseDeltaContent('not json')).toBeNull();
  });
});
