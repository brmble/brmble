import { useState, useEffect, useCallback } from 'react';
import type { ChatMessage } from '../types';

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

  const addMessage = useCallback((sender: string, content: string, type?: 'system', html?: boolean) => {
    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      channelId,
      sender,
      content,
      timestamp: new Date(),
      ...(type && { type }),
      ...(html && { html }),
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

  return { messages, addMessage, clearMessages };
}

/**
 * Write a message directly to a specific store key in localStorage,
 * bypassing React state. Used for background message storage when
 * the user is viewing a different chat panel.
 */
export function addMessageToStore(storeKey: string, sender: string, content: string, type?: 'system', html?: boolean) {
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
  };
  messages.push(newMessage);
  localStorage.setItem(fullKey, JSON.stringify(messages));
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
