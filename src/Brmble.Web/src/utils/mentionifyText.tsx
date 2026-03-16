import type { ReactNode } from 'react';

// Cache compiled regex by Set identity to avoid rebuilding on every render
let cachedSet: Set<string> | null = null;
let cachedPattern: RegExp | null = null;

function getMentionPattern(knownUsernames: Set<string>): RegExp | null {
  if (knownUsernames === cachedSet && cachedPattern) return cachedPattern;
  if (knownUsernames.size === 0) return null;

  const sortedNames = Array.from(knownUsernames).sort((a, b) => b.length - a.length);
  const escaped = sortedNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  cachedPattern = new RegExp(`@(${escaped.join('|')})(?=\\s|$|[.,!?;:])`, 'gi');
  cachedSet = knownUsernames;
  return cachedPattern;
}

/**
 * Detects @Username patterns in text and wraps them in styled spans.
 * Only matches known usernames to avoid false positives.
 *
 * @param text - Plain text string to process
 * @param knownUsernames - Set of known usernames (case-insensitive matching)
 * @param currentUsername - Current user's display name (for self-mention styling)
 * @returns Array of React nodes with mentions wrapped in styled spans
 */
export function mentionifyText(
  text: string,
  knownUsernames: Set<string>,
  currentUsername?: string,
): ReactNode {
  const pattern = getMentionPattern(knownUsernames);
  if (!pattern) return text;

  // Reset lastIndex since the regex is cached with the 'g' flag
  pattern.lastIndex = 0;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const matchedName = match[1];
    const isSelf = currentUsername
      ? matchedName.toLowerCase() === currentUsername.toLowerCase()
      : false;

    parts.push(
      <span
        key={match.index}
        className={`mention${isSelf ? ' mention--self' : ''}`}
      >
        @{matchedName}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  if (parts.length === 0) return text;

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
