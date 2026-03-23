import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { ChatMessage, User } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DMContact {
  /** Primary key: Matrix user ID for Brmble users, "mumble:session:{id}" for Mumble-only */
  id: string;
  displayName: string;
  avatarUrl?: string;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount: number;
  /** true for Mumble-only contacts (no Matrix ID, ephemeral session) */
  isEphemeral: boolean;
  /** Mumble session ID, used for Mumble fallback sends */
  sessionId?: number;
}

export interface DMStoreOptions {
  matrixDmMessages: Map<string, ChatMessage[]> | undefined;
  matrixDmRoomMap: Map<string, string> | undefined;
  matrixDmUserDisplayNames: Map<string, string> | undefined;
  sendMatrixDM: ((targetMatrixUserId: string, text: string) => Promise<void>) | undefined;
  fetchDMHistory: ((targetMatrixUserId: string) => Promise<void>) | undefined;
  users: User[];
  username: string;
  bridgeSend: (event: string, data: unknown) => void;
}

export interface DMStore {
  contacts: DMContact[];
  selectedContact: DMContact | null;
  messages: ChatMessage[];
  appMode: 'channels' | 'dm';
  selectContact: (id: string) => void;
  sendMessage: (content: string) => void;
  startDM: (matrixUserId: string, displayName: string) => void;
  clearSelection: () => void;
  toggleMode: () => void;
  closeDM: (id: string) => void;
  receiveMumbleDM: (senderSession: number, senderName: string, text: string, media?: ChatMessage['media']) => void;
  mumbleUnreadCount: number;
  appModeRef: React.RefObject<'channels' | 'dm'>;
  selectedContactIdRef: React.RefObject<string | null>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mumbleContactId(sessionId: number): string {
  return `mumble:session:${sessionId}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDMStore(options: DMStoreOptions): DMStore {
  const {
    matrixDmMessages,
    matrixDmRoomMap,
    matrixDmUserDisplayNames,
    sendMatrixDM,
    fetchDMHistory,
    users,
    username,
    bridgeSend,
  } = options;

  // ---- Core state ----------------------------------------------------------

  const [appMode, setAppMode] = useState<'channels' | 'dm'>('channels');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [mumbleDmMessages, setMumbleDmMessages] = useState<Map<string, ChatMessage[]>>(new Map());
  const [mumbleContacts, setMumbleContacts] = useState<DMContact[]>([]);
  const [pendingMessages, setPendingMessages] = useState<Map<string, ChatMessage[]>>(new Map());

  // ---- Refs for bridge callbacks -------------------------------------------

  const appModeRef = useRef<'channels' | 'dm'>('channels');
  const selectedContactIdRef = useRef<string | null>(null);

  useEffect(() => {
    appModeRef.current = appMode;
  }, [appMode]);

  useEffect(() => {
    selectedContactIdRef.current = selectedContactId;
  }, [selectedContactId]);

  // ---- Reset on disconnect -------------------------------------------------

  useEffect(() => {
    if (users.length === 0) {
      setAppMode('channels');
      setSelectedContactId(null);
      setMumbleDmMessages(new Map());
      setMumbleContacts([]);
      setPendingMessages(new Map());
      appModeRef.current = 'channels';
      selectedContactIdRef.current = null;
    }
  }, [users.length]);

  // ---- Matrix contacts derived from matrixDmRoomMap ------------------------

  const matrixContacts: DMContact[] = useMemo(() => {
    if (!matrixDmRoomMap) return [];

    const contacts: DMContact[] = [];
    for (const [matrixUserId] of matrixDmRoomMap) {
      const user = users.find(u => u.matrixUserId === matrixUserId);
      const msgs = matrixDmMessages?.get(matrixUserId);
      const lastMsg = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : undefined;

      // Resolve display name: Matrix room membership > Mumble user list > parse Matrix ID
      const displayName = matrixDmUserDisplayNames?.get(matrixUserId)
        ?? user?.name
        ?? matrixUserId.split(':')[0].replace('@', '');

      contacts.push({
        id: matrixUserId,
        displayName,
        avatarUrl: user?.avatarUrl,
        lastMessage: lastMsg?.content,
        lastMessageTime: lastMsg?.timestamp.getTime(),
        unreadCount: 0, // Matrix unread is tracked globally via matrixDmUnreadCount
        isEphemeral: false,
      });
    }

    return contacts;
  }, [matrixDmRoomMap, matrixDmMessages, matrixDmUserDisplayNames, users]);

  // ---- Combined contacts ---------------------------------------------------

  const contacts: DMContact[] = useMemo(() => {
    const merged = [...matrixContacts, ...mumbleContacts];
    merged.sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0));
    return merged;
  }, [matrixContacts, mumbleContacts]);

  // ---- Selected contact ----------------------------------------------------

  const selectedContact: DMContact | null = useMemo(() => {
    if (!selectedContactId) return null;
    return contacts.find(c => c.id === selectedContactId) ?? null;
  }, [contacts, selectedContactId]);

  // ---- Messages for selected contact ---------------------------------------

  const messages: ChatMessage[] = useMemo(() => {
    if (!selectedContactId) return [];

    if (!selectedContactId.startsWith('mumble:session:')) {
      const matrixMsgs = matrixDmMessages?.get(selectedContactId) ?? [];
      const pending = pendingMessages.get(selectedContactId) ?? [];
      return [...matrixMsgs, ...pending];
    }

    return mumbleDmMessages.get(selectedContactId) ?? [];
  }, [selectedContactId, matrixDmMessages, mumbleDmMessages, pendingMessages]);

  // ---- Actions -------------------------------------------------------------

  const selectContact = useCallback((id: string) => {
    setSelectedContactId(id);
    setAppMode('dm');

    // Fetch Matrix DM history if it's a Matrix contact
    const isMumble = id.startsWith('mumble:session:');
    if (!isMumble && fetchDMHistory) {
      fetchDMHistory(id).catch(console.warn);
    }

    // Clear unread for mumble contacts
    if (isMumble) {
      setMumbleContacts(prev =>
        prev.map(c => c.id === id ? { ...c, unreadCount: 0 } : c)
      );
    }
  }, [fetchDMHistory]);

  const startDM = useCallback((matrixUserId: string, _displayName: string) => {
    setSelectedContactId(matrixUserId);
    setAppMode('dm');

    if (fetchDMHistory) {
      fetchDMHistory(matrixUserId).catch(console.warn);
    }
  }, [fetchDMHistory]);

  const clearSelection = useCallback(() => {
    setSelectedContactId(null);
  }, []);

  const toggleMode = useCallback(() => {
    setAppMode(prev => {
      const next = prev === 'channels' ? 'dm' : 'channels';
      return next;
    });
  }, []);

  const sendMessage = useCallback((content: string) => {
    if (!selectedContactId) return;

    if (selectedContactId.startsWith('mumble:session:')) {
      // Mumble fallback path
      const now = new Date();
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        channelId: selectedContactId,
        sender: username,
        content,
        timestamp: now,
      };

      setMumbleDmMessages(prev => {
        const existing = prev.get(selectedContactId!) ?? [];
        const updated = new Map(prev);
        updated.set(selectedContactId!, [...existing, msg]);
        return updated;
      });

      // Update last message on contact
      setMumbleContacts(prev =>
        prev.map(c =>
          c.id === selectedContactId
            ? { ...c, lastMessage: content, lastMessageTime: now.getTime() }
            : c
        )
      );

      const contact = contacts.find(c => c.id === selectedContactId);
      if (contact?.sessionId != null) {
        bridgeSend('voice.sendPrivateMessage', {
          targetSession: contact.sessionId,
          message: content,
        });
      }
    } else {
      // Matrix path — insert optimistic local echo
      const optimisticMsg: ChatMessage = {
        id: `pending-${Date.now()}-${Math.random()}`,
        channelId: selectedContactId,
        sender: username,
        content,
        timestamp: new Date(),
        pending: true,
      };
      setPendingMessages(prev => {
        const next = new Map(prev);
        const existing = next.get(selectedContactId!) ?? [];
        next.set(selectedContactId!, [...existing, optimisticMsg]);
        return next;
      });

      if (sendMatrixDM) {
        sendMatrixDM(selectedContactId, content)
          .then(() => {
            // Remove optimistic message -- the real one arrives via sync
            setPendingMessages(prev => {
              const next = new Map(prev);
              const existing = next.get(selectedContactId!) ?? [];
              next.set(selectedContactId!, existing.filter(m => m.id !== optimisticMsg.id));
              return next;
            });
          })
          .catch(console.error);
      }
    }
  }, [selectedContactId, contacts, username, bridgeSend, sendMatrixDM]);

  const receiveMumbleDM = useCallback((
    senderSession: number,
    senderName: string,
    text: string,
    media?: ChatMessage['media'],
  ) => {
    // Skip if sender has a Matrix user ID (Matrix handles it)
    const senderUser = users.find(u => u.session === senderSession);
    if (senderUser?.matrixUserId) return;

    const contactId = mumbleContactId(senderSession);
    const now = new Date();

    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      channelId: contactId,
      sender: senderName,
      content: text,
      timestamp: now,
      ...(media && { media }),
    };

    // Add message
    setMumbleDmMessages(prev => {
      const existing = prev.get(contactId) ?? [];
      const updated = new Map(prev);
      updated.set(contactId, [...existing, msg]);
      return updated;
    });

    // Create or update contact
    setMumbleContacts(prev => {
      const existing = prev.find(c => c.id === contactId);
      if (existing) {
        return prev.map(c =>
          c.id === contactId
            ? {
                ...c,
                lastMessage: text,
                lastMessageTime: now.getTime(),
                unreadCount: (appModeRef.current === 'dm' && selectedContactIdRef.current === contactId) ? c.unreadCount : c.unreadCount + 1,
              }
            : c
        );
      }

      return [
        ...prev,
        {
          id: contactId,
          displayName: senderName,
          lastMessage: text,
          lastMessageTime: now.getTime(),
          unreadCount: (appModeRef.current === 'dm' && selectedContactIdRef.current === contactId) ? 0 : 1,
          isEphemeral: true,
          sessionId: senderSession,
        },
      ];
    });
  }, [users]);

  const closeDM = useCallback((id: string) => {
    if (id.startsWith('mumble:session:')) {
      // Remove mumble contact and messages
      setMumbleContacts(prev => prev.filter(c => c.id !== id));
      setMumbleDmMessages(prev => {
        const updated = new Map(prev);
        updated.delete(id);
        return updated;
      });

      if (selectedContactId === id) {
        setSelectedContactId(null);
      }
    } else {
      // Matrix contacts can't be "closed" — just deselect if active
      if (selectedContactId === id) {
        setSelectedContactId(null);
      }
    }
  }, [selectedContactId]);

  // ---- Mumble unread count -------------------------------------------------

  const mumbleUnreadCount = useMemo(() => {
    return mumbleContacts.reduce((sum, c) => sum + c.unreadCount, 0);
  }, [mumbleContacts]);

  // ---- Return --------------------------------------------------------------

  return {
    contacts,
    selectedContact,
    messages,
    appMode,
    selectContact,
    sendMessage,
    startDM,
    clearSelection,
    toggleMode,
    closeDM,
    receiveMumbleDM,
    mumbleUnreadCount,
    appModeRef,
    selectedContactIdRef,
  };
}
