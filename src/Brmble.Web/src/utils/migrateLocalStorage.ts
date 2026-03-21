/**
 * Migrate global localStorage keys to per-profile scoped keys.
 *
 * For each key, if the old global key exists AND the new scoped key
 * does NOT exist, copies the value to the scoped key.
 * The old key is kept so other profiles can also migrate from it.
 * Idempotent — safe to run multiple times.
 */

const KEYS_TO_MIGRATE = [
  'idle-farm-save',
  'idle-farm-theme',
  'brmblegotchi-state',
  'brmblegotchi-position',
  'brmble-read-markers',
];

export function migrateLocalStorage(fingerprint: string): void {
  if (!fingerprint) return;

  for (const key of KEYS_TO_MIGRATE) {
    const scopedKey = `${key}_${fingerprint}`;
    const oldValue = localStorage.getItem(key);
    if (oldValue !== null && localStorage.getItem(scopedKey) === null) {
      localStorage.setItem(scopedKey, oldValue);
    }
  }
}
