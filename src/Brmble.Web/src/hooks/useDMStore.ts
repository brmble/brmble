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
  /** Active Mumble session for an online Matrix contact, used only by user-info controls. */
  onlineSessionId?: number;
  // Mumble DM fields (only set for ephemeral Mumble contacts)
  isEphemeral?: boolean;
  mumbleCertHash?: string;
  mumbleSessionId?: number | null;  // null = offline or no active standard-Mumble route
  persistedFromDirectory?: boolean;
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
  isSelectedConversationForeground: () => boolean;
  users: User[];
  username: string;
}

export interface DMStore {
  contacts: DMContact[];
  selectedContact: DMContact | null;
  messages: ChatMessage[];
  selectContact: (id: string) => void;
  sendMessage: (content: string) => void;
  startDM: (matrixUserId: string, displayName: string, avatarUrl?: string) => void;
  clearSelection: () => void;
  closeDM: (id: string) => void;
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
    isSelectedConversationForeground,
    users,
    username,
  } = options;

  // ---- Core state ----------------------------------------------------------

  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [pendingMessages, setPendingMessages] = useState<Map<string, ChatMessage[]>>(new Map());
  const [pendingMatrixContacts, setPendingMatrixContacts] = useState<Map<string, DMContact>>(new Map());
  const [mumbleContacts, setMumbleContacts] = useState<Map<string, DMContact>>(new Map());
  const [mumbleMessages, setMumbleMessages] = useState<Map<string, ChatMessage[]>>(new Map());

  // ---- Refs for bridge callbacks -------------------------------------------

  const selectedContactIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedContactIdRef.current = selectedContactId;
  }, [selectedContactId]);

  // ---- Reset on disconnect -------------------------------------------------

  useEffect(() => {
    if (users.length === 0) {
      setSelectedContactId(null);
      setPendingMessages(new Map());
      setPendingMatrixContacts(new Map());
      setMumbleContacts(new Map());
      setMumbleMessages(new Map());
      selectedContactIdRef.current = null;
    }
  }, [users.length]);

  const selfMatrixUserIds = useMemo(() => {
    return new Set(users.filter(user => user.self && user.matrixUserId).map(user => user.matrixUserId!));
  }, [users]);

  const selfCertHashes = useMemo(() => {
    return new Set(users.filter(user => user.self && user.certHash).map(user => user.certHash!));
  }, [users]);

  // ---- Matrix contacts derived from matrixDmRoomMap ------------------------

  const contacts: DMContact[] = useMemo(() => {
    const result: DMContact[] = [];
    const seen = new Set<string>();

    if (matrixDmRoomMap) {
      for (const [matrixUserId] of matrixDmRoomMap) {
        if (selfMatrixUserIds.has(matrixUserId)) continue;

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
          unreadCount: 0,
          onlineSessionId: user?.session,
        });
      }
    }

    // Merge all known Brmble users, including offline users and users without
    // an existing DM room. Selecting one keeps using the Matrix DM path.
    for (const directoryUser of brmbleUsers) {
      if (seen.has(directoryUser.matrixUserId) || selfMatrixUserIds.has(directoryUser.matrixUserId)) continue;
      const user = users.find(u => u.matrixUserId === directoryUser.matrixUserId);
      seen.add(directoryUser.matrixUserId);
      result.push({
        id: directoryUser.matrixUserId,
        displayName: user?.name ?? directoryUser.displayName,
        avatarUrl: user?.avatarUrl ?? directoryUser.avatarUrl ?? matrixDmUserAvatarUrls?.get(directoryUser.matrixUserId),
        unreadCount: 0,
        onlineSessionId: user?.session,
      });
    }

    // Merge online Brmble users that are visible in Mumble but were not present
    // in the directory snapshot for any reason.
    for (const user of users) {
      if (user.self || !user.isBrmbleClient || !user.matrixUserId || seen.has(user.matrixUserId)) continue;
      seen.add(user.matrixUserId);
      result.push({
        id: user.matrixUserId,
        displayName: user.name,
        avatarUrl: user.avatarUrl,
        unreadCount: 0,
        onlineSessionId: user.session,
      });
    }

    // Merge pending Matrix contacts (first-time DMs before room is created)
    for (const [id, pc] of pendingMatrixContacts) {
      if (!seen.has(id) && !selfMatrixUserIds.has(id)) {
        seen.add(id);
        const user = users.find(u => u.matrixUserId === id);
        result.push({ ...pc, onlineSessionId: user?.session });
      }
    }

    // Merge online standard-Mumble users that have a stable certificate hash,
    // plus retained ephemeral conversations. Cert-less users are intentionally
    // excluded from this pass; see the plan scope note.
    const ephemeral = new Map<string, DMContact>();
    const liveUsersByCertHash = new Map<string, User>();

    for (const user of users) {
      if (user.self || !user.certHash || selfCertHashes.has(user.certHash)) continue;
      liveUsersByCertHash.set(user.certHash, user);
      if (user.isBrmbleClient === true) continue;

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
      const certHash = mc.mumbleCertHash;
      if (!certHash || selfCertHashes.has(certHash)) continue;

      const onlineUser = liveUsersByCertHash.get(certHash);
      const onlineContact = ephemeral.get(certHash);
      const msgs = mumbleMessages.get(certHash);
      const lastMsg = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
      const hasRetainedConversation = Boolean(lastMsg);
      const isSelectedRoute = selectedContactId === certHash;

      if (onlineUser?.isBrmbleClient === true) {
        if (!hasRetainedConversation) continue;
        ephemeral.set(certHash, {
          ...mc,
          displayName: onlineUser.name,
          avatarUrl: onlineUser.avatarUrl ?? mc.avatarUrl,
          mumbleSessionId: null,
          lastMessage: lastMsg?.content,
          lastMessageTime: lastMsg?.timestamp.getTime(),
        });
        continue;
      }

      if (!onlineContact && !hasRetainedConversation && !isSelectedRoute) continue;

      ephemeral.set(certHash, {
        ...mc,
        displayName: onlineContact?.displayName ?? mc.displayName,
        avatarUrl: onlineContact?.avatarUrl ?? mc.avatarUrl,
        mumbleSessionId: onlineContact?.mumbleSessionId ?? (mc.persistedFromDirectory ? null : mc.mumbleSessionId),
        lastMessage: lastMsg?.content,
        lastMessageTime: lastMsg?.timestamp.getTime(),
      });
    }

    const matrixContacts = result.sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0));
    const mumbleOnlyContacts = [...ephemeral.values()]
      .sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0) || a.displayName.localeCompare(b.displayName));
    result.splice(0, result.length, ...matrixContacts, ...mumbleOnlyContacts);
    return result;
  }, [matrixDmRoomMap, matrixDmLastMessages, matrixDmUserDisplayNames, matrixDmUserAvatarUrls, brmbleUsers, users, pendingMatrixContacts, mumbleContacts, mumbleMessages, selfMatrixUserIds, selfCertHashes, selectedContactId]);

  // ---- Selected contact ----------------------------------------------------

  const selectedContact: DMContact | null = useMemo(() => {
    if (!selectedContactId) return null;
    return contacts.find(c => c.id === selectedContactId) ?? null;
  }, [contacts, selectedContactId]);

  // ---- Messages for selected contact ---------------------------------------

  const messages: ChatMessage[] = useMemo(() => {
    if (!selectedContactId) return [];

    const contact = selectedContact ?? contacts.find(c => c.id === selectedContactId);
    if (contact?.isEphemeral) {
      return mumbleMessages.get(selectedContactId) ?? [];
    }

    const matrixMsgs = activeDmMessages ?? [];
    const pending = pendingMessages.get(selectedContactId) ?? [];
    return [...matrixMsgs, ...pending];
  }, [selectedContactId, selectedContact, contacts, activeDmMessages, pendingMessages, mumbleMessages]);

  // ---- Actions -------------------------------------------------------------

  const selectContact = useCallback((id: string) => {
    setSelectedContactId(id);
    const ephemeralContact = contacts.find(c => c.id === id && c.isEphemeral);
    const isMumbleContact = mumbleContacts.has(id) || ephemeralContact !== undefined;

    setMumbleContacts(prev => {
      const contact = prev.get(id);
      if (contact && contact.unreadCount > 0) {
        const next = new Map(prev);
        next.set(id, { ...contact, unreadCount: 0 });
        return next;
      }
      if (!contact && ephemeralContact) {
        const next = new Map(prev);
        next.set(id, { ...ephemeralContact, unreadCount: 0, persistedFromDirectory: true });
        return next;
      }
      return prev;
    });

    if (!isMumbleContact && fetchDMHistory) {
      fetchDMHistory(id).catch(console.warn);
    }
  }, [fetchDMHistory, mumbleContacts, contacts]);

  const startDM = useCallback((matrixUserId: string, displayName: string, avatarUrl?: string) => {
    if (selfMatrixUserIds.has(matrixUserId)) {
      setSelectedContactId(null);
      return;
    }

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

    if (fetchDMHistory) {
      fetchDMHistory(matrixUserId).catch(console.warn);
    }
  }, [fetchDMHistory, matrixDmRoomMap, selfMatrixUserIds]);

  const clearSelection = useCallback(() => {
    setSelectedContactId(null);
  }, []);

  const sendMessage = useCallback((content: string) => {
    if (!selectedContactId) return;

    const derivedContact = contacts.find(c => c.id === selectedContactId && c.isEphemeral);
    const storedContact = mumbleContacts.get(selectedContactId);
    const contact = derivedContact ?? storedContact;
    if (contact?.isEphemeral) {
      // Mumble DM path
      if (contact.mumbleSessionId == null) return; // offline, can't send
      setMumbleContacts(prev => {
        const existing = prev.get(contact.id);
        const nextContact: DMContact = {
          ...contact,
          unreadCount: existing?.unreadCount ?? contact.unreadCount,
          mumbleSessionId: contact.mumbleSessionId,
        };

        if (
          existing &&
          existing.displayName === nextContact.displayName &&
          existing.avatarUrl === nextContact.avatarUrl &&
          existing.mumbleSessionId === nextContact.mumbleSessionId &&
          existing.unreadCount === nextContact.unreadCount
        ) {
          return prev;
        }

        const next = new Map(prev);
        next.set(contact.id, nextContact);
        return next;
      });
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
  }, [selectedContactId, username, sendMatrixDM, mumbleContacts, contacts, sendMumbleDM]);

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
    // App owns foreground presentation; the store only owns DM data.
    const selectedConversationIsForeground = isSelectedConversationForeground();
    if (selectedContactIdRef.current !== certHash || !selectedConversationIsForeground) {
      setMumbleContacts(prev => {
        const next = new Map(prev);
        const contact = next.get(certHash);
        if (contact) {
          next.set(certHash, { ...contact, unreadCount: contact.unreadCount + 1 });
        }
        return next;
      });
    }
  }, [isSelectedConversationForeground]);

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
    if (selfCertHashes.has(certHash)) {
      setSelectedContactId(null);
      return;
    }

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
  }, [selfCertHashes]);

  // ---- Return --------------------------------------------------------------

  return {
    contacts,
    selectedContact,
    messages,
    selectContact,
    sendMessage,
    startDM,
    clearSelection,
    closeDM,
    selectedContactIdRef,
    receiveMumbleDM,
    updateMumbleSession,
    clearMumbleContacts,
    startMumbleDM,
  };
}
