import { useState, useCallback, useRef, useMemo } from 'react';
import type { ChatMessage, User } from '../types';
import {
  loadDMContacts,
  upsertDMContact,
  markDMContactRead,
  addMessageToStore,
  type StoredDMContact,
} from './useChatStore';
import { useChatStore } from './useChatStore';

interface DMContact {
  userId: string;
  userName: string;
  lastMessage?: string;
  lastMessageTime?: Date;
  unread: number;
}

interface Bridge {
  send: (event: string, data?: unknown) => void;
}

interface UseDMStoreProps {
  bridge: Bridge;
  users: User[];
  username: string;
  sendMatrixDM: ((targetMatrixUserId: string, text: string) => Promise<void>) | null;
  fetchDMHistory: ((targetMatrixUserId: string) => Promise<void>) | null;
}

function mapStoredContacts(contacts: StoredDMContact[]): DMContact[] {
  return contacts.map(c => ({
    userId: c.userId,
    userName: c.userName,
    lastMessage: c.lastMessage,
    lastMessageTime: c.lastMessageTime ? new Date(c.lastMessageTime) : undefined,
    unread: c.unread,
  }));
}

export function useDMStore({ bridge, users, username, sendMatrixDM, fetchDMHistory }: UseDMStoreProps) {
  const [dmContacts, setDmContacts] = useState<DMContact[]>(() => mapStoredContacts(loadDMContacts()));
  const [appMode, setAppMode] = useState<'channels' | 'dm'>('channels');
  const [selectedDMUserId, setSelectedDMUserId] = useState<string | null>(null);
  const [selectedDMUserName, setSelectedDMUserName] = useState<string>('');

  // Refs for bridge handler access (avoids stale closures)
  const appModeRef = useRef(appMode);
  appModeRef.current = appMode;
  const selectedDMUserIdRef = useRef(selectedDMUserId);
  selectedDMUserIdRef.current = selectedDMUserId;
  const usersRef = useRef(users);
  usersRef.current = users;

  // Track last-processed Matrix message ID per conversation to avoid re-incrementing unread
  const lastProcessedMsgIdRef = useRef<Map<string, string>>(new Map());

  // localStorage-backed messages for the active DM
  const dmKey = selectedDMUserId ? `dm-${selectedDMUserId}` : 'no-dm';
  const { messages: activeDMMessages, addMessage: addLocalDMMessage } = useChatStore(dmKey);

  // For bridge handler refs
  const addLocalDMMessageRef = useRef(addLocalDMMessage);
  addLocalDMMessageRef.current = addLocalDMMessage;

  // Ref for setAppMode so bridge handlers can toggle without re-registration
  const setAppModeRef = useRef(setAppMode);
  setAppModeRef.current = setAppMode;

  const toggleDMMode = useCallback(() => {
    setAppMode(prev => prev === 'channels' ? 'dm' : 'channels');
  }, []);

  const selectDM = useCallback((userId: string, userName: string) => {
    setSelectedDMUserId(userId);
    setSelectedDMUserName(userName);
    setAppMode('dm');

    markDMContactRead(userId);
    const updated = upsertDMContact(userId, userName);
    setDmContacts(mapStoredContacts(updated));

    // Fetch Matrix DM history if available
    const targetUser = usersRef.current.find(u => String(u.session) === userId);
    if (targetUser?.matrixUserId && fetchDMHistory) {
      fetchDMHistory(targetUser.matrixUserId).catch(console.error);
    }
  }, [fetchDMHistory]);

  const sendDM = useCallback((content: string) => {
    if (!username || !content || !selectedDMUserIdRef.current) return;

    const targetUser = usersRef.current.find(u => String(u.session) === selectedDMUserIdRef.current);
    const targetMatrixId = targetUser?.matrixUserId;

    // Add local echo immediately
    addLocalDMMessageRef.current(username, content);

    if (targetMatrixId && sendMatrixDM) {
      // Brmble user — Matrix only, no Mumble fallback
      sendMatrixDM(targetMatrixId, content).catch(console.error);
    } else {
      // Pure Mumble user
      bridge.send('voice.sendPrivateMessage', {
        message: content,
        targetSession: Number(selectedDMUserIdRef.current),
      });
    }

    const updated = upsertDMContact(
      selectedDMUserIdRef.current,
      targetUser?.name || selectedDMUserName,
      content,
    );
    setDmContacts(mapStoredContacts(updated));
  }, [username, bridge, sendMatrixDM, selectedDMUserName]);

  const receiveDM = useCallback((senderSession: number, senderName: string, content: string) => {
    const senderKey = String(senderSession);
    const dmStoreKey = `dm-${senderKey}`;

    const isViewing = appModeRef.current === 'dm' && selectedDMUserIdRef.current === senderKey;

    if (selectedDMUserIdRef.current === senderKey) {
      // Selected DM matches sender — update React state (keeps UI in sync even
      // when toggled to channels mode, since dmKey/useChatStore stays bound).
      addLocalDMMessageRef.current(senderName, content);
    } else {
      // Different user — write directly to localStorage for later loading.
      addMessageToStore(dmStoreKey, senderName, content);
    }

    const updated = upsertDMContact(senderKey, senderName, content, !isViewing);
    setDmContacts(mapStoredContacts(updated));
  }, []);

  const receiveMatrixDMUpdate = useCallback((matrixUserId: string, messages: ChatMessage[]) => {
    if (!messages || messages.length === 0) return;

    const lastMsg = messages[messages.length - 1];
    const lastProcessedId = lastProcessedMsgIdRef.current.get(matrixUserId);

    // Skip if we've already processed up to this message
    if (lastProcessedId === lastMsg.id) return;
    lastProcessedMsgIdRef.current.set(matrixUserId, lastMsg.id);

    const matchedUser = usersRef.current.find(u => u.matrixUserId === matrixUserId);
    if (!matchedUser) return;

    const sessionKey = String(matchedUser.session);
    const isViewing = appModeRef.current === 'dm' && selectedDMUserIdRef.current === sessionKey;

    const updated = upsertDMContact(sessionKey, matchedUser.name, lastMsg.content, !isViewing);
    setDmContacts(mapStoredContacts(updated));
  }, []);

  const unreadDMUserCount = useMemo(
    () => dmContacts.filter(c => c.unread > 0).length,
    [dmContacts],
  );

  return {
    // State
    appMode,
    selectedDMUserId,
    selectedDMUserName,
    dmContacts,
    activeDMMessages,
    unreadDMUserCount,

    // Ref for bridge handlers that need setAppMode
    setAppModeRef,

    // Actions
    toggleDMMode,
    selectDM,
    sendDM,
    receiveDM,
    receiveMatrixDMUpdate,
  };
}

export type { DMContact };
