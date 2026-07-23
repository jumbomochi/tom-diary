// Settings: pure serialization + an IndexedDB record + the panel UI. The pure
// part maps a stored record to the askOracle config the driver uses.
import { DEFAULT_BASE, DEFAULT_MAX_TOKENS } from './oracle.js';
import { memoryEnabled } from './memory.js';

/** The knobs from oracle.env, web-side. `key` empty means "not configured yet". */
export const DEFAULT_SETTINGS = {
  base: DEFAULT_BASE,
  key: '',
  model: 'gpt-4o-mini',
  reasoning: '',
  maxTokens: DEFAULT_MAX_TOKENS,
  memory: 'on',
  tzOffset: 0,
};

/** Fill missing fields with defaults; coerce numeric fields. */
export function normalizeSettings(raw) {
  const r = raw || {};
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  return {
    base: r.base != null && r.base !== '' ? String(r.base) : DEFAULT_SETTINGS.base,
    key: r.key != null ? String(r.key) : DEFAULT_SETTINGS.key,
    model: r.model != null && r.model !== '' ? String(r.model) : DEFAULT_SETTINGS.model,
    reasoning: r.reasoning != null ? String(r.reasoning) : DEFAULT_SETTINGS.reasoning,
    maxTokens: num(r.maxTokens, DEFAULT_SETTINGS.maxTokens),
    memory: r.memory != null ? String(r.memory) : DEFAULT_SETTINGS.memory,
    tzOffset: num(r.tzOffset, DEFAULT_SETTINGS.tzOffset),
  };
}

/** Map a normalized settings record to the askOracle config. */
export function settingsToConfig(settings) {
  return {
    base: settings.base,
    key: settings.key,
    model: settings.model,
    maxTokens: settings.maxTokens,
    reasoning: settings.reasoning ? settings.reasoning : null,
    remember: memoryEnabled(settings.memory),
  };
}
