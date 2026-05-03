import '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Node 25 ships a native localStorage on globalThis that lacks .clear(), and vitest's
// populateGlobal skips the slot because it's already populated, so jsdom's Storage
// never installs. We feature-detect on .clear and replace with a Map-backed shim.
(function patchLocalStorage() {
  // Check if localStorage already has .clear — if it does, nothing to do.
  if (typeof globalThis.localStorage?.clear === 'function') return;

  // Build a Map-backed localStorage shim.
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null;
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: shim,
    writable: true,
    configurable: true,
    enumerable: true,
  });
})();
