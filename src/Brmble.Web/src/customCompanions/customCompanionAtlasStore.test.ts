import { describe, expect, it } from 'vitest';
import {
  CustomCompanionAtlasStore,
  type AtlasStoreAdapter,
  type AtlasStoreTransaction,
  type StoredAtlas,
} from './customCompanionAtlasStore';

class FakeIndexedDbAdapter implements AtlasStoreAdapter {
  private records = new Map<string, StoredAtlas>();
  private tail = Promise.resolve();

  constructor(seed: StoredAtlas[] = []) {
    seed.forEach(record => this.records.set(record.cacheKey, record));
  }

  transaction<T>(work: (transaction: AtlasStoreTransaction) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const copy = new Map([...this.records].map(([key, value]) => [key, { ...value }]));
      const transaction: AtlasStoreTransaction = {
        get: async key => copy.get(key),
        getAll: async () => [...copy.values()],
        put: async record => { copy.set(record.cacheKey, record); },
        delete: async key => { copy.delete(key); },
      };
      const result = await work(transaction);
      this.records = copy;
      return result;
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  snapshot(): StoredAtlas[] {
    return [...this.records.values()].sort((left, right) => left.cacheKey.localeCompare(right.cacheKey));
  }
}

function blob(size: number, type = 'image/png'): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

describe('CustomCompanionAtlasStore', () => {
  it('isolates identical event IDs by room key and persists across reopen', async () => {
    const adapter = new FakeIndexedDbAdapter();
    const first = new CustomCompanionAtlasStore(adapter, 100, () => 1);
    await first.putAtlas('!one:test\u0000$sprite:test', blob(3), new Set());
    await first.putAtlas('!two:test\u0000$sprite:test', blob(4), new Set());

    const reopened = new CustomCompanionAtlasStore(adapter, 100, () => 2);
    await expect(reopened.getAtlas('!one:test\u0000$sprite:test')).resolves.toHaveProperty('size', 3);
    await expect(reopened.getAtlas('!two:test\u0000$sprite:test')).resolves.toHaveProperty('size', 4);
  });

  it('updates access time in the same read/write transaction', async () => {
    const adapter = new FakeIndexedDbAdapter();
    let now = 10;
    const store = new CustomCompanionAtlasStore(adapter, 100, () => now);
    await store.putAtlas('a', blob(3), new Set(), 'pending-owner');
    now = 20;

    await store.getAtlas('a');

    expect(adapter.snapshot()[0].lastAccessedAt).toBe(20);
    expect(adapter.snapshot()[0].writeOwner).toBeUndefined();
  });

  it('deletes a late cancelled write only while its ownership is unchanged', async () => {
    const adapter = new FakeIndexedDbAdapter();
    const store = new CustomCompanionAtlasStore(adapter, 100, () => 1);
    await store.putAtlas('a', blob(3), new Set(), 'old-owner');

    await expect(store.deleteAtlasIfOwned('a', 'new-owner')).resolves.toBe(false);
    expect(adapter.snapshot()).toHaveLength(1);
    await expect(store.deleteAtlasIfOwned('a', 'old-owner')).resolves.toBe(true);
    expect(adapter.snapshot()).toHaveLength(0);
  });

  it('does not replace a same-key atlas created by another owned writer', async () => {
    const adapter = new FakeIndexedDbAdapter();
    const newerStore = new CustomCompanionAtlasStore(adapter, 100, () => 2);
    const staleStore = new CustomCompanionAtlasStore(adapter, 100, () => 1);
    const newerBlob = blob(4, 'image/webp');

    await expect(newerStore.putAtlas('a', newerBlob, new Set(), 'new-owner')).resolves.toBe(true);
    await expect(staleStore.putAtlas('a', blob(3), new Set(), 'old-owner')).resolves.toBe(false);
    await expect(staleStore.deleteAtlasIfOwned('a', 'old-owner')).resolves.toBe(false);

    expect(adapter.snapshot()).toEqual([
      expect.objectContaining({
        cacheKey: 'a',
        blob: newerBlob,
        byteSize: 4,
        writeOwner: 'new-owner',
      }),
    ]);
  });

  it('evicts deterministically by oldest access then cache key', async () => {
    const adapter = new FakeIndexedDbAdapter([
      { cacheKey: 'b', blob: blob(4), byteSize: 4, lastAccessedAt: 1 },
      { cacheKey: 'a', blob: blob(4), byteSize: 4, lastAccessedAt: 1 },
    ]);
    const store = new CustomCompanionAtlasStore(adapter, 10, () => 3);

    await expect(store.putAtlas('c', blob(4), new Set())).resolves.toBe(true);

    expect(adapter.snapshot().map(record => record.cacheKey)).toEqual(['b', 'c']);
  });

  it('does not evict below or equal to the hard limit', async () => {
    const adapter = new FakeIndexedDbAdapter();
    const store = new CustomCompanionAtlasStore(adapter, 10, () => 1);
    await store.putAtlas('a', blob(5), new Set());
    await store.putAtlas('b', blob(5), new Set());

    expect(adapter.snapshot().map(record => record.cacheKey)).toEqual(['a', 'b']);
  });

  it('uses replacement delta and prunes other records only when needed', async () => {
    const adapter = new FakeIndexedDbAdapter([
      { cacheKey: 'a', blob: blob(4), byteSize: 4, lastAccessedAt: 2 },
      { cacheKey: 'b', blob: blob(4), byteSize: 4, lastAccessedAt: 1 },
    ]);
    const store = new CustomCompanionAtlasStore(adapter, 10, () => 3);

    await store.putAtlas('a', blob(7), new Set());

    expect(adapter.snapshot().map(record => [record.cacheKey, record.byteSize])).toEqual([['a', 7]]);
  });

  it('preserves protected records and declines an incoming blob that cannot fit', async () => {
    const adapter = new FakeIndexedDbAdapter([
      { cacheKey: 'protected', blob: blob(8), byteSize: 8, lastAccessedAt: 1 },
      { cacheKey: 'other', blob: blob(2), byteSize: 2, lastAccessedAt: 2 },
    ]);
    const store = new CustomCompanionAtlasStore(adapter, 10, () => 3);

    await expect(store.putAtlas('incoming', blob(3), new Set(['protected']))).resolves.toBe(false);
    expect(adapter.snapshot().map(record => record.cacheKey)).toEqual(['other', 'protected']);
  });

  it('prunes stale over-budget data once when reopened', async () => {
    const adapter = new FakeIndexedDbAdapter([
      { cacheKey: 'old', blob: blob(6), byteSize: 6, lastAccessedAt: 1 },
      { cacheKey: 'new', blob: blob(6), byteSize: 6, lastAccessedAt: 2 },
    ]);
    const store = new CustomCompanionAtlasStore(adapter, 10, () => 3);

    await store.getAtlas('new');

    expect(adapter.snapshot().map(record => record.cacheKey)).toEqual(['new']);
  });

  it('deletes only the redacted atlas', async () => {
    const adapter = new FakeIndexedDbAdapter();
    const store = new CustomCompanionAtlasStore(adapter, 10, () => 1);
    await store.putAtlas('keep', blob(2), new Set());
    await store.putAtlas('remove', blob(2), new Set());

    await store.deleteAtlas('remove');

    expect(adapter.snapshot().map(record => record.cacheKey)).toEqual(['keep']);
  });
});
