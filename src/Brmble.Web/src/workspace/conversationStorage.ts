import { conversationKey, type Conversation } from './conversation';

const STORAGE_VERSION = 1;
const STORAGE_PREFIX = 'brmble-conversation-tabs';

/**
 * Key under which one server's conversation tabs are persisted. `serverAddress` is the
 * address the workspace is connected to — the same value used to key the rest of the
 * per-server storage helpers. The `brmble-conversation-tabs:<serverAddress>` format is
 * load-bearing for existing users' saved tabs and must not change.
 */
export function conversationStorageKey(serverAddress: string): string {
  return `${STORAGE_PREFIX}:${serverAddress}`;
}

function isConversation(value: unknown): value is Conversation {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { kind?: unknown; channelId?: unknown; contactId?: unknown };
  if (candidate.kind === 'channel') return typeof candidate.channelId === 'string';
  if (candidate.kind === 'dm') return typeof candidate.contactId === 'string';
  return false;
}

function dedupe(conversations: Conversation[]): Conversation[] {
  const seen = new Set<string>();
  const result: Conversation[] = [];
  for (const conversation of conversations) {
    const key = conversationKey(conversation);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(conversation);
  }
  return result;
}

export function saveConversationTabs(serverAddress: string, tabs: Conversation[]): void {
  try {
    localStorage.setItem(
      conversationStorageKey(serverAddress),
      JSON.stringify({ version: STORAGE_VERSION, tabs: dedupe(tabs) }),
    );
  } catch {
    // Persistence is best-effort; a full or unavailable store must never break the UI.
  }
}

export function loadConversationTabs(
  serverAddress: string,
  isValid: (conversation: Conversation) => boolean,
): Conversation[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(conversationStorageKey(serverAddress));
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (typeof parsed !== 'object' || parsed === null) return [];
  const payload = parsed as { version?: unknown; tabs?: unknown };
  if (payload.version !== STORAGE_VERSION || !Array.isArray(payload.tabs)) return [];

  return dedupe(payload.tabs.filter(isConversation)).filter(isValid);
}
