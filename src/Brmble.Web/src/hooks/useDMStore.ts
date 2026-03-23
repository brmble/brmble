import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { ChatMessage, User } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DMContact {
  /** Primary key: Matrix user ID (e.g. "@5:noscope.it") */
  id: string;
  displayName: string;
  avatarUrl?: string;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount: number;
}

export interface DMStoreOptions {
  matrixDmMessages: Map<string, ChatMessage[]> | undefined;
  matrixDmRoomMap: Map<string, string> | undefined;
  matrixDmUserDisplayNames: Map<string, string> | undefined;
  sendMatrixDM: ((targetMatrixUserId: string, text: string) => Promise<void>) | undefined;
  fetchDMHistory: ((targetMatrixUserId: string) => Promise<void>) | undefined;
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
  } = options;

  // ---- Core state ----------------------------------------------------------

  const [appMode, setAppMode] = useState<'channels' | 'dm'>('channels');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
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
      setPendingMessages(new Map());
      appModeRef.current = 'channels';
      selectedContactIdRef.current = null;
    }
  }, [users.length]);

  // ---- Matrix contacts derived from matrixDmRoomMap ------------------------

  const contacts: DMContact[] = useMemo(() => {
    if (!matrixDmRoomMap) return [];

    const result: DMContact[] = [];
    for (const [matrixUserId] of matrixDmRoomMap) {
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
        avatarUrl: user?.avatarUrl,
        lastMessage: lastMsg?.content,
        lastMessageTime: lastMsg?.timestamp.getTime(),
        unreadCount: 0, // Matrix unread is tracked globally via matrixDmUnreadCount
      });
    }

    result.sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0));
    return result;
  }, [matrixDmRoomMap, matrixDmMessages, matrixDmUserDisplayNames, users]);

  // ---- Selected contact ----------------------------------------------------

  const selectedContact: DMContact | null = useMemo(() => {
    if (!selectedContactId) return null;
    return contacts.find(c => c.id === selectedContactId) ?? null;
  }, [contacts, selectedContactId]);

  // ---- Messages for selected contact ---------------------------------------

  const messages: ChatMessage[] = useMemo(() => {
    if (!selectedContactId) return [];
    const matrixMsgs = matrixDmMessages?.get(selectedContactId) ?? [];
    const pending = pendingMessages.get(selectedContactId) ?? [];
    return [...matrixMsgs, ...pending];
  }, [selectedContactId, matrixDmMessages, pendingMessages]);

  // ---- Actions -------------------------------------------------------------

  const selectContact = useCallback((id: string) => {
    setSelectedContactId(id);
    setAppMode('dm');

    if (fetchDMHistory) {
      fetchDMHistory(id).catch(console.warn);
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
    setAppMode(prev => prev === 'channels' ? 'dm' : 'channels');
  }, []);

  const sendMessage = useCallback((content: string) => {
    if (!selectedContactId) return;

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
  }, [selectedContactId, username, sendMatrixDM]);

  const closeDM = useCallback((id: string) => {
    // Matrix contacts can't truly be "closed" — just deselect if active
    if (selectedContactId === id) {
      setSelectedContactId(null);
    }
  }, [selectedContactId]);

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
  };
}
