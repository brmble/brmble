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

  return { messages, addMessage, clearMessages };
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

/** Clear all chat messages and DM contacts from localStorage.
 *  Preserves server-root messages since those are current-session system messages. */
export function clearChatStorage() {
  const serverRootKey = `${STORAGE_KEY_PREFIX}server-root`;
  Object.keys(localStorage)
    .filter(k => (k.startsWith(STORAGE_KEY_PREFIX) && k !== serverRootKey) || k.startsWith(DM_CONTACTS_KEY_PREFIX))
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

const DM_CONTACTS_KEY_PREFIX = 'brmble_dm_contacts';

/** Build a server-scoped DM contacts key. When no server is provided, falls back to
 *  the legacy global key so that callers without a server context still work. */
function dmContactsKey(serverAddress?: string): string {
  return serverAddress ? `${DM_CONTACTS_KEY_PREFIX}_${serverAddress}` : DM_CONTACTS_KEY_PREFIX;
}

export interface StoredDMContact {
  userId: string;
  userName: string;
  lastMessage?: string;
  lastMessageTime?: string;
  unread: number;
}

export function loadDMContacts(serverAddress?: string): StoredDMContact[] {
  const stored = localStorage.getItem(dmContactsKey(serverAddress));
  if (!stored) return [];
  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

export function saveDMContacts(contacts: StoredDMContact[], serverAddress?: string) {
  localStorage.setItem(dmContactsKey(serverAddress), JSON.stringify(contacts));
}

export function upsertDMContact(userId: string, userName: string, lastMessage?: string, incrementUnread?: boolean, serverAddress?: string) {
  const contacts = loadDMContacts(serverAddress);
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
  saveDMContacts(contacts, serverAddress);
  return contacts;
}

export function markDMContactRead(userId: string, serverAddress?: string): StoredDMContact[] {
  const contacts = loadDMContacts(serverAddress);
  const contact = contacts.find(c => c.userId === userId);
  if (contact) {
    contact.unread = 0;
    saveDMContacts(contacts, serverAddress);
  }
  return contacts;
}

export function removeDMContact(userId: string, serverAddress?: string): StoredDMContact[] {
  const contacts = loadDMContacts(serverAddress).filter(c => c.userId !== userId);
  saveDMContacts(contacts, serverAddress);
  return contacts;
}
