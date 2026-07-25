import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openMemoryDb, createMemoryStore } from '../../js/memory.js';

// Open the DB at the real shipped v1 schema: ONLY the `pages` store.
function openV1(factory) {
  return new Promise((resolve, reject) => {
    const req = factory.open('tom-diary', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('pages', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

describe('memory DB v1 -> v2 migration', () => {
  it('upgrade preserves existing pages data and adds the settings store', async () => {
    const factory = new IDBFactory(); // isolated from other tests

    // 1-3. Create the v1-shaped DB and write a page row, then close it.
    const v1 = await openV1(factory);
    await new Promise((resolve, reject) => {
      const req = v1.transaction('pages', 'readwrite').objectStore('pages')
        .put({ id: 1751856000, transcript: 'hi', reply: 'Hello.', strokes: [] });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    v1.close();

    // 4. Reopen the SAME DB through the real openMemoryDb (requests v2),
    //    triggering the guarded onupgradeneeded upgrade.
    const v2 = await openMemoryDb(factory);

    // 5a. Pre-existing page row survives the upgrade.
    const page = await createMemoryStore(v2).get(1751856000);
    expect(page).toBeTruthy();
    expect(page.transcript).toBe('hi');
    expect(page.reply).toBe('Hello.');

    // 5b + 5c. Both stores now exist.
    expect(v2.objectStoreNames.contains('pages')).toBe(true);
    expect(v2.objectStoreNames.contains('settings')).toBe(true);
  });
});
