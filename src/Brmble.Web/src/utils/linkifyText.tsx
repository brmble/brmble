import type { ReactNode } from 'react';

/**
 * Regex to match HTTP/HTTPS URLs in plain text.
 * Uses a capturing group so String.split() preserves the matched URLs.
 */
const URL_PATTERN = /(https?:\/\/[^\s<>"')\]]+)/gi;

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

  return parts.map((part, i) =>
    URL_PATTERN.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    )
  );
}
