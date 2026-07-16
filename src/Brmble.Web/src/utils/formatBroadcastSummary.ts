/**
 * Maps stored screen-share resolution values to their display labels.
 * Only `4k` needs special casing (`4K`); the `<n>p` values display as-is.
 */
const RESOLUTION_LABELS: Record<string, string> = {
  '720p': '720p',
  '1080p': '1080p',
  '1440p': '1440p',
  '4k': '4K',
};

/**
 * Formats a broadcast summary string for the sidebar tooltip, e.g. `1080p 30fps`.
 * Unmapped resolutions fall back to their raw string.
 */
export function formatBroadcastSummary(resolution: string, fps: number): string {
  const label = RESOLUTION_LABELS[resolution] ?? resolution;
  return `${label} ${fps}fps`;
}
