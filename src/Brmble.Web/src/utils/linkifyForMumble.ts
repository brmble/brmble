/**
 * Convert a plain-text message into HTML safe for sending over the Mumble
 * protocol, wrapping URLs in `<a href="...">` so native Mumble clients render
 * them as clickable links. The Mumble server must have allowHTML enabled
 * (default true in Brmble's docker-local config).
 *
 * Only http(s):// URLs are linkified — Mumble already auto-links www. URLs
 * itself (it prepends https:// when resolving them), and bare domains like
 * "example.com" have too high a false-positive rate to wrap.
 */

const URL_PATTERN = /(https?:\/\/[^\s<>"')\]]+)/gi;

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
    out += `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
    lastIndex = URL_PATTERN.lastIndex;
  }
  out += escapeHtml(text.slice(lastIndex));
  return out;
}
