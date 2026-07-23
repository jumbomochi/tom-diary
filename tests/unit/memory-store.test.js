import 'fake-indexeddb/auto'; // installs a global indexedDB for this test file
import { describe, it, expect, beforeEach } from 'vitest';
import { openMemoryDb, createMemoryStore, MAX_MEMORIES } from '../../js/memory.js';
import { IDBFactory } from 'fake-indexeddb';

let db;
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory(); // fresh DB per test
  db = await openMemoryDb();
});

const ink = [{ points: [{ x: 10, y: 20, r: 3 }, { x: 100, y: 120, r: 2 }] }];

describe('memory store', () => {
  it('round-trips an appended page and its decimated strokes', async () => {
    const s = createMemoryStore(db);
    await s.append(1751856000, 'hello tom', 'Hello. Who writes?', ink);
    const all = await s.all();
    expect(all).toHaveLength(1);
    expect(all[0].transcript).toBe('hello tom');
    expect(all[0].reply).toBe('Hello. Who writes?');
    const strokes = await s.strokes(1751856000);
    expect(strokes[0][0]).toEqual([10, 20, 3]);
    expect(strokes[0][strokes[0].length - 1]).toEqual([100, 120, 2]);
  });

  it('returns entries oldest-first regardless of insert order', async () => {
    const s = createMemoryStore(db);
    await s.append(200, 'b', 'B', ink);
    await s.append(100, 'a', 'A', ink);
    expect((await s.all()).map((e) => e.id)).toEqual([100, 200]);
  });

  it('prunes to MAX_MEMORIES, forgetting the oldest', async () => {
    const s = createMemoryStore(db);
    for (let i = 1; i <= MAX_MEMORIES + 5; i++) await s.append(i, 't' + i, 'r', ink);
    const all = await s.all();
    expect(all).toHaveLength(MAX_MEMORIES);
    expect(all[0].id).toBe(6);                 // ids 1..5 pruned
    expect(await s.get(1)).toBeUndefined();
    expect(await s.get(6)).toBeTruthy();
  });

  it('builds a catalog and maps a conjure number back to a page', async () => {
    const s = createMemoryStore(db, { offsetHours: 0 });
    await s.append(1751856000, 'about the garden', 'a', ink);
    await s.append(1751942400, 'about the rain', 'b', ink);
    const { lines, ids } = await s.catalog(10);
    expect(ids).toEqual([1751942400, 1751856000]);
    expect(lines[0]).toContain('about the rain');
    // conjure lookup: ⟦show:1⟧ -> ids[0]
    const conjured = await s.get(ids[0]);
    expect(conjured.transcript).toBe('about the rain');
  });

  it('clears all pages', async () => {
    const s = createMemoryStore(db);
    await s.append(1, 't', 'r', ink);
    await s.clear();
    expect(await s.all()).toEqual([]);
  });
});
