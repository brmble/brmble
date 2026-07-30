export const CUSTOM_COMPANION_CACHE_MAX_BYTES = 100 * 1024 * 1024;

const DATABASE_NAME = 'brmble-custom-companions';
const DATABASE_VERSION = 1;
const STORE_NAME = 'atlases';

export interface StoredAtlas {
  cacheKey: string;
  blob: Blob;
  byteSize: number;
  lastAccessedAt: number;
}

export interface AtlasStoreTransaction {
  get(cacheKey: string): Promise<StoredAtlas | undefined>;
  getAll(): Promise<StoredAtlas[]>;
  put(record: StoredAtlas): Promise<void>;
  delete(cacheKey: string): Promise<void>;
}

export interface AtlasStoreAdapter {
  transaction<T>(work: (transaction: AtlasStoreTransaction) => Promise<T>): Promise<T>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

class IndexedDbAtlasStoreAdapter implements AtlasStoreAdapter {
  private readonly database: Promise<IDBDatabase>;

  constructor(factory: IDBFactory) {
    this.database = new Promise((resolve, reject) => {
      const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to open custom companion cache.'));
      request.onblocked = () => reject(new Error('Custom companion cache upgrade is blocked.'));
    });
  }

  async transaction<T>(work: (transaction: AtlasStoreTransaction) => Promise<T>): Promise<T> {
    const database = await this.database;
    const idbTransaction = database.transaction(STORE_NAME, 'readwrite');
    const store = idbTransaction.objectStore(STORE_NAME);
    const completion = transactionComplete(idbTransaction);
    const transaction: AtlasStoreTransaction = {
      get: async cacheKey => requestResult(store.get(cacheKey)) as Promise<StoredAtlas | undefined>,
      getAll: async () => requestResult(store.getAll()) as Promise<StoredAtlas[]>,
      put: async record => { await requestResult(store.put(record)); },
      delete: async cacheKey => { await requestResult(store.delete(cacheKey)); },
    };

    try {
      const result = await work(transaction);
      await completion;
      return result;
    } catch (error) {
      try {
        idbTransaction.abort();
      } catch {
        // The transaction may already have aborted because of the failed request.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }
}

function oldestFirst(left: StoredAtlas, right: StoredAtlas): number {
  return (left.lastAccessedAt - right.lastAccessedAt) || left.cacheKey.localeCompare(right.cacheKey);
}

export class CustomCompanionAtlasStore {
  private initialization: Promise<void> | null = null;
  private readonly adapter: AtlasStoreAdapter;
  private readonly maxBytes: number;
  private readonly now: () => number;

  constructor(
    adapter: AtlasStoreAdapter,
    maxBytes = CUSTOM_COMPANION_CACHE_MAX_BYTES,
    now: () => number = Date.now,
  ) {
    this.adapter = adapter;
    this.maxBytes = maxBytes;
    this.now = now;
  }

  private initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.pruneInternal(new Set(), 0).then(() => undefined);
    }
    return this.initialization;
  }

  private pruneInternal(protectedKeys: ReadonlySet<string>, requiredBytes: number): Promise<boolean> {
    return this.adapter.transaction(async transaction => {
      const records = await transaction.getAll();
      let totalBytes = records.reduce((total, record) => total + record.byteSize, 0);
      if (totalBytes + requiredBytes <= this.maxBytes) return true;

      const protectedBytes = records
        .filter(record => protectedKeys.has(record.cacheKey))
        .reduce((total, record) => total + record.byteSize, 0);
      if (protectedBytes + requiredBytes > this.maxBytes) return false;

      const candidates = records
        .filter(record => !protectedKeys.has(record.cacheKey))
        .sort(oldestFirst);
      for (const record of candidates) {
        if (totalBytes + requiredBytes <= this.maxBytes) break;
        await transaction.delete(record.cacheKey);
        totalBytes -= record.byteSize;
      }
      return totalBytes + requiredBytes <= this.maxBytes;
    });
  }

  async putAtlas(
    cacheKey: string,
    blob: Blob,
    protectedKeys: ReadonlySet<string>,
  ): Promise<boolean> {
    await this.initialize();
    return this.adapter.transaction(async transaction => {
      const records = await transaction.getAll();
      const retained = records.filter(record => record.cacheKey !== cacheKey);
      let retainedBytes = retained.reduce((total, record) => total + record.byteSize, 0);
      const protectedBytes = retained
        .filter(record => protectedKeys.has(record.cacheKey))
        .reduce((total, record) => total + record.byteSize, 0);

      if (blob.size > this.maxBytes || protectedBytes + blob.size > this.maxBytes) return false;

      const candidates = retained
        .filter(record => !protectedKeys.has(record.cacheKey))
        .sort(oldestFirst);
      for (const record of candidates) {
        if (retainedBytes + blob.size <= this.maxBytes) break;
        await transaction.delete(record.cacheKey);
        retainedBytes -= record.byteSize;
      }
      if (retainedBytes + blob.size > this.maxBytes) return false;

      await transaction.put({
        cacheKey,
        blob,
        byteSize: blob.size,
        lastAccessedAt: this.now(),
      });
      return true;
    });
  }

  async getAtlas(cacheKey: string): Promise<Blob | undefined> {
    await this.initialize();
    return this.adapter.transaction(async transaction => {
      const record = await transaction.get(cacheKey);
      if (!record) return undefined;
      await transaction.put({ ...record, lastAccessedAt: this.now() });
      return record.blob;
    });
  }

  async deleteAtlas(cacheKey: string): Promise<void> {
    await this.initialize();
    await this.adapter.transaction(async transaction => {
      await transaction.delete(cacheKey);
    });
  }

  async pruneAtlasCache(
    protectedKeys: ReadonlySet<string>,
    requiredBytes: number,
  ): Promise<boolean> {
    await this.initialize();
    return this.pruneInternal(protectedKeys, requiredBytes);
  }
}

let defaultStore: CustomCompanionAtlasStore | null = null;

function getDefaultStore(): CustomCompanionAtlasStore {
  if (!defaultStore) {
    if (!globalThis.indexedDB) throw new Error('IndexedDB is unavailable.');
    defaultStore = new CustomCompanionAtlasStore(new IndexedDbAtlasStoreAdapter(globalThis.indexedDB));
  }
  return defaultStore;
}

export const putAtlas = (
  cacheKey: string,
  blob: Blob,
  protectedKeys: ReadonlySet<string>,
) => getDefaultStore().putAtlas(cacheKey, blob, protectedKeys);
export const getAtlas = (cacheKey: string) => getDefaultStore().getAtlas(cacheKey);
export const deleteAtlas = (cacheKey: string) => getDefaultStore().deleteAtlas(cacheKey);
export const pruneAtlasCache = (
  protectedKeys: ReadonlySet<string>,
  requiredBytes: number,
) => getDefaultStore().pruneAtlasCache(protectedKeys, requiredBytes);
