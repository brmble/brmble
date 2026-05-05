import '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Node 25 ships a native localStorage on globalThis that lacks .clear(), and vitest's
// populateGlobal skips the slot because it's already populated, so jsdom's Storage
// never installs. We feature-detect on .clear and replace with a Map-backed shim.
(function patchLocalStorage() {
  // Check if localStorage already has .clear — if it does, nothing to do.
  if (typeof globalThis.localStorage?.clear === 'function') return;

  // Build a Map-backed localStorage shim with proper key enumeration.
  // Methods live on the prototype so Object.keys() only returns stored keys.
  const store = new Map<string, string>();

  class StorageShim implements Storage {
    get length() { return store.size; }
    clear() { store.clear(); for (const k of Object.keys(this)) delete (this as Record<string, unknown>)[k]; }
    getItem(key: string): string | null { return store.has(key) ? store.get(key)! : null; }
    setItem(key: string, value: string) { store.set(key, String(value)); Object.defineProperty(this, key, { value: String(value), writable: true, enumerable: true, configurable: true }); }
    removeItem(key: string) { store.delete(key); delete (this as Record<string, unknown>)[key]; }
    key(index: number): string | null { return [...store.keys()][index] ?? null; }
    [name: string]: unknown;
  }

  const shim = new StorageShim();

  Object.defineProperty(globalThis, 'localStorage', {
    value: shim,
    writable: true,
    configurable: true,
    enumerable: true,
  });
})();
