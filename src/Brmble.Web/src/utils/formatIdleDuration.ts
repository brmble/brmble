/**
 * Formats a number of seconds as a human-readable Dutch idle duration suffix:
 * - `< 60`     → "AFK voor <1 min"
 * - `< 60·60`  → "AFK voor 12 min"
 * - `< 24·3600`→ "AFK voor 1u 23m"
 * - else       → "AFK voor 2 dagen" (or "1 dag")
 *
 * Used by the moon-icon tooltip in user lists.
 */
export function formatIdleDuration(seconds: number): string {
  if (seconds < 60) return 'AFK voor <1 min';
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    return `AFK voor ${m} min`;
  }
  if (seconds < 86_400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `AFK voor ${h}u ${m}m`;
  }
  const days = Math.floor(seconds / 86_400);
  return `AFK voor ${days} ${days === 1 ? 'dag' : 'dagen'}`;
}
