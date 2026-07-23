import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openMemoryDb, createMemoryStore } from '../../js/memory.js';
import { createSettingsStore, DEFAULT_SETTINGS } from '../../js/settings.js';

let db;
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  db = await openMemoryDb();
});

describe('settings store (DB v2)', () => {
  it('returns defaults before anything is saved', async () => {
    const s = createSettingsStore(db);
    expect(await s.load()).toEqual(DEFAULT_SETTINGS);
  });
  it('round-trips a saved record (normalized)', async () => {
    const s = createSettingsStore(db);
    await s.save({ key: 'sk-1', model: 'gpt-4o', maxTokens: '750', memory: 'off' });
    const loaded = await s.load();
    expect(loaded.key).toBe('sk-1');
    expect(loaded.maxTokens).toBe(750);
    expect(loaded.memory).toBe('off');
  });
  it('coexists with the pages store on the same DB', async () => {
    const mem = createMemoryStore(db);
    await mem.append(1751856000, 'hi', 'Hello.', [{ points: [{ x: 1, y: 1, r: 2 }] }]);
    const s = createSettingsStore(db);
    await s.save({ key: 'k' });
    expect((await mem.all())).toHaveLength(1);
    expect((await s.load()).key).toBe('k');
  });
});
