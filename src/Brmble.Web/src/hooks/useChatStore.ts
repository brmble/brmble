import { useState, useEffect, useCallback } from 'react';
import type { ChatMessage, MediaAttachment } from '../types';

const STORAGE_KEY_PREFIX = 'brmble_chat_';

export function useChatStore(channelId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
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
  }, [channelId]);

  const saveMessages = useCallback((msgs: ChatMessage[]) => {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${channelId}`, JSON.stringify(msgs));
  }, [channelId]);

  const addMessage = useCallback((sender: string, content: string, type?: 'system', html?: boolean, media?: MediaAttachment[]) => {
    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      channelId,
      sender,
      content,
      timestamp: new Date(),
      ...(type && { type }),
      ...(html && { html }),
      ...(media && media.length > 0 && { media }),
    };
    setMessages(prev => {
      const updated = [...prev, newMessage];
      saveMessages(updated);
      return updated;
    });
  }, [channelId, saveMessages]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${channelId}`);
  }, [channelId]);

  /** Add a pre-built ChatMessage (e.g. optimistic image message). */
  const addRawMessage = useCallback((msg: ChatMessage) => {
    setMessages(prev => {
      const updated = [...prev, msg];
      saveMessages(updated);
      return updated;
    });
  }, [saveMessages]);

  /** Remove a message by id (e.g. dismiss a failed optimistic message). */
  const removeMessage = useCallback((messageId: string) => {
    setMessages(prev => {
      const updated = prev.filter(m => m.id !== messageId);
      saveMessages(updated);
      return updated;
    });
  }, [saveMessages]);

  /** Update fields on a message by id (e.g. clear pending, set error). */
  const updateMessage = useCallback((messageId: string, patch: Partial<ChatMessage>) => {
    setMessages(prev => {
      const updated = prev.map(m => m.id === messageId ? { ...m, ...patch } : m);
      saveMessages(updated);
      return updated;
    });
  }, [saveMessages]);

  return { messages, addMessage, addRawMessage, removeMessage, updateMessage, clearMessages };
}

/**
 * Write a message directly to a specific store key in localStorage,
 * bypassing React state. Used for background message storage when
 * the user is viewing a different chat panel.
 */
export function addMessageToStore(storeKey: string, sender: string, content: string, type?: 'system', html?: boolean, media?: MediaAttachment[]) {
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
  const newMessage: ChatMessage = {
    id: crypto.randomUUID(),
    channelId: storeKey,
    sender,
    content,
    timestamp: new Date(),
    ...(type && { type }),
    ...(html && { html }),
    ...(media && media.length > 0 && { media }),
  };
  messages.push(newMessage);
  localStorage.setItem(fullKey, JSON.stringify(messages));
}

/** Clear all chat messages from localStorage.
 *  Preserves server-root messages since those are current-session system messages. */
export function clearChatStorage() {
  const serverRootKey = `${STORAGE_KEY_PREFIX}server-root`;
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
