import { useState, useEffect, useCallback } from 'react';
import type { ChatMessage } from '../types';

const STORAGE_KEY_PREFIX = 'brmble_chat_';
const MAX_MESSAGES_PER_STORE = 500;

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // QuotaExceededError — evict oldest half and retry
    try {
      const parsed: unknown[] = JSON.parse(value);
      const trimmed = parsed.slice(Math.floor(parsed.length / 2));
      localStorage.setItem(key, JSON.stringify(trimmed));
    } catch {
      // Give up silently — messages still in React state
    }
  }
}

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
    safeSetItem(`${STORAGE_KEY_PREFIX}${channelId}`, JSON.stringify(msgs));
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
      let updated = [...prev, newMessage];
      if (updated.length > MAX_MESSAGES_PER_STORE) {
        updated = updated.slice(updated.length - MAX_MESSAGES_PER_STORE);
      }
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
  if (messages.length > MAX_MESSAGES_PER_STORE) {
    messages = messages.slice(messages.length - MAX_MESSAGES_PER_STORE);
  }
  safeSetItem(fullKey, JSON.stringify(messages));
}

/** Clear all chat messages and DM contacts from localStorage. */
export function clearChatStorage() {
  Object.keys(localStorage)
    .filter(k => k.startsWith(STORAGE_KEY_PREFIX) || k === DM_CONTACTS_KEY)
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

const DM_CONTACTS_KEY = 'brmble_dm_contacts';

export interface StoredDMContact {
  userId: string;
  userName: string;
  lastMessage?: string;
  lastMessageTime?: string;
  unread: number;
}

export function loadDMContacts(): StoredDMContact[] {
  const stored = localStorage.getItem(DM_CONTACTS_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

export function saveDMContacts(contacts: StoredDMContact[]) {
  localStorage.setItem(DM_CONTACTS_KEY, JSON.stringify(contacts));
}

export function upsertDMContact(userId: string, userName: string, lastMessage?: string, incrementUnread?: boolean) {
  const contacts = loadDMContacts();
  const existing = contacts.find(c => c.userId === userId);
  if (existing) {
    existing.userName = userName;
    if (lastMessage) {
      existing.lastMessage = lastMessage;
      existing.lastMessageTime = new Date().toISOString();
    }
    if (incrementUnread) {
      existing.unread = (existing.unread || 0) + 1;
    }
  } else {
    contacts.unshift({
      userId,
      userName,
      lastMessage,
      lastMessageTime: lastMessage ? new Date().toISOString() : undefined,
      unread: incrementUnread ? 1 : 0,
    });
  }
  // Sort by most recent message
  contacts.sort((a, b) => {
    if (!a.lastMessageTime) return 1;
    if (!b.lastMessageTime) return -1;
    return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime();
  });
  saveDMContacts(contacts);
  return contacts;
}

export function markDMContactRead(userId: string): StoredDMContact[] {
  const contacts = loadDMContacts();
  const contact = contacts.find(c => c.userId === userId);
  if (contact) {
    contact.unread = 0;
    saveDMContacts(contacts);
  }
  return contacts;
}
