export function formatTypingIndicator(displayNames: string[]): string | null {
  if (displayNames.length === 0) return null;
  if (displayNames.length === 1) return `${displayNames[0]} is typing...`;
  if (displayNames.length === 2) return `${displayNames[0]} and ${displayNames[1]} are typing...`;
  return `${displayNames[0]}, ${displayNames[1]}, and others are typing...`;
}
