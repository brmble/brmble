import '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Node 25 introduces a native localStorage global that lacks .clear() and conflicts with
// jsdom's implementation. vitest's populateGlobal skips localStorage because it exists
// on the Node global, so jsdom's localStorage never overrides it.
// We restore proper behaviour by delegating to document.defaultView which IS the real
// jsdom Window object (vitest patches document.defaultView to point to itself but that
// still gives us access to jsdom's Window prototype chain).
// Fallback: a fully-functional in-memory shim.
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
