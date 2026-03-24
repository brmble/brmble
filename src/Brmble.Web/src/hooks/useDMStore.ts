import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { ChatMessage, User } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DMContact {
  /** Primary key: matrixUserId for Matrix contacts, mumbleCertHash for Mumble contacts */
  id: string;
  displayName: string;
  avatarUrl?: string;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount: number;
  // Mumble DM fields (only set for ephemeral Mumble contacts)
  isEphemeral?: boolean;
  mumbleCertHash?: string;
  mumbleSessionId?: number | null;  // null = offline
}

export interface DMStoreOptions {
  matrixDmMessages: Map<string, ChatMessage[]> | undefined;
  matrixDmRoomMap: Map<string, string> | undefined;
  matrixDmUserDisplayNames: Map<string, string> | undefined;
  matrixDmUserAvatarUrls: Map<string, string> | undefined;
  sendMatrixDM: ((targetMatrixUserId: string, text: string) => Promise<void>) | undefined;
  fetchDMHistory: ((targetMatrixUserId: string) => Promise<void>) | undefined;
  sendMumbleDM?: (targetSession: number, text: string) => void;
  users: User[];
  username: string;
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
  appModeRef: React.RefObject<'channels' | 'dm'>;
  selectedContactIdRef: React.RefObject<string | null>;
  receiveMumbleDM: (certHash: string, sessionId: number, displayName: string, text: string) => void;
  /** Inject a received message into a Matrix DM contact's message list (e.g. Mumble PM from a hybrid user). */
  addIncomingDMMessage: (matrixUserId: string, senderName: string, text: string) => void;
  updateMumbleSession: (certHash: string, sessionId: number | null, displayName?: string) => void;
  clearMumbleContacts: () => void;
  startMumbleDM: (certHash: string, sessionId: number, displayName: string) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDMStore(options: DMStoreOptions): DMStore {
  const {
    matrixDmMessages,
    matrixDmRoomMap,
    matrixDmUserDisplayNames,
    matrixDmUserAvatarUrls,
    sendMatrixDM,
    fetchDMHistory,
    sendMumbleDM,
    users,
    username,
  } = options;

  // ---- Core state ----------------------------------------------------------

  const [appMode, setAppMode] = useState<'channels' | 'dm'>('channels');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [pendingMessages, setPendingMessages] = useState<Map<string, ChatMessage[]>>(new Map());
  const [pendingMatrixContacts, setPendingMatrixContacts] = useState<Map<string, DMContact>>(new Map());
  const [mumbleContacts, setMumbleContacts] = useState<Map<string, DMContact>>(new Map());
  const [mumbleMessages, setMumbleMessages] = useState<Map<string, ChatMessage[]>>(new Map());

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
      setPendingMessages(new Map());
      setPendingMatrixContacts(new Map());
      setMumbleContacts(new Map());
      setMumbleMessages(new Map());
      appModeRef.current = 'channels';
      selectedContactIdRef.current = null;
    }
  }, [users.length]);

  // ---- Matrix contacts derived from matrixDmRoomMap ------------------------

  const contacts: DMContact[] = useMemo(() => {
    const result: DMContact[] = [];
    const seen = new Set<string>();

    if (matrixDmRoomMap) {
      for (const [matrixUserId] of matrixDmRoomMap) {
        seen.add(matrixUserId);
        const user = users.find(u => u.matrixUserId === matrixUserId);
        const msgs = matrixDmMessages?.get(matrixUserId);
        const lastMsg = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : undefined;

        // Resolve display name: Matrix room membership > Mumble user list > parse Matrix ID
        const displayName = matrixDmUserDisplayNames?.get(matrixUserId)
          ?? user?.name
          ?? matrixUserId.split(':')[0].replace('@', '');

        result.push({
          id: matrixUserId,
          displayName,
          avatarUrl: user?.avatarUrl ?? matrixDmUserAvatarUrls?.get(matrixUserId),
          lastMessage: lastMsg?.content,
          lastMessageTime: lastMsg?.timestamp.getTime(),
          unreadCount: 0, // Matrix unread is tracked globally via matrixDmUnreadCount
        });
      }
    }

    // Merge pending Matrix contacts (first-time DMs before room is created)
    for (const [id, pc] of pendingMatrixContacts) {
      if (!seen.has(id)) {
        result.push(pc);
      }
    }

    // Merge Mumble contacts
    for (const [, mc] of mumbleContacts) {
      const msgs = mumbleMessages.get(mc.mumbleCertHash!);
      const lastMsg = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
      result.push({
        ...mc,
        lastMessage: lastMsg?.content,
        lastMessageTime: lastMsg?.timestamp.getTime(),
      });
    }

    result.sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0));
    return result;
  }, [matrixDmRoomMap, matrixDmMessages, matrixDmUserDisplayNames, matrixDmUserAvatarUrls, users, pendingMatrixContacts, mumbleContacts, mumbleMessages]);

  // ---- Selected contact ----------------------------------------------------

  const selectedContact: DMContact | null = useMemo(() => {
    if (!selectedContactId) return null;
    return contacts.find(c => c.id === selectedContactId) ?? null;
  }, [contacts, selectedContactId]);

  // ---- Messages for selected contact ---------------------------------------

  const messages: ChatMessage[] = useMemo(() => {
    if (!selectedContactId) return [];
    // Check if this is a Mumble contact
    const mumbleMsgs = mumbleMessages.get(selectedContactId);
    if (mumbleMsgs) return mumbleMsgs;
    // Otherwise Matrix messages
    const matrixMsgs = matrixDmMessages?.get(selectedContactId) ?? [];
    const pending = pendingMessages.get(selectedContactId) ?? [];
    return [...matrixMsgs, ...pending];
  }, [selectedContactId, matrixDmMessages, pendingMessages, mumbleMessages]);

  // ---- Actions -------------------------------------------------------------

  const selectContact = useCallback((id: string) => {
    setSelectedContactId(id);
    setAppMode('dm');

    // Clear Mumble unread if applicable
    setMumbleContacts(prev => {
      const contact = prev.get(id);
      if (contact && contact.unreadCount > 0) {
        const next = new Map(prev);
        next.set(id, { ...contact, unreadCount: 0 });
        return next;
      }
      return prev;
    });

    if (fetchDMHistory) {
      fetchDMHistory(id).catch(console.warn);
    }
  }, [fetchDMHistory]);

  const startDM = useCallback((matrixUserId: string, displayName: string) => {
    // Add a pending contact if no DM room exists yet (first-time DM)
    if (!matrixDmRoomMap?.has(matrixUserId)) {
      setPendingMatrixContacts(prev => {
        if (prev.has(matrixUserId)) return prev;
        const next = new Map(prev);
        next.set(matrixUserId, {
          id: matrixUserId,
          displayName,
          unreadCount: 0,
        });
        return next;
      });
    }

    setSelectedContactId(matrixUserId);
    setAppMode('dm');

    if (fetchDMHistory) {
      fetchDMHistory(matrixUserId).catch(console.warn);
    }
  }, [fetchDMHistory, matrixDmRoomMap]);

  const addIncomingDMMessage = useCallback((matrixUserId: string, senderName: string, text: string) => {
    // Ensure contact exists (first-time DM from hybrid user via Mumble PM)
    if (!matrixDmRoomMap?.has(matrixUserId)) {
      setPendingMatrixContacts(prev => {
        if (prev.has(matrixUserId)) return prev;
        const next = new Map(prev);
        next.set(matrixUserId, {
          id: matrixUserId,
          displayName: senderName,
          unreadCount: 0,
        });
        return next;
      });
    }

    const msg: ChatMessage = {
      id: `mumble-routed-${Date.now()}-${Math.random()}`,
      channelId: matrixUserId,
      sender: senderName,
      content: text,
      timestamp: new Date(),
    };
    setPendingMessages(prev => {
      const next = new Map(prev);
      const existing = next.get(matrixUserId) ?? [];
      next.set(matrixUserId, [...existing, msg]);
      return next;
    });

    // Increment unread if not currently viewing this contact
    if (selectedContactIdRef.current !== matrixUserId || appModeRef.current !== 'dm') {
      setPendingMatrixContacts(prev => {
        const next = new Map(prev);
        const contact = next.get(matrixUserId);
        if (contact) {
          next.set(matrixUserId, { ...contact, unreadCount: contact.unreadCount + 1 });
        }
        return next;
      });
    }
  }, [matrixDmRoomMap]);

  const clearSelection = useCallback(() => {
    setSelectedContactId(null);
  }, []);

  const toggleMode = useCallback(() => {
    setAppMode(prev => prev === 'channels' ? 'dm' : 'channels');
  }, []);

  const sendMessage = useCallback((content: string) => {
    if (!selectedContactId) return;

    const contact = mumbleContacts.get(selectedContactId);
    if (contact?.isEphemeral) {
      // Mumble DM path
      if (contact.mumbleSessionId == null) return; // offline, can't send
      const msg: ChatMessage = {
        id: `mumble-${Date.now()}-${Math.random()}`,
        channelId: selectedContactId,
        sender: username,
        content,
        timestamp: new Date(),
      };
      setMumbleMessages(prev => {
        const next = new Map(prev);
        const existing = next.get(selectedContactId!) ?? [];
        next.set(selectedContactId!, [...existing, msg]);
        return next;
      });
      sendMumbleDM?.(contact.mumbleSessionId, content);
      return;
    }

    // Insert optimistic local echo
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
  }, [selectedContactId, username, sendMatrixDM, mumbleContacts, sendMumbleDM]);

  const closeDM = useCallback((id: string) => {
    // Matrix contacts can't truly be "closed" — just deselect if active
    if (selectedContactId === id) {
      setSelectedContactId(null);
    }
  }, [selectedContactId]);

  // ---- Mumble-specific actions ---------------------------------------------

  const receiveMumbleDM = useCallback((certHash: string, sessionId: number, displayName: string, text: string) => {
    // Ensure contact exists
    setMumbleContacts(prev => {
      const next = new Map(prev);
      if (!next.has(certHash)) {
        next.set(certHash, {
          id: certHash,
          displayName,
          unreadCount: 0,
          isEphemeral: true,
          mumbleCertHash: certHash,
          mumbleSessionId: sessionId,
        });
      }
      return next;
    });
    // Append message
    const msg: ChatMessage = {
      id: `mumble-${Date.now()}-${Math.random()}`,
      channelId: certHash,
      sender: displayName,
      content: text,
      timestamp: new Date(),
    };
    setMumbleMessages(prev => {
      const next = new Map(prev);
      const existing = next.get(certHash) ?? [];
      next.set(certHash, [...existing, msg]);
      return next;
    });
    // Increment unread if not currently viewing this contact
    if (selectedContactIdRef.current !== certHash || appModeRef.current !== 'dm') {
      setMumbleContacts(prev => {
        const next = new Map(prev);
        const contact = next.get(certHash);
        if (contact) {
          next.set(certHash, { ...contact, unreadCount: contact.unreadCount + 1 });
        }
        return next;
      });
    }
  }, []);

  const updateMumbleSession = useCallback((certHash: string, sessionId: number | null, displayName?: string) => {
    setMumbleContacts(prev => {
      const contact = prev.get(certHash);
      if (!contact) return prev;
      const next = new Map(prev);
      next.set(certHash, {
        ...contact,
        mumbleSessionId: sessionId,
        displayName: displayName ?? contact.displayName,
      });
      return next;
    });
  }, []);

  const clearMumbleContacts = useCallback(() => {
    setMumbleContacts(new Map());
    setMumbleMessages(new Map());
  }, []);

  const startMumbleDM = useCallback((certHash: string, sessionId: number, displayName: string) => {
    setMumbleContacts(prev => {
      const next = new Map(prev);
      if (!next.has(certHash)) {
        next.set(certHash, {
          id: certHash,
          displayName,
          unreadCount: 0,
          isEphemeral: true,
          mumbleCertHash: certHash,
          mumbleSessionId: sessionId,
        });
      }
      return next;
    });
    setSelectedContactId(certHash);
    setAppMode('dm');
  }, []);

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
    appModeRef,
    selectedContactIdRef,
    receiveMumbleDM,
    addIncomingDMMessage,
    updateMumbleSession,
    clearMumbleContacts,
    startMumbleDM,
  };
}
