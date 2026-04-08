import { useState, useEffect, useCallback } from 'react';
import type { ChatMessage, MediaAttachment } from '../types';

const STORAGE_KEY_PREFIX = 'brmble_chat_';
const SERVER_ROOT_KEY = 'server-root';
const SERVER_ROOT_MAX_MESSAGES = 200;
const DEBOUNCE_MS = 500;

const EPHEMERAL_TYPES = new Set(['connecting', 'welcome', 'userJoined', 'userLeft']);

// --- Debounce infrastructure for server-root ---
//
// Two independent debounce paths exist for server-root localStorage writes:
//   1. bgBuffer/bgTimer — used by addMessageToStore() when the user is NOT viewing server-root
//   2. hookTimer/debouncedSave — used by the useChatStore hook when the user IS viewing server-root
//
// These paths are mutually exclusive by design: App.tsx routes messages through addMessageToStore
// when server-root is not the active channel, and through the hook's addMessage when it is.
// The useChatStore useEffect flushes bgBuffer on mount to prevent data loss on channel switch.

let bgBuffer: ChatMessage[] = [];
let bgTimer: ReturnType<typeof setTimeout> | null = null;

function flushBgBuffer() {
  if (bgTimer !== null) {
    clearTimeout(bgTimer);
    bgTimer = null;
  }
  if (bgBuffer.length === 0) return;

  const fullKey = `${STORAGE_KEY_PREFIX}${SERVER_ROOT_KEY}`;
  let messages: ChatMessage[] = [];
  const stored = localStorage.getItem(fullKey);
  if (stored) {
    try {
      messages = JSON.parse(stored);
    } catch {
      messages = [];
    }
  }

  messages.push(...bgBuffer);
  bgBuffer = [];

  if (messages.length > SERVER_ROOT_MAX_MESSAGES) {
    messages = messages.slice(messages.length - SERVER_ROOT_MAX_MESSAGES);
  }

  localStorage.setItem(fullKey, JSON.stringify(messages));
}

/**
 * Flush any pending debounced writes for a given channel.
 * Flushes both the background buffer (addMessageToStore) and the hook-based
 * debounce timer (useChatStore's saveMessages) to ensure localStorage is
 * fully up-to-date before reads or purges.
 */
export function flushPendingWrites(channelId: string) {
  if (channelId === SERVER_ROOT_KEY) {
    flushBgBuffer();
    flushHookTimer();
  }
}

/**
 * Purge ephemeral messages from localStorage for the given channel.
 * Removes messages with ephemeral systemType (connecting, welcome, userJoined, userLeft)
 * AND legacy server messages that predate the systemType field.
 * Flushes the debounce buffer first.
 */
export function purgeEphemeralMessages(channelId: string) {
  flushPendingWrites(channelId);

  const fullKey = `${STORAGE_KEY_PREFIX}${channelId}`;
  const stored = localStorage.getItem(fullKey);
  if (!stored) return;

  let messages: ChatMessage[];
  try {
    messages = JSON.parse(stored);
  } catch {
    return;
  }

  const filtered = messages.filter((m) => {
    // New messages: purge if systemType is ephemeral
    if (m.systemType) return !EPHEMERAL_TYPES.has(m.systemType);
    // Legacy server messages without systemType: purge (predates classification)
    if (m.sender === 'Server') return false;
    // User-sent messages: always keep
    return true;
  });

  if (filtered.length === 0) {
    localStorage.removeItem(fullKey);
  } else {
    localStorage.setItem(fullKey, JSON.stringify(filtered));
  }
}

// --- Hook-based debounce timer for server-root ---
//
// The pending payload (hookPendingKey/hookPendingMsgs) is stored at module level
// so that flushPendingWrites() can flush both the background buffer AND the hook
// debounce path. This prevents purgeEphemeralMessages() from missing pending
// hook writes that could overwrite the purge result.

let hookTimer: ReturnType<typeof setTimeout> | null = null;
let hookPendingKey: string | null = null;
let hookPendingMsgs: ChatMessage[] | null = null;

function flushHookTimer() {
  if (hookTimer !== null) {
    clearTimeout(hookTimer);
    hookTimer = null;
  }
  if (hookPendingKey !== null && hookPendingMsgs !== null) {
    localStorage.setItem(hookPendingKey, JSON.stringify(hookPendingMsgs));
    hookPendingKey = null;
    hookPendingMsgs = null;
  }
}

function debouncedSave(fullKey: string, msgs: ChatMessage[]) {
  if (hookTimer !== null) {
    clearTimeout(hookTimer);
  }
  hookPendingKey = fullKey;
  hookPendingMsgs = msgs;
  hookTimer = setTimeout(() => {
    hookTimer = null;
    localStorage.setItem(fullKey, JSON.stringify(msgs));
    hookPendingKey = null;
    hookPendingMsgs = null;
  }, DEBOUNCE_MS);
}

export function useChatStore(channelId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const isServerRoot = channelId === SERVER_ROOT_KEY;

  useEffect(() => {
    // On mount / channel switch, flush any pending server-root writes
    // so we read the latest data.
    if (isServerRoot) {
      flushBgBuffer();
      flushHookTimer();
    }

    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${channelId}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setMessages(parsed.map((m: ChatMessage) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        })));
      } catch {
        setMessages([]);
      }
    } else {
      setMessages([]);
    }

    // Cleanup: flush pending hook writes on unmount or channel change
    // to prevent stale/unpurged data from being written after disconnect.
    return () => {
      if (isServerRoot) {
        flushHookTimer();
      }
    };
  }, [channelId, isServerRoot]);

  const saveMessages = useCallback((msgs: ChatMessage[]) => {
    const fullKey = `${STORAGE_KEY_PREFIX}${channelId}`;
    if (isServerRoot) {
      debouncedSave(fullKey, msgs);
    } else {
      localStorage.setItem(fullKey, JSON.stringify(msgs));
    }
  }, [channelId, isServerRoot]);

  const addMessage = useCallback((
    sender: string,
    content: string,
    type?: 'system',
    html?: boolean,
    media?: MediaAttachment[],
    systemType?: string,
    replyTo?: { sender: string; content: string },
  ) => {
    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      channelId,
      sender,
      content,
      timestamp: new Date(),
      ...(type && { type }),
      ...(systemType && { systemType }),
      ...(html && { html }),
      ...(media && { media }),
      ...(replyTo && { replyTo }),
      ...(media && media.length > 0 && { media }),
    };
    setMessages(prev => {
      let updated = [...prev, newMessage];
      if (isServerRoot && updated.length > SERVER_ROOT_MAX_MESSAGES) {
        updated = updated.slice(updated.length - SERVER_ROOT_MAX_MESSAGES);
      }
      saveMessages(updated);
      return updated;
    });
  }, [channelId, isServerRoot, saveMessages]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${channelId}`);
  }, [channelId]);

  return { messages, addMessage, clearMessages };
}

/**
 * Write a message directly to a specific store key in localStorage,
 * bypassing React state. Used for background message storage when
 * the user is viewing a different chat panel.
 *
 * For server-root, writes are debounced. For other channels, writes are immediate.
 */
export function addMessageToStore(
  storeKey: string,
  sender: string,
  content: string,
  type?: 'system',
  html?: boolean,
  media?: MediaAttachment[],
  systemType?: string,
) {
  const newMessage: ChatMessage = {
    id: crypto.randomUUID(),
    channelId: storeKey,
    sender,
    content,
    timestamp: new Date(),
    ...(type && { type }),
    ...(systemType && { systemType }),
    ...(html && { html }),
    ...(media && media.length > 0 && { media }),
  };

  if (storeKey === SERVER_ROOT_KEY) {
    bgBuffer.push(newMessage);
    if (bgTimer !== null) {
      clearTimeout(bgTimer);
    }
    bgTimer = setTimeout(flushBgBuffer, DEBOUNCE_MS);
    return;
  }

  // Non-server-root: immediate write
  const fullKey = `${STORAGE_KEY_PREFIX}${storeKey}`;
  let messages: ChatMessage[] = [];
  const stored = localStorage.getItem(fullKey);
  if (stored) {
    try {
      messages = JSON.parse(stored);
    } catch {
      messages = [];
    }
  }
  messages.push(newMessage);
  localStorage.setItem(fullKey, JSON.stringify(messages));
}

/** Clear all chat messages from localStorage.
 *  Preserves server-root messages since those are current-session system messages. */
export function clearChatStorage() {
  const serverRootKey = `${STORAGE_KEY_PREFIX}${SERVER_ROOT_KEY}`;
  Object.keys(localStorage)
    .filter(k => k.startsWith(STORAGE_KEY_PREFIX) && k !== serverRootKey)
    .forEach(k => localStorage.removeItem(k));
}

export function useAllChats() {
  const getAllChannelIds = useCallback(() => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(STORAGE_KEY_PREFIX));
    return keys.map(k => k.replace(STORAGE_KEY_PREFIX, ''));
  }, []);

  const clearAllChats = useCallback(() => {
    getAllChannelIds().forEach(channelId => {
      localStorage.removeItem(`${STORAGE_KEY_PREFIX}${channelId}`);
    });
  }, [getAllChannelIds]);

  return { getAllChannelIds, clearAllChats };
}
