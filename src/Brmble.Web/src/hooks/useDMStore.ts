import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { ChatMessage, User } from '../types';
import type { MessagePreview } from './useMatrixClient';

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

export interface BrmbleDMUser {
  matrixUserId: string;
  displayName: string;
  avatarUrl?: string;
}

export interface DMStoreOptions {
  matrixDmLastMessages: Map<string, MessagePreview> | undefined;
  activeDmMessages: ChatMessage[] | undefined;
  matrixDmRoomMap: Map<string, string> | undefined;
  matrixDmUserDisplayNames: Map<string, string> | undefined;
  matrixDmUserAvatarUrls: Map<string, string> | undefined;
  sendMatrixDM: ((targetMatrixUserId: string, text: string) => Promise<void>) | undefined;
  fetchDMHistory: ((targetMatrixUserId: string) => Promise<void>) | undefined;
  sendMumbleDM?: (targetSession: number, text: string) => void;
  brmbleUsers?: BrmbleDMUser[];
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
  startDM: (matrixUserId: string, displayName: string, avatarUrl?: string) => void;
  clearSelection: () => void;
  toggleMode: () => void;
  closeDM: (id: string) => void;
  appModeRef: React.RefObject<'channels' | 'dm'>;
  selectedContactIdRef: React.RefObject<string | null>;
  receiveMumbleDM: (certHash: string, sessionId: number, displayName: string, text: string) => void;
  updateMumbleSession: (certHash: string, sessionId: number | null, displayName?: string) => void;
  clearMumbleContacts: () => void;
  startMumbleDM: (certHash: string, sessionId: number, displayName: string) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MUMBLE_MESSAGES_MAX_PER_CONTACT = 200;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDMStore(options: DMStoreOptions): DMStore {
  const {
    matrixDmLastMessages,
    activeDmMessages,
    matrixDmRoomMap,
    matrixDmUserDisplayNames,
    matrixDmUserAvatarUrls,
    sendMatrixDM,
    fetchDMHistory,
    sendMumbleDM,
    brmbleUsers = [],
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
        const lastPreview = matrixDmLastMessages?.get(matrixUserId);

        // Resolve display name: Matrix room membership > Mumble user list > parse Matrix ID
        const displayName = matrixDmUserDisplayNames?.get(matrixUserId)
          ?? user?.name
          ?? matrixUserId.split(':')[0].replace('@', '');

        result.push({
          id: matrixUserId,
          displayName,
          avatarUrl: user?.avatarUrl ?? matrixDmUserAvatarUrls?.get(matrixUserId),
          lastMessage: lastPreview?.content,
          lastMessageTime: lastPreview?.ts,
          unreadCount: 0, // Matrix unread is tracked globally via matrixDmUnreadCount
        });
      }
    }

    // Merge all known Brmble users, including offline users and users without
    // an existing DM room. Selecting one keeps using the Matrix DM path.
    for (const directoryUser of brmbleUsers) {
      if (seen.has(directoryUser.matrixUserId)) continue;
      const user = users.find(u => u.matrixUserId === directoryUser.matrixUserId);
      seen.add(directoryUser.matrixUserId);
      result.push({
        id: directoryUser.matrixUserId,
        displayName: user?.name ?? directoryUser.displayName,
        avatarUrl: user?.avatarUrl ?? directoryUser.avatarUrl ?? matrixDmUserAvatarUrls?.get(directoryUser.matrixUserId),
        unreadCount: 0,
      });
    }

    // Merge online Brmble users that are visible in Mumble but were not present
    // in the directory snapshot for any reason.
    for (const user of users) {
      if (user.self || !user.matrixUserId || seen.has(user.matrixUserId)) continue;
      seen.add(user.matrixUserId);
      result.push({
        id: user.matrixUserId,
        displayName: user.name,
        avatarUrl: user.avatarUrl,
        unreadCount: 0,
      });
    }

    // Merge pending Matrix contacts (first-time DMs before room is created)
    for (const [id, pc] of pendingMatrixContacts) {
      if (!seen.has(id)) {
        seen.add(id);
        result.push(pc);
      }
    }

    // Merge online Mumble-only users and any existing ephemeral Mumble contacts.
    const ephemeral = new Map<string, DMContact>();
    for (const user of users) {
      if (user.self || !user.certHash || user.matrixUserId) continue;
      ephemeral.set(user.certHash, {
        id: user.certHash,
        displayName: user.name,
        avatarUrl: user.avatarUrl,
        unreadCount: 0,
        isEphemeral: true,
        mumbleCertHash: user.certHash,
        mumbleSessionId: user.session,
      });
    }

    for (const [, mc] of mumbleContacts) {
      const onlineContact = mc.mumbleCertHash ? ephemeral.get(mc.mumbleCertHash) : undefined;
      const msgs = mumbleMessages.get(mc.mumbleCertHash!);
      const lastMsg = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
      ephemeral.set(mc.mumbleCertHash!, {
        ...mc,
        displayName: onlineContact?.displayName ?? mc.displayName,
        avatarUrl: onlineContact?.avatarUrl ?? mc.avatarUrl,
        mumbleSessionId: onlineContact?.mumbleSessionId ?? mc.mumbleSessionId,
        lastMessage: lastMsg?.content,
        lastMessageTime: lastMsg?.timestamp.getTime(),
      });
    }

    const matrixContacts = result.sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0));
    const mumbleOnlyContacts = [...ephemeral.values()]
      .sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0) || a.displayName.localeCompare(b.displayName));
    result.splice(0, result.length, ...matrixContacts, ...mumbleOnlyContacts);
    return result;
  }, [matrixDmRoomMap, matrixDmLastMessages, matrixDmUserDisplayNames, matrixDmUserAvatarUrls, brmbleUsers, users, pendingMatrixContacts, mumbleContacts, mumbleMessages]);

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
    const matrixMsgs = activeDmMessages ?? [];
    const pending = pendingMessages.get(selectedContactId) ?? [];
    return [...matrixMsgs, ...pending];
  }, [selectedContactId, activeDmMessages, pendingMessages, mumbleMessages]);

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

  const startDM = useCallback((matrixUserId: string, displayName: string, avatarUrl?: string) => {
    // Add a pending contact if no DM room exists yet (first-time DM)
    if (!matrixDmRoomMap?.has(matrixUserId)) {
      setPendingMatrixContacts(prev => {
        if (prev.has(matrixUserId)) return prev;
        const next = new Map(prev);
        next.set(matrixUserId, {
          id: matrixUserId,
          displayName,
          avatarUrl,
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
        let updated = [...existing, msg];
        if (updated.length > MUMBLE_MESSAGES_MAX_PER_CONTACT) {
          updated = updated.slice(updated.length - MUMBLE_MESSAGES_MAX_PER_CONTACT);
        }
        next.set(selectedContactId!, updated);
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
      const contactId = selectedContactId;
      sendMatrixDM(contactId, content)
        .then(() => {
          setPendingMessages(prev => {
            const next = new Map(prev);
            const existing = next.get(contactId!) ?? [];
            next.set(contactId!, existing.filter(m => m.id !== optimisticMsg.id));
            return next;
          });
        })
        .catch(err => {
          console.error('Matrix DM send failed:', err);
          setPendingMessages(prev => {
            const next = new Map(prev);
            const existing = next.get(contactId!) ?? [];
            next.set(contactId!, existing.filter(m => m.id !== optimisticMsg.id));
            return next;
          });
        });
    }
  }, [selectedContactId, username, sendMatrixDM, mumbleContacts, sendMumbleDM]);

  const closeDM = useCallback((id: string) => {
    // Deselect if this contact is currently active
    if (selectedContactId === id) {
      setSelectedContactId(null);
    }
    // Ephemeral (Mumble) contacts: remove contact and messages entirely
    if (mumbleContacts.has(id)) {
      setMumbleContacts(prev => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setMumbleMessages(prev => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    }
  }, [selectedContactId, mumbleContacts]);

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
      let updated = [...existing, msg];
      if (updated.length > MUMBLE_MESSAGES_MAX_PER_CONTACT) {
        updated = updated.slice(updated.length - MUMBLE_MESSAGES_MAX_PER_CONTACT);
      }
      next.set(certHash, updated);
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
    updateMumbleSession,
    clearMumbleContacts,
    startMumbleDM,
  };
}
