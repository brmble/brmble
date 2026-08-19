/**
 * An unread conversation is announced in exactly one place. Once a conversation is open
 * as a tab, the tab owns its badge and the sidebar row / contact entry goes quiet.
 *
 * Returns a NEW map with every entry whose conversation is open removed; the input is
 * never mutated. Aggregate counts (the OS/taskbar badge, total DM unread) must be
 * computed from the UNSUPPRESSED values — otherwise activity in a background tab would
 * be hidden while the window is unfocused.
 */
export function suppressOpenConversations<T>(
  entries: Map<string, T>,
  openKeys: Set<string>,
  keyOf: (id: string) => string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const [id, value] of entries) {
    if (openKeys.has(keyOf(id))) continue;
    result.set(id, value);
  }
  return result;
}
