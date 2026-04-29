/**
 * Convert a plain-text message into HTML safe for sending over the Mumble
 * protocol, wrapping URLs in `<a href="...">` so native Mumble clients render
 * them as clickable links. The Mumble server must have allowHTML enabled
 * (default true in Brmble's docker-local config).
 *
 * URLs supported:
 * - http(s)://...   → href is the URL as-is
 * - www....         → href is "https://" + URL (visible text stays "www....")
 *
 * Bare domains like "example.com" are NOT linkified — the false-positive rate
 * (e.g. mid-sentence punctuation, version numbers) is too high.
 */

const URL_PATTERN = /(https?:\/\/[^\s<>"')\]]+)|(\bwww\.[^\s<>"')\]]+)/gi;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}

export function linkifyForMumble(text: string): string {
  let out = '';
  let lastIndex = 0;
  URL_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_PATTERN.exec(text)) !== null) {
    out += escapeHtml(text.slice(lastIndex, m.index));
    const url = m[0];
    const href = m[1] ? url : `https://${url}`;
    out += `<a href="${escapeHtml(href)}">${escapeHtml(url)}</a>`;
    lastIndex = URL_PATTERN.lastIndex;
  }
  out += escapeHtml(text.slice(lastIndex));
  return out;
}
