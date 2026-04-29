/**
 * Convert a plain-text message into HTML safe for sending over the Mumble
 * protocol, wrapping URLs in `<a href="...">` so native Mumble clients render
 * them as clickable links. The Mumble server must have allowHTML enabled
 * (default true in Brmble's docker-local config).
 *
 * URLs supported:
 * - http(s)://...   → wrapped as-is in an anchor
 * - www....         → rewritten to "https://www...." (both as visible text
 *                     and href) so the outgoing message contains a fully-
 *                     qualified URL that any client can resolve. Brmble
 *                     receivers see the rewritten URL too, which their own
 *                     linkifyText then handles.
 *
 * Bare domains like "example.com" are NOT linkified — too high a false-
 * positive rate (mid-sentence punctuation, version numbers, file names).
 */

// Inner char class excludes whitespace and tag/quote/bracket delimiters.
// The required final char additionally excludes sentence punctuation
// (.,;:!?) so a URL at the end of a sentence doesn't swallow the period.
const URL_PATTERN =
  /(?:https?:\/\/|\bwww\.)[^\s<>"')\]]*[^\s<>"')\].,;:!?]/gi;

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
    // For www-prefixed URLs, prepend https:// so the URL is fully qualified
    // everywhere (Mumble visible text, anchor href, and any Brmble receiver
    // post-anchor-strip).
    const url = m[0].startsWith('www.') ? `https://${m[0]}` : m[0];
    out += `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
    lastIndex = URL_PATTERN.lastIndex;
  }
  out += escapeHtml(text.slice(lastIndex));
  return out;
}
