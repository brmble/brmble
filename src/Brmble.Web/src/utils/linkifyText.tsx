import type { ReactNode } from 'react';

/**
 * Regex to match URLs in plain text:
 * - http(s)://...   → href is the URL as-is
 * - www....         → href gets https:// prepended; visible text stays as
 *                     the user typed it.
 *
 * The whole match is wrapped in a single capturing group so String.split()
 * preserves the matched URLs at odd indices.
 */
const URL_PATTERN = /((?:https?:\/\/|\bwww\.)[^\s<>"')\]]+)/gi;

/**
 * Takes a plain text string and returns an array of React nodes where
 * URLs are wrapped in <a> tags with target="_blank".
 *
 * If the text contains no URLs, returns the original string (not an array)
 * so React can render it as a simple text node.
 */
export function linkifyText(text: string): ReactNode {
  const parts = text.split(URL_PATTERN);

  // No URLs found — split produces a single-element array
  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const href = part.startsWith('www.') ? `https://${part}` : part;
      return (
        <a key={i} href={href} target="_blank" rel="noopener noreferrer">
          {part}
        </a>
      );
    }
    return part;
  });
}
