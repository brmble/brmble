/**
 * Migrate global localStorage keys to per-profile scoped keys.
 *
 * For each key, if the old global key exists AND the new scoped key
 * does NOT exist, copies the value to the scoped key.
 * The old key is kept so other profiles can also migrate from it.
 *
 * Also migrates uppercase-fingerprint scoped keys to lowercase.
 * Before the fingerprint casing fix, cert.status sent the raw
 * Thumbprint (uppercase) while GetCertHash() returned lowercase.
 * Data saved under the uppercase key needs to be carried over.
 * If the lowercase key already exists (from a stale global migration),
 * we compare lastSaved timestamps and keep whichever is newer.
 * Idempotent — safe to run multiple times.
 */

const KEYS_TO_MIGRATE = [
  'idle-farm-save',
  'idle-farm-theme',
  'brmblegotchi-state',
  'brmblegotchi-position',
  'brmble-read-markers',
];

/** Extract a lastSaved / ts timestamp from a JSON string, if present. */
function getTimestamp(json: string): number {
  try {
    const parsed = JSON.parse(json);
    // Game state uses lastSaved, read markers use per-room ts values
    if (typeof parsed === 'object' && parsed !== null) {
      if (typeof parsed.lastSaved === 'number') return parsed.lastSaved;
      // For read markers, find the max ts across all rooms
      let maxTs = 0;
      for (const val of Object.values(parsed)) {
        const v = val as { ts?: number };
        if (typeof v?.ts === 'number' && v.ts > maxTs) maxTs = v.ts;
      }
      if (maxTs > 0) return maxTs;
    }
  } catch { /* not JSON or no timestamp */ }
  return 0;
}

export function migrateLocalStorage(fingerprint: string): void {
  if (!fingerprint) return;

  // Fingerprint should already be lowercase, but ensure it.
  const lowerFp = fingerprint.toLowerCase();
  const upperFp = fingerprint.toUpperCase();

  for (const key of KEYS_TO_MIGRATE) {
    const scopedKey = `${key}_${lowerFp}`;
    const upperKey = `${key}_${upperFp}`;

    // Migrate from uppercase-scoped key (pre-fix data) to lowercase.
    // Compare timestamps: the uppercase key may have newer progress than
    // a lowercase key that was populated from stale global data.
    if (lowerFp !== upperFp) {
      const upperValue = localStorage.getItem(upperKey);
      if (upperValue !== null) {
        const currentValue = localStorage.getItem(scopedKey);
        if (currentValue === null) {
          // No lowercase key yet — copy uppercase data
          localStorage.setItem(scopedKey, upperValue);
          continue;
        }
        // Both exist — keep the one with the newer timestamp
        const upperTs = getTimestamp(upperValue);
        const currentTs = getTimestamp(currentValue);
        if (upperTs > currentTs) {
          localStorage.setItem(scopedKey, upperValue);
        }
        continue;
      }
    }

    // Migrate from global (unscoped) key
    const oldValue = localStorage.getItem(key);
    if (oldValue !== null && localStorage.getItem(scopedKey) === null) {
      localStorage.setItem(scopedKey, oldValue);
    }
  }
}
