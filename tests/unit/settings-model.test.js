import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, settingsToConfig } from '../../js/settings.js';

describe('normalizeSettings', () => {
  it('fills every field from defaults when given nothing', () => {
    const s = normalizeSettings(undefined);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.base).toBe('https://api.openai.com/v1');
    expect(s.maxTokens).toBe(2000);
    expect(s.memory).toBe('on');
    expect(s.tzOffset).toBe(0);
    expect(s.key).toBe('');
  });
  it('keeps provided values and coerces numeric fields', () => {
    const s = normalizeSettings({ key: 'sk-x', model: 'gpt-4o', maxTokens: '500', tzOffset: '-5.5', memory: 'off' });
    expect(s.key).toBe('sk-x');
    expect(s.model).toBe('gpt-4o');
    expect(s.maxTokens).toBe(500);
    expect(s.tzOffset).toBe(-5.5);
    expect(s.memory).toBe('off');
  });
});

describe('settingsToConfig', () => {
  it('maps to an askOracle config with remember from the memory toggle', () => {
    const c = settingsToConfig(normalizeSettings({ key: 'k', model: 'm', reasoning: 'low', memory: 'on' }));
    expect(c).toEqual({ base: 'https://api.openai.com/v1', key: 'k', model: 'm', maxTokens: 2000, reasoning: 'low', remember: true });
  });
  it('turns a blank reasoning into null and off memory into remember:false', () => {
    const c = settingsToConfig(normalizeSettings({ key: 'k', model: 'm', reasoning: '', memory: 'off' }));
    expect(c.reasoning).toBeNull();
    expect(c.remember).toBe(false);
  });
});
