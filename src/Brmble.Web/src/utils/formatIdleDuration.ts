/**
 * Formats a number of seconds as a human-readable English idle duration:
 * - `< 60`     → "Idle for <1 min"
 * - `< 60·60`  → "Idle for 12 min"
 * - `< 24·3600`→ "Idle for 1h 23m"
 * - else       → "Idle for 2 days" (or "1 day")
 *
 * Used by the moon-icon tooltip in user lists. Strings hardcoded for now;
 * if Brmble adds i18n later, route this through the chosen translation system.
 */
export function formatIdleDuration(seconds: number): string {
  if (seconds < 60) return 'Idle for <1 min';
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    return `Idle for ${m} min`;
  }
  if (seconds < 86_400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `Idle for ${h}h ${m}m`;
  }
  const days = Math.floor(seconds / 86_400);
  return `Idle for ${days} ${days === 1 ? 'day' : 'days'}`;
}
