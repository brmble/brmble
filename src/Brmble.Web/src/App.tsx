import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import bridge from './bridge';
import type { ConnectionStatus, ChatMessage } from './types';
import { encodeForMumble } from './utils/imageUpload';
import { useMatrixClient } from './hooks/useMatrixClient';
import type { MatrixCredentials } from './hooks/useMatrixClient';
import { useScreenShare } from './hooks/useScreenShare';
import { useLeaveVoiceCooldown } from './hooks/useLeaveVoiceCooldown';
import { useUnreadTracker, resetMarkersCache } from './hooks/useUnreadTracker';
import { useServiceStatus } from './hooks/useServiceStatus';
import { useServerHealth } from './hooks/useServerHealth';

import { ErrorBoundary } from './components/ErrorBoundary';
import { Header } from './components/Header/Header';
import { BrmbleLogo } from './components/Header/BrmbleLogo';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { ConnectModal } from './components/ConnectModal/ConnectModal';
import { ServerList } from './components/ServerList/ServerList';
import { ConnectionState } from './components/ConnectionState/ConnectionState';
import type { ServerEntry } from './hooks/useServerlist';
import { SettingsModal } from './components/SettingsModal/SettingsModal';
import { AvatarEditorModal } from './components/AvatarEditorModal/AvatarEditorModal';
import { CloseDialog } from './components/CloseDialog/CloseDialog';
import { CertWizard } from './components/CertWizard/CertWizard';
import { Version } from './components/Version/Version';
import { ZoomIndicator } from './components/ZoomIndicator/ZoomIndicator';
import { useChatStore, addMessageToStore, clearChatStorage, purgeEphemeralMessages } from './hooks/useChatStore';
import { parseMessageMedia } from './utils/parseMessageMedia';
import { useDMStore } from './hooks/useDMStore';
import { DMContactList } from './components/DMContactList/DMContactList';
import { usePrompt, confirm } from './hooks/usePrompt';
import { Toast } from './components/Toast/Toast';
import { GameUI } from './components/Game/GameUI';
import { Brmblegotchi } from './components/Brmblegotchi/Brmblegotchi';
import { ProfileProvider } from './contexts/ProfileContext';
import { UpdateNotification } from './components/UpdateNotification/UpdateNotification';
import { migrateLocalStorage } from './utils/migrateLocalStorage';
import './App.css';

const SETTINGS_STORAGE_KEY = 'brmble-settings';

const DEFAULT_TTS_VOICE = 'Zira';

function getDefaultVoice(voices: SpeechSynthesisVoice[]) {
  return voices.find(v => v.name.includes(DEFAULT_TTS_VOICE)) || voices[0] || null;
}

function speakText(text: string) {
  const doSpeak = (voices: SpeechSynthesisVoice[]) => {
    try {
      if (!window.speechSynthesis) {
        return;
      }
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (stored) {
        const settings = JSON.parse(stored);
        if (settings.messages?.ttsEnabled) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.volume = (settings.messages.ttsVolume ?? 100) / 100;
          utterance.rate = 1.0;
          let voiceSelected = false;
          if (voices.length > 0) {
            const selectedVoiceName = settings.messages.ttsVoice;
            if (selectedVoiceName) {
              const selectedVoice = voices.find(v => v.name === selectedVoiceName);
              if (selectedVoice) {
                utterance.voice = selectedVoice;
                voiceSelected = true;
              }
            }
            if (!voiceSelected) {
              const defaultVoice = getDefaultVoice(voices);
              if (defaultVoice) {
                utterance.voice = defaultVoice;
              }
            }
          }
          window.speechSynthesis.speak(utterance);
        }
      }
    } catch (e) {
      console.warn('TTS error:', e);
    }
  };

  const voices = window.speechSynthesis?.getVoices() ?? [];
  if (voices.length > 0) {
    doSpeak(voices);
  } else {
    const onVoicesChanged = () => {
      window.speechSynthesis?.removeEventListener('voiceschanged', onVoicesChanged);
      doSpeak(window.speechSynthesis?.getVoices() ?? []);
    };
    window.speechSynthesis?.addEventListener('voiceschanged', onVoicesChanged);
  }
}

interface SavedServer {
  id?: string;
  label?: string;
  apiUrl?: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  registered?: boolean;
  registeredName?: string;
  defaultProfileId?: string;
}

interface Channel {
  id: number;
  name: string;
  parent?: number;
}

interface User {
  session: number;
  name: string;
  channelId?: number;
  muted?: boolean;
  deafened?: boolean;
  self?: boolean;
  comment?: string;
  matrixUserId?: string;
  avatarUrl?: string;
  certHash?: string;
  isBrmbleClient?: boolean;
}


function App() {
  // --- Brmblegotchi settings state ---
  const [brmblegotchiEnabled, setBrmblegotchiEnabledState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('brmble-settings');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.brmblegotchi?.enabled ?? false;
      }
    } catch { /* ignore */ }
    return false;
  });
  const setBrmblegotchiEnabled = useCallback((enabled: boolean) => {
    setBrmblegotchiEnabledState(enabled);
    try {
      const stored = localStorage.getItem('brmble-settings');
      const parsed = stored ? JSON.parse(stored) : {};
      parsed.brmblegotchi = parsed.brmblegotchi || {};
      parsed.brmblegotchi.enabled = enabled;
      localStorage.setItem('brmble-settings', JSON.stringify(parsed));
    } catch { /* ignore */ }
  }, []);
  // --- end Brmblegotchi settings state ---

  // null = status not yet received, false = no cert, true = cert exists
  const [certExists, setCertExists] = useState<boolean | null>(null);
  const [certFingerprint, setCertFingerprint] = useState('');
  const [activeProfileName, setActiveProfileName] = useState('');
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string }>>([]);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const { statuses, updateStatus, resetStatuses } = useServiceStatus();
  const connected = connectionStatus === 'connected';
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [serverAddress, setServerAddress] = useState('');
  const [serverLabel, setServerLabel] = useState('');
  
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentChannelId, setCurrentChannelIdRaw] = useState<string | undefined>();
  const [currentChannelName, setCurrentChannelName] = useState<string>('');
  // Snapshot of the read-marker timestamp at the moment a channel/DM is opened,
  // captured *before* markRoomRead moves it forward.
  // This lets the unread divider persist while the user views the channel.
  // The divider is placed above the first message whose timestamp exceeds this value.
  const [channelDividerTs, setChannelDividerTs] = useState<number | null>(null);
  const [dmDividerTs, setDmDividerTs] = useState<number | null>(null);

  // Wrapper: always clear the divider snapshot when the channel changes.
  // This prevents the stale divider from a previous channel being rendered
  // (and scrolled to) during the first render after a channel switch.
  // React batches both setState calls into a single render.
  const setCurrentChannelId = useCallback((id: string | undefined) => {
    setCurrentChannelIdRaw(id);
    setChannelDividerTs(null);
  }, []);
  const [selfMuted, setSelfMuted] = useState(false);
  const [selfDeafened, setSelfDeafened] = useState(false);
  const [selfLeftVoice, setSelfLeftVoice] = useState(false);
  const [selfCanRejoin, setSelfCanRejoin] = useState(false);
  const [selfSession, setSelfSession] = useState<number>(0);
  const [speakingUsers, setSpeakingUsers] = useState<Map<number, boolean>>(new Map());
  const [pendingChannelAction, setPendingChannelAction] = useState<number | 'leave' | null>(null);
  const [hotkeyPressedBtn, setHotkeyPressedBtn] = useState<string | null>(null);
  const pendingChannelActionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'profile' | 'audio' | 'shortcuts' | 'messages' | 'appearance' | 'connection'>('profile');
  const [showGame, setShowGame] = useState(false);
  const [showAvatarEditor, setShowAvatarEditor] = useState(false);

  // Close avatar editor modal when disconnected — profile is not editable while disconnected
  useEffect(() => {
    if (!connected) setShowAvatarEditor(false);
  }, [connected]);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasPendingInvite] = useState(false);

  const [matrixCredentials, setMatrixCredentials] = useState<MatrixCredentials | null>(null);
  const matrixClient = useMatrixClient(matrixCredentials);
  useServerHealth();

  // Avatar state and management
  const [currentUserAvatarUrl, setCurrentUserAvatarUrl] = useState<string | undefined>();

  // Fetch avatar when matrix client becomes available
  useEffect(() => {
    if (!matrixCredentials?.userId || !matrixClient.client) return;
    matrixClient.fetchAvatarUrl(matrixCredentials.userId).then((url) => {
      if (url) setCurrentUserAvatarUrl(url);
    });
  }, [matrixCredentials?.userId, matrixClient.client, matrixClient.fetchAvatarUrl]);

  // Keep the self user's avatarUrl in the users array in sync with currentUserAvatarUrl
  useEffect(() => {
    if (currentUserAvatarUrl === undefined) return;
    setUsers(prev => {
      const self = prev.find(u => u.self);
      if (!self || self.avatarUrl === currentUserAvatarUrl) return prev;
      return prev.map(u => u.self ? { ...u, avatarUrl: currentUserAvatarUrl } : u);
    });
  }, [currentUserAvatarUrl]);

  // Track which matrixUserIds we've already fetched avatars for to avoid re-fetching.
  // Maps matrixUserId -> number of fetch attempts so far (for retry logic).
  const fetchedAvatarIdsRef = useRef<Map<string, number>>(new Map());
  // Track pending retry timers so they can be cancelled on cleanup
  const avatarRetryTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // Ref for fetchAvatarForUser so the safety-net useEffect can call it without
  // adding it as a dependency (it's defined later, after the refs section).
  const fetchAvatarForUserRef = useRef<(session: number, matrixUserId: string) => void>(() => {});

  // Safety-net: scan users on every change and trigger avatar fetches for any user
  // that has a matrixUserId but no avatarUrl. The primary fetch path is via bridge
  // event handlers (onVoiceConnected, onVoiceUserJoined, onUserMappingUpdated,
  // onSessionMappingSnapshot), but this catches edge cases they might miss.
  useEffect(() => {
    if (!matrixClient.client) return;

    // Prune stale entries: if a user disconnected and reconnected, their matrixUserId
    // may still be in fetchedAvatarIdsRef from the previous session.
    const currentMatrixIds = new Set(users.filter(u => u.matrixUserId).map(u => u.matrixUserId!));
    for (const id of fetchedAvatarIdsRef.current.keys()) {
      if (!currentMatrixIds.has(id)) {
        fetchedAvatarIdsRef.current.delete(id);
      }
    }

    for (const u of users) {
      if (u.matrixUserId && !u.avatarUrl) {
        fetchAvatarForUserRef.current(u.session, u.matrixUserId);
      }
    }
  }, [users, matrixClient.client]);

  // Clean up avatar retry timers only when the Matrix client or fetch function changes,
  // or when the component unmounts, so that user list updates do not cancel pending retries.
  useEffect(() => {
    return () => {
      for (const timer of avatarRetryTimersRef.current) clearTimeout(timer);
      avatarRetryTimersRef.current.clear();
    };
  }, [matrixClient.client, matrixClient.fetchAvatarUrl]);

  const onUploadAvatar = useCallback(async (blob: Blob, contentType: string) => {
    if (!matrixClient.client) return;
    try {
      const upload = await matrixClient.client.uploadContent(blob, { name: 'avatar.png', type: contentType });
      const mxcUrl = upload.content_uri;
      await matrixClient.client.setAvatarUrl(mxcUrl);
      const httpUrl = matrixClient.client.mxcUrlToHttp(mxcUrl, 128, 128, 'crop');
      setCurrentUserAvatarUrl(httpUrl ?? undefined);
      // Also update the self user in the users list so channel tree / chat show the new avatar
      if (httpUrl) {
        setUsers(prev => prev.map(u => u.self ? { ...u, avatarUrl: httpUrl } : u));
      }
      // Notify backend so Mumble texture sync won't overwrite this avatar
      bridge.send('avatar.setSource', { source: 'brmble' });
    } catch (e) {
      console.error('Failed to upload avatar:', e);
    }
  }, [matrixClient.client]);

  const onRemoveAvatar = useCallback(async () => {
    if (!matrixClient.client) return;
    try {
      await matrixClient.client.setAvatarUrl('');
      setCurrentUserAvatarUrl(undefined);
      // Also clear the self user's avatar in the users list
      setUsers(prev => prev.map(u => u.self ? { ...u, avatarUrl: undefined } : u));
      // Clear avatar source so Mumble textures can take over again
      bridge.send('avatar.setSource', { source: null });
    } catch (e) {
      console.error('Failed to remove avatar:', e);
    }
  }, [matrixClient.client]);

  // Build set of DM room IDs from matrixClient.dmRoomMap
  const dmRoomIds = useMemo(() => {
    const set = new Set<string>();
    if (matrixClient?.dmRoomMap) {
      for (const roomId of matrixClient.dmRoomMap.values()) {
        set.add(roomId);
      }
    }
    return set;
  }, [matrixClient?.dmRoomMap]);

  // Per-panel Matrix room IDs for scoping mention suggestions
  const channelMatrixRoomId = useMemo(() => {
    if (currentChannelId && currentChannelId !== 'server-root' && matrixCredentials?.roomMap?.[currentChannelId]) {
      return matrixCredentials.roomMap[currentChannelId];
    }
    return null;
  }, [currentChannelId, matrixCredentials?.roomMap]);

  const channelKey = currentChannelId === 'server-root' ? 'server-root' : currentChannelId ? `channel-${currentChannelId}` : 'no-channel';
  const { messages, addMessage } = useChatStore(channelKey);
  const [optimisticImages, setOptimisticImages] = useState<ChatMessage[]>([]);

  const dmStore = useDMStore({
    matrixDmMessages: matrixClient.dmMessages,
    matrixDmRoomMap: matrixClient.dmRoomMap,
    matrixDmUserDisplayNames: matrixClient.dmUserDisplayNames,
    matrixDmUserAvatarUrls: matrixClient.dmUserAvatarUrls,
    sendMatrixDM: matrixClient.sendDMMessage,
    fetchDMHistory: matrixClient.fetchDMHistory,
    users,
    username,
    sendMumbleDM: (targetSession: number, text: string) => {
      bridge.send('voice.sendPrivateMessage', { message: text, targetSession });
    },
  });

  // Determine active Matrix room ID (depends on dmStore.selectedContact)
  const activeMatrixRoomId = useMemo(() => {
    if (dmStore.selectedContact && matrixClient?.dmRoomMap) {
      const roomId = matrixClient.dmRoomMap.get(dmStore.selectedContact.id);
      if (roomId) return roomId;
    }
    if (currentChannelId && currentChannelId !== 'server-root' && matrixCredentials?.roomMap?.[currentChannelId]) {
      return matrixCredentials.roomMap[currentChannelId];
    }
    return null;
  }, [dmStore.selectedContact, currentChannelId, matrixClient?.dmRoomMap, matrixCredentials?.roomMap]);

  const dmMatrixRoomId = useMemo(() => {
    if (dmStore.selectedContact && matrixClient?.dmRoomMap) {
      return matrixClient.dmRoomMap.get(dmStore.selectedContact.id) ?? null;
    }
    return null;
  }, [dmStore.selectedContact, matrixClient?.dmRoomMap]);

  const unreadTracker = useUnreadTracker(
    matrixClient?.client ?? null,
    dmRoomIds,
    activeMatrixRoomId,
    username || null,
    certFingerprint,
  );

  // DM unread count from Matrix + Mumble ephemeral contacts
  const totalDmUnreadCount = useMemo(() => {
    let total = unreadTracker.totalDmUnreadCount;
    // Add Mumble DM unreads
    for (const contact of dmStore.contacts) {
      if (contact.isEphemeral) {
        total += contact.unreadCount > 0 ? 1 : 0;
      }
    }
    return total;
  }, [unreadTracker.totalDmUnreadCount, dmStore.contacts]);

  // Enrich DM contacts with per-contact unread counts from the unread tracker
  const dmContactsWithUnreads = useMemo(() => {
    if (!matrixClient?.dmRoomMap) return dmStore.contacts;
    return dmStore.contacts.map(contact => {
      if (contact.isEphemeral) return contact; // Mumble contacts track their own unreads
      const roomId = matrixClient.dmRoomMap?.get(contact.id);
      if (!roomId) return contact;
      const unread = unreadTracker.getRoomUnread(roomId);
      if (unread.notificationCount === contact.unreadCount) return contact;
      return { ...contact, unreadCount: unread.notificationCount };
    });
  }, [dmStore.contacts, matrixClient?.dmRoomMap, unreadTracker]);

  const updateBadge = useCallback((unread: number, invite: boolean) => {
    const effectiveUnreadDMs = unread > 0;
    bridge.send('notification.badge', { unreadDMs: effectiveUnreadDMs, pendingInvite: invite });
  }, [bridge]);

  // Refs to avoid re-registering bridge handlers on every state change
  const usersRef = useRef(users);
  usersRef.current = users;
  const previousChannelIdRef = useRef<Map<number, number | undefined>>(new Map());
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const addMessageRef = useRef(addMessage);
  addMessageRef.current = addMessage;
  const currentChannelIdRef = useRef(currentChannelId);
  currentChannelIdRef.current = currentChannelId;
  const unreadCountRef = useRef(unreadCount);
  unreadCountRef.current = unreadCount;
  const hasPendingInviteRef = useRef(hasPendingInvite);
  hasPendingInviteRef.current = hasPendingInvite;
  const matrixCredentialsRef = useRef(matrixCredentials);
  matrixCredentialsRef.current = matrixCredentials;
  const serverAddressRef = useRef(serverAddress);
  serverAddressRef.current = serverAddress;
  const dmStoreRef = useRef(dmStore);
  dmStoreRef.current = dmStore;
  const connectionStatusRef = useRef(connectionStatus);
  connectionStatusRef.current = connectionStatus;
  const fetchAvatarUrlRef = useRef(matrixClient.fetchAvatarUrl);
  fetchAvatarUrlRef.current = matrixClient.fetchAvatarUrl;
  const matrixClientRef = useRef(matrixClient.client);
  matrixClientRef.current = matrixClient.client;
  const handleToggleScreenShareRef = useRef<(() => void) | null>(null);
  const disconnectViewerRef = useRef<(() => void) | null>(null);

  // Fetch avatar for a specific user by matrixUserId and session, updating user state.
  // Uses refs so it can be called from both bridge event handlers (which capture initial
  // closures) and the useEffect safety-net below.  Handles deduping, bounded retries with
  // backoff, and clearing the dedupe entry after max attempts so later events can retry.
  const fetchAvatarForUser = useCallback((session: number, matrixUserId: string) => {
    if (!matrixClientRef.current) return;
    // Skip if already fetched or in-flight
    if (fetchedAvatarIdsRef.current.has(matrixUserId)) return;
    // Check if user already has an avatar
    const user = usersRef.current.find(u => u.session === session);
    if (user?.avatarUrl) return;

    const maxAttempts = 3;

    const attemptFetch = (attempt: number) => {
      fetchedAvatarIdsRef.current.set(matrixUserId, attempt + 1);
      fetchAvatarUrlRef.current(matrixUserId).then((url) => {
        if (url) {
          setUsers(prev => prev.map(u =>
            u.session === session ? { ...u, avatarUrl: url } : u
          ));
          return;
        }
        // Avatar not available yet — schedule retry (e.g. Mumble texture still uploading)
        if (attempt + 1 >= maxAttempts) {
          // Clear dedupe entry so a future bridge event (e.g. mapping update) can retry
          fetchedAvatarIdsRef.current.delete(matrixUserId);
          return;
        }
        const timer = setTimeout(() => {
          avatarRetryTimersRef.current.delete(timer);
          fetchedAvatarIdsRef.current.delete(matrixUserId);
          // Re-check: user may have disconnected or gotten an avatar since
          const current = usersRef.current.find(u => u.session === session);
          if (!current || current.avatarUrl || !current.matrixUserId) return;
          attemptFetch(attempt + 1);
        }, 2000 * (attempt + 1)); // 2s, 4s backoff
        avatarRetryTimersRef.current.add(timer);
      });
    };

    attemptFetch(0);
  }, []);
  fetchAvatarForUserRef.current = fetchAvatarForUser;

  // Tracks whether the user ever saw the 'connected' UI (ChatPanel rendered).
  // Set to true via useEffect (fires after render commit), so transient
  // connecting→connected→disconnected batches won't set it.
  // Reset to false when starting a new connection attempt.
  const userSawConnectedRef = useRef(false);
  useEffect(() => {
    if (connectionStatus === 'connected') {
      userSawConnectedRef.current = true;
    }
  }, [connectionStatus]);

  const clearPendingAction = useCallback(() => {
    if (pendingChannelActionTimeoutRef.current) {
      clearTimeout(pendingChannelActionTimeoutRef.current);
      pendingChannelActionTimeoutRef.current = null;
    }
    setPendingChannelAction(null);
  }, []);

  const startPendingAction = useCallback((action: number | 'leave') => {
    if (pendingChannelAction === action) {
      return;
    }
    if (pendingChannelActionTimeoutRef.current) {
      clearTimeout(pendingChannelActionTimeoutRef.current);
    }
    setPendingChannelAction(action);
    pendingChannelActionTimeoutRef.current = setTimeout(() => {
      setPendingChannelAction(null);
    }, 5000);
  }, [pendingChannelAction]);

  // Handle Push-to-Talk key detection via JavaScript when app is focused
  // Keys naturally pass through to other apps when window loses focus
  useEffect(() => {
    let pttKey: string | null = null;
    let pttPressed = false;

    const updatePttKeyFromSettings = (settings: any) => {
      const newMode = settings?.audio?.transmissionMode;
      const newKey: string | null =
        newMode === 'pushToTalk' ? (settings?.audio?.pushToTalkKey ?? null) : null;

      if (
        pttPressed &&
        (
          newMode !== 'pushToTalk' ||
          !newKey ||
          newKey !== pttKey
        )
      ) {
        pttPressed = false;
        bridge.send('voice.pttKey', { pressed: false });
      }

      pttKey = newKey;
    };

    // Listen for settings updates via bridge
    const handleSettingsCurrent = (data: unknown) => {
      const d = data as { settings?: any } | undefined;
      if (d?.settings) {
        updatePttKeyFromSettings(d.settings);
      }
    };

    bridge.on('settings.current', handleSettingsCurrent);
    bridge.on('settings.updated', handleSettingsCurrent);

    // Also listen to storage changes as fallback (for other tabs)
    const handleStorage = () => {
      try {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (stored) {
          const settings = JSON.parse(stored);
          updatePttKeyFromSettings(settings);
        }
      } catch {}
    };
    window.addEventListener('storage', handleStorage);

    // Initial check
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      try {
        const settings = JSON.parse(stored);
        updatePttKeyFromSettings(settings);
      } catch {}
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.defaultPrevented) return;
      if (e.repeat) return;
      
      // Handle PTT
      if (pttKey) {
        const pressedKey = e.code;
        if (pressedKey === pttKey && !pttPressed) {
          e.preventDefault();
          pttPressed = true;
          bridge.send('voice.pttKey', { pressed: true });
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!pttKey) return;
      const pressedKey = e.code;
      if (pressedKey === pttKey && pttPressed) {
        pttPressed = false;
        bridge.send('voice.pttKey', { pressed: false });
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);

    return () => {
      bridge.off('settings.current', handleSettingsCurrent);
      bridge.off('settings.updated', handleSettingsCurrent);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Register all bridge handlers once on mount
  useEffect(() => {
    const onVoiceConnected = ((data: unknown) => {
      setConnectionStatus('connected');
      updateStatus('voice', { state: 'connected', error: undefined });
      const d = data as { username?: string; channelId?: number; channels?: Channel[]; users?: User[] } | undefined;

      // Use actual channel from server instead of assuming root.
      // Registered Mumble users may be placed in their last channel.
      const initialChannelId = d?.channelId ?? 0;
      if (initialChannelId === 0) {
        setCurrentChannelId('server-root');
        setCurrentChannelName('');
      } else {
        setCurrentChannelId(String(initialChannelId));
        const channelName = d?.channels?.find(ch => ch.id === initialChannelId)?.name;
        setCurrentChannelName(channelName || '');
      }
      
      if (d?.username) {
        setUsername(d.username);
      }
      if (d?.channels) {
        setChannels(d.channels);
      }
      if (d?.users) {
        setUsers(d.users);
        const selfUser = d.users.find(u => u.self);
        if (selfUser) {
          setSelfMuted(selfUser.muted || false);
          setSelfDeafened(selfUser.deafened || false);
          setSelfSession(selfUser.session);
        }
        // Fetch avatars for users already present at connect time
        for (const u of d.users) {
          if (u.matrixUserId && !u.self && !u.avatarUrl) {
            fetchAvatarForUser(u.session, u.matrixUserId);
          }
        }
      }

      // Persist Mumble registration status to the saved server entry.
      // Password is intentionally omitted here (not stored in localStorage);
      // the backend preserves the existing password when an update omits it.
      const reg = data as { registered?: boolean; registeredName?: string } | undefined;
      if (reg?.registered) {
        try {
          const stored = localStorage.getItem('brmble-server');
          if (stored) {
            const savedServer = JSON.parse(stored) as SavedServer;
            if (savedServer.id) {
              const updated = { ...savedServer, registered: true, registeredName: reg.registeredName };
              bridge.send('servers.update', updated);
              localStorage.setItem('brmble-server', JSON.stringify(updated));
            }
          }
        } catch { /* ignore parse errors */ }
      } else {
        // Clear stale registration when server reports not-registered
        try {
          const stored = localStorage.getItem('brmble-server');
          if (stored) {
            const savedServer = JSON.parse(stored) as SavedServer;
            if (savedServer.id && savedServer.registered) {
              const updated = { ...savedServer, registered: false, registeredName: undefined };
              bridge.send('servers.update', updated);
              localStorage.setItem('brmble-server', JSON.stringify(updated));
            }
          }
        } catch { /* ignore parse errors */ }
      }
    });

    const onVoiceDisconnected = (data: unknown) => {
      clearPendingAction();
      purgeEphemeralMessages('server-root');
      const d = data as { reconnectAvailable?: boolean } | null;

      if (d?.reconnectAvailable && userSawConnectedRef.current) {
        // User was connected and saw the UI, then lost connection
        setConnectionStatus('disconnected');
        updateStatus('voice', { state: 'disconnected' });
      } else if (!userSawConnectedRef.current && connectionStatusRef.current !== 'idle') {
        // User never saw the connected UI — initial connect failed
        setConnectionStatus('failed');
        setServerAddress('');
        setServerLabel('');
        updateStatus('voice', { state: 'disconnected', label: undefined });
      } else {
        // Normal intentional disconnect — go back to server list
        setConnectionStatus('idle');
        setServerAddress('');
        setServerLabel('');
        updateStatus('voice', { state: 'disconnected', label: undefined });
      }
      setChannels([]);
      setUsers([]);
      setCurrentChannelId(undefined);
      setCurrentChannelName('');
      setSelfMuted(false);
      setSelfDeafened(false);
      setSelfLeftVoice(false);
      setSelfCanRejoin(false);
      setSelfSession(0);
      setSpeakingUsers(new Map());
      setMatrixCredentials(null);
      setCurrentUserAvatarUrl(undefined);
      fetchedAvatarIdsRef.current.clear();
      disconnectViewerRef.current?.();
      setSharingChannelId(undefined);
      setScreenShareToast(null);
      // Reset divider timestamps so stale snapshots from the previous session
      // don't persist across disconnect/reconnect cycles.
      setChannelDividerTs(null);
      setDmDividerTs(null);
      updateStatus('livekit', { state: 'idle', error: undefined });
      updateStatus('server', { state: 'idle', error: undefined });
    };

    const onServerCredentials = (data: unknown) => {
      setConnectionError(null);
      const wrapped = data as { matrix?: MatrixCredentials } | undefined;
      const d = wrapped?.matrix;
      if (d?.homeserverUrl && d.accessToken && d.userId && d.roomMap) {
        // Clear stale chat data from previous sessions
        clearChatStorage();
        setMatrixCredentials(d);
      }
    };

    const onVoiceAuthError = (data: unknown) => {
      const d = data as { error?: string; message?: string; name?: string } | undefined;
      if (d?.error === 'name_taken') {
        setConnectionError(`Username "${d.name || ''}" is already taken. Please choose a different name.`);
      } else {
        setConnectionError(d?.message || 'Authentication failed.');
      }
    };

    const onVoiceError = ((data: unknown) => {
      clearPendingAction();
      const d = data as { message?: string } | undefined;
      const errorMsg = d?.message || 'Unknown error';
      console.error('Voice error:', errorMsg);
      updateStatus('voice', { error: errorMsg });
    });

    const onVoiceMessage = ((data: unknown) => {
      const d = data as {
        message: string;
        senderSession?: number;
        channelIds?: number[];
        sessions?: number[];
        certHash?: string;
      } | undefined;
      if (!d?.message) return;

      const selfUser = usersRef.current.find(u => u.self);
      if (selfUser && d.senderSession === selfUser.session) return;
      if (d.senderSession === undefined) return;

      const senderUser = usersRef.current.find(u => u.session === d.senderSession);
      const senderName = senderUser?.name || 'Unknown';

      const isPrivateMessage = d.sessions && d.sessions.length > 0 &&
        (!d.channelIds || d.channelIds.length === 0);

      // Channel messages: use Mumble path only when Matrix is not active for the channel
      if (!isPrivateMessage) {
        if (d.channelIds && d.channelIds.length > 0) {
          const creds = matrixCredentialsRef.current;
          const channelId = String(d.channelIds[0]);
          const matrixActive = creds?.roomMap[channelId] !== undefined;
          if (!matrixActive) {
            const storeKey = `channel-${channelId}`;
        const messageMedia = parseMessageMedia(d.message);
            if (currentChannelIdRef.current === channelId) {
              addMessageRef.current(senderName, messageMedia.text, undefined, undefined, messageMedia.media.length > 0 ? messageMedia.media : undefined);
            } else {
              addMessageToStore(storeKey, senderName, messageMedia.text, undefined, undefined, messageMedia.media.length > 0 ? messageMedia.media : undefined);
            }
          }
        }
        return;
      }

      // Private Mumble message → route to DM store
      if (d.certHash) {
        // Mumble clients send HTML — strip tags and decode entities for plain-text display
        const { text } = parseMessageMedia(d.message);
        const plainText = text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
        dmStoreRef.current.receiveMumbleDM(d.certHash, d.senderSession!, senderName, plainText || d.message);
      }
    });

    const onVoiceSystem = ((data: unknown) => {
      const d = data as { message: string; systemType?: string; html?: boolean } | undefined;
      if (d?.message) {
        const currentKey = currentChannelIdRef.current;
        if (currentKey === 'server-root') {
          addMessageRef.current('Server', d.message, 'system', d.html, undefined, d.systemType);
        } else {
          addMessageToStore('server-root', 'Server', d.message, 'system', d.html, undefined, d.systemType);
        }
      }
    });

    const onVoiceUserJoined = ((data: unknown) => {
      const d = data as { session: number; name: string; channelId?: number; muted?: boolean; deafened?: boolean; self?: boolean; comment?: string; matrixUserId?: string; certHash?: string; isBrmbleClient?: boolean } | undefined;
      if (d?.session && d.channelId !== undefined) {
        const previousChannelId = previousChannelIdRef.current.get(d.session);
        
        setUsers(prev => {
          const existing = prev.find(u => u.session === d.session);
          if (existing) {
            const updatedChannelId = d.channelId !== undefined ? d.channelId : existing.channelId;
            // Preserve certHash and matrixUserId — don't let falsy updates overwrite valid values
            const certHash = d.certHash || existing.certHash;
            const matrixUserId = d.matrixUserId || existing.matrixUserId;
            const isBrmbleClient = d.isBrmbleClient !== undefined ? d.isBrmbleClient : existing.isBrmbleClient;
            return prev.map(u => u.session === d.session ? { ...u, ...d, channelId: updatedChannelId, certHash, matrixUserId, isBrmbleClient } : u);
          }
          return [...prev, d];
        });

        // Fetch avatar for newly joined user if they have a matrixUserId
        if (d.matrixUserId && !d.self) {
          fetchAvatarForUser(d.session, d.matrixUserId);
        }

        if (!d.self) {
          const selfUser = usersRef.current.find(u => u.self);
          const selfChannelId = selfUser?.channelId;
          if (selfChannelId !== undefined && d.channelId === selfChannelId && previousChannelId !== selfChannelId) {
            speakText(`${d.name} joined`);
          }
        }
        
        previousChannelIdRef.current.set(d.session, d.channelId);

        // Update Mumble DM contact session on reconnect
        if (d.certHash && !d.self) {
          dmStoreRef.current.updateMumbleSession(d.certHash, d.session, d.name);
        }
      }
    });

    const onVoiceChannelJoined = ((data: unknown) => {
      const d = data as { id: number; name: string; parent?: number } | undefined;
      if (d?.id !== undefined) {
        setChannels(prev => {
          const existing = prev.find(c => c.id === d.id);
          if (existing) {
            return prev.map(c => c.id === d.id ? d : c);
          }
          return [...prev, d];
        });
      }
    });

    const onVoiceChannelRemoved = ((data: unknown) => {
      const d = data as { id: number } | undefined;
      if (d?.id !== undefined) {
        setChannels(prev => prev.filter(c => c.id !== d.id));
      }
    });

    const onVoiceChannelChanged = ((data: unknown) => {
      clearPendingAction();
      const d = data as { channelId: number; name?: string } | undefined;
      if (d?.channelId !== undefined && d?.channelId !== null) {
        if (d.channelId === 0) {
          setCurrentChannelId('server-root');
          setCurrentChannelName('');
        } else {
          setCurrentChannelId(String(d.channelId));
          if (d.name) {
            setCurrentChannelName(d.name);
          } else {
            const channel = channelsRef.current.find(c => c.id === d.channelId);
            setCurrentChannelName(channel?.name || '');
          }
        }
      }
    });

    const onVoiceUserLeft = ((data: unknown) => {
      const d = data as { session: number; name?: string; channelId?: number; certHash?: string } | undefined;
      if (d?.session) {
        const selfUser = usersRef.current.find(u => u.self);
        const userName = d.name;
        if (
          userName &&
          selfUser &&
          d.session !== selfUser.session &&
          selfUser.channelId !== undefined &&
          d.channelId === selfUser.channelId
        ) {
          speakText(`${userName} left`);
        }

        // Update Mumble DM contact session to null (offline)
        const leavingUser = usersRef.current.find(u => u.session === d.session);
        const certHash = d.certHash || leavingUser?.certHash;
        if (certHash) {
          dmStoreRef.current.updateMumbleSession(certHash, null);
        }

        setUsers(prev => prev.filter(u => u.session !== d.session));
      }
    });

    const onSelfMuteChanged = ((data: unknown) => {
      const d = data as { muted: boolean } | undefined;
      if (d?.muted !== undefined) {
        setSelfMuted(d.muted);
      }
    });

    const onSelfDeafChanged = ((data: unknown) => {
      const d = data as { deafened: boolean } | undefined;
      if (d?.deafened !== undefined) {
        setSelfDeafened(d.deafened);
      }
    });

    const onLeftVoiceChanged = ((data: unknown) => {
      clearPendingAction();
      const d = data as { leftVoice: boolean } | undefined;
      if (d?.leftVoice !== undefined) {
        setSelfLeftVoice(d.leftVoice);
        if (d.leftVoice) {
          disconnectViewerRef.current?.();
          setSharingChannelId(undefined);
          setScreenShareToast(null);
          handleSelectServer();
        }
      }
    });

    const onCanRejoinChanged = ((data: unknown) => {
      const d = data as { canRejoin: boolean } | undefined;
      if (d?.canRejoin !== undefined) {
        setSelfCanRejoin(d.canRejoin);
      }
    });

    const onVoiceUserSpeaking = ((data: unknown) => {
      const d = data as { session: number } | undefined;
      if (d?.session !== undefined) {
        setSpeakingUsers(prev => {
          const next = new Map(prev);
          next.set(d.session, true);
          return next;
        });
      }
    });

    const onVoiceUserSilent = ((data: unknown) => {
      const d = data as { session: number } | undefined;
      if (d?.session !== undefined) {
        setSpeakingUsers(prev => {
          const next = new Map(prev);
          next.delete(d.session);
          return next;
        });
      }
    });

    const onVoiceUserCommentChanged = ((data: unknown) => {
      const d = data as { session: number; comment?: string } | undefined;
      if (d?.session !== undefined) {
        setUsers(prev => prev.map(u =>
          u.session === d.session ? { ...u, comment: d.comment } : u
        ));
      }
    });

    // Map shortcut action names to UserPanel button names
    const ACTION_TO_BTN: Record<string, string> = {
      toggleMute: 'mute',
      toggleMuteDeafen: 'deaf',
      toggleLeaveVoice: 'leave',
      toggleDmScreen: 'dm',
      toggleScreenShare: 'screen',
    };

    const onShortcutPressed = (data: unknown) => {
      const d = data as { action: string } | undefined;
      if (d?.action) {
        const btn = ACTION_TO_BTN[d.action];
        if (btn) setHotkeyPressedBtn(btn);
      }
    };

    const onShortcutReleased = (data: unknown) => {
      const d = data as { action: string } | undefined;
      if (d?.action) {
        const btn = ACTION_TO_BTN[d.action];
        if (btn) setHotkeyPressedBtn(prev => prev === btn ? null : prev);
      }
    };

    const onToggleDmScreen = () => {
      if (connectionStatusRef.current !== 'connected') {
        dmStoreRef.current.clearSelection();
        return;
      }
      // Clear selection when toggling FROM dm TO channels
      if (dmStoreRef.current.appModeRef.current === 'dm') {
        dmStoreRef.current.clearSelection();
      }
      dmStoreRef.current.toggleMode();
    };

    const onToggleScreenShare = () => {
      handleToggleScreenShareRef.current?.();
    };

    const onToggleGame = () => {
      setShowGame(prev => !prev);
    };

    const onShowCloseDialog = () => {
      setShowCloseDialog(true);
    };

    const onCertStatus = (data: unknown) => {
      const d = data as { exists: boolean; fingerprint?: string } | undefined;
      if (d?.exists) {
        setCertExists(true);
        const fp = d.fingerprint ?? '';
        if (fp) migrateLocalStorage(fp);
        setCertFingerprint(fp);
      } else {
        setCertExists(false);
      }
    };
    const onCertGenerated = (data: unknown) => {
      const d = data as { fingerprint?: string } | undefined;
      setCertExists(true);
      const fp = d?.fingerprint ?? '';
      if (fp) migrateLocalStorage(fp);
      setCertFingerprint(fp);
    };
    const onCertImported = (data: unknown) => {
      const d = data as { fingerprint?: string } | undefined;
      setCertExists(true);
      const fp = d?.fingerprint ?? '';
      if (fp) migrateLocalStorage(fp);
      setCertFingerprint(fp);
    };

    const onProfilesActiveChanged = (data: unknown) => {
      const d = data as { id: string | null; name: string | null; fingerprint: string | null };
      resetMarkersCache();
      if (d.id) {
        setCertExists(true);
        const fp = d.fingerprint ?? '';
        if (fp) migrateLocalStorage(fp);
        setCertFingerprint(fp);
        setActiveProfileName(d.name ?? '');
      } else {
        setCertExists(false);
        setCertFingerprint('');
        setActiveProfileName('');
        setShowSettings(false);
      }
    };

    const onProfilesList = (data: unknown) => {
      const d = data as { profiles: Array<{ id: string; name: string }>; activeProfileId: string | null };
      setProfiles(d.profiles ?? []);
      if (d.activeProfileId) {
        const active = d.profiles.find(p => p.id === d.activeProfileId);
        if (active) setActiveProfileName(active.name);
      }
    };

    const onAutoConnect = (data: unknown) => {
      const server = data as { id: string; label: string; apiUrl?: string; host?: string; port?: number; defaultProfileId?: string } | undefined;
      if (server) {
        setServerLabel(server.label || `${server.host}:${server.port}`);

        // Apply per-server profile override on auto-connect
        let effectiveName = activeProfileName;
        if (server.defaultProfileId) {
          const overrideProfile = profiles.find(p => p.id === server.defaultProfileId);
          if (overrideProfile) effectiveName = overrideProfile.name;
          bridge.send('profiles.setActive', { id: server.defaultProfileId });
        }

        handleConnect({
          id: server.id,
          label: server.label,
          apiUrl: server.apiUrl,
          host: server.host || '',
          port: server.port || 0,
          username: effectiveName || 'Brmble User',
          password: '',
          defaultProfileId: server.defaultProfileId,
        });
      }
    };

    const onVoiceReconnecting = () => {
      setConnectionStatus('reconnecting');
      updateStatus('voice', { state: 'connecting' });
    };
    const onVoiceReconnectFailed = (data?: unknown) => {
      clearPendingAction();
      setConnectionStatus('failed');
      const d = data as { reason?: string } | undefined;
      updateStatus('voice', { state: 'disconnected', error: d?.reason || 'Reconnect failed' });
      setServerAddress('');
      setServerLabel('');
      setChannels([]);
      setUsers([]);
      setCurrentChannelId(undefined);
      setCurrentChannelName('');
      setSelfMuted(false);
      setSelfDeafened(false);
      setSelfLeftVoice(false);
      setSelfCanRejoin(false);
      setSelfSession(0);
      setSpeakingUsers(new Map());
      setCurrentUserAvatarUrl(undefined);
    };

    const onUserMappingUpdated = (data: unknown) => {
      const d = data as { sessionId: number; matrixUserId?: string; isBrmbleClient?: boolean; action: string } | undefined;
      if (d?.sessionId !== undefined) {
        setUsers(prev => prev.map(u =>
          u.session === d.sessionId
            ? { ...u, matrixUserId: d.action === 'added' ? d.matrixUserId : undefined, isBrmbleClient: d.action === 'added' ? d.isBrmbleClient : undefined }
            : u
        ));
        // Fetch avatar for the newly mapped user if they don't have one yet
        if (d.action === 'added' && d.matrixUserId) {
          fetchAvatarForUser(d.sessionId, d.matrixUserId);
        }
      }
    };

    const onSessionMappingSnapshot = (data: unknown) => {
      const d = data as { mappings: Record<string, { matrixUserId: string; mumbleName: string; isBrmbleClient?: boolean }> } | undefined;
      if (d?.mappings && typeof d.mappings === 'object') {
        setUsers(prev => {
          const mappingMap = new Map<number, { matrixUserId: string; isBrmbleClient?: boolean }>();
          for (const [sid, entry] of Object.entries(d.mappings)) {
            mappingMap.set(Number(sid), { matrixUserId: entry.matrixUserId, isBrmbleClient: entry.isBrmbleClient });
          }
          return prev.map(u => {
            const m = mappingMap.get(u.session);
            return m ? { ...u, matrixUserId: m.matrixUserId, isBrmbleClient: m.isBrmbleClient } : u;
          });
        });
        // Fetch avatars for users that gained a matrixUserId
        for (const [sid, entry] of Object.entries(d.mappings)) {
          fetchAvatarForUser(Number(sid), entry.matrixUserId);
        }
      }
    };

    const onBrmbleClientActivated = (data: unknown) => {
      const d = data as { sessionId: number } | undefined;
      if (d?.sessionId !== undefined) {
        setUsers(prev => prev.map(u =>
          u.session === d.sessionId ? { ...u, isBrmbleClient: true } : u
        ));
      }
    };

    const onBrmbleClientDeactivated = (data: unknown) => {
      const d = data as { sessionId: number } | undefined;
      if (d?.sessionId !== undefined) {
        setUsers(prev => prev.map(u =>
          u.session === d.sessionId ? { ...u, isBrmbleClient: false } : u
        ));
      }
    };

    const onRegistrationStatus = (data: unknown) => {
      const d = data as { serverId?: string; registered?: boolean; registeredName?: string } | undefined;
      if (!d?.registered || !d.serverId) return;
      // Password is intentionally omitted (not in localStorage);
      // the backend preserves the existing password when an update omits it.
      try {
        const stored = localStorage.getItem('brmble-server');
        if (stored) {
          const savedServer = JSON.parse(stored) as SavedServer;
          if (savedServer.id === d.serverId) {
            const updated = { ...savedServer, registered: true, registeredName: d.registeredName };
            bridge.send('servers.update', updated);
            localStorage.setItem('brmble-server', JSON.stringify(updated));
          }
        }
      } catch { /* ignore parse errors */ }
    };

    bridge.on('voice.connected', onVoiceConnected);
    bridge.on('voice.disconnected', onVoiceDisconnected);
    bridge.on('voice.error', onVoiceError);
    bridge.on('voice.message', onVoiceMessage);
    bridge.on('voice.system', onVoiceSystem);
    bridge.on('voice.userJoined', onVoiceUserJoined);
    bridge.on('voice.channelJoined', onVoiceChannelJoined);
    bridge.on('voice.channelRemoved', onVoiceChannelRemoved);
    bridge.on('voice.userLeft', onVoiceUserLeft);
    bridge.on('voice.channelChanged', onVoiceChannelChanged);
    bridge.on('voice.selfMuteChanged', onSelfMuteChanged);
    bridge.on('voice.selfDeafChanged', onSelfDeafChanged);
    bridge.on('voice.leftVoiceChanged', onLeftVoiceChanged);
    bridge.on('voice.canRejoinChanged', onCanRejoinChanged);
    bridge.on('voice.userSpeaking', onVoiceUserSpeaking);
    bridge.on('voice.userSilent', onVoiceUserSilent);
    bridge.on('voice.userCommentChanged', onVoiceUserCommentChanged);
    bridge.on('voice.shortcutPressed', onShortcutPressed);
    bridge.on('voice.shortcutReleased', onShortcutReleased);
    bridge.on('voice.toggleDmScreen', onToggleDmScreen);
    bridge.on('voice.toggleScreenShare', onToggleScreenShare);
    bridge.on('game.toggle', onToggleGame);
    bridge.on('window.showCloseDialog', onShowCloseDialog);
    bridge.on('cert.status', onCertStatus);
    bridge.on('cert.generated', onCertGenerated);
    bridge.on('cert.imported', onCertImported);
    bridge.on('profiles.activeChanged', onProfilesActiveChanged);
    bridge.on('profiles.list', onProfilesList);
    bridge.on('voice.autoConnect', onAutoConnect);
    bridge.on('voice.reconnecting', onVoiceReconnecting);
    bridge.on('voice.reconnectFailed', onVoiceReconnectFailed);
    bridge.on('server.credentials', onServerCredentials);
    bridge.on('voice.authError', onVoiceAuthError);
    bridge.on('voice.userMappingUpdated', onUserMappingUpdated);
    bridge.on('voice.sessionMappingSnapshot', onSessionMappingSnapshot);
    bridge.on('voice.brmbleClientActivated', onBrmbleClientActivated);
    bridge.on('voice.brmbleClientDeactivated', onBrmbleClientDeactivated);
    bridge.on('voice.registrationStatus', onRegistrationStatus);

    const onUpdateAvailable = (data: unknown) => {
      setUpdateInfo(data as { version: string });
      setUpdateProgress(null);
    };
    const onUpdateProgress = (data: unknown) => setUpdateProgress((data as { progress: number }).progress);
    bridge.on('app.updateAvailable', onUpdateAvailable);
    bridge.on('app.updateProgress', onUpdateProgress);

    return () => {
      bridge.off('app.updateAvailable', onUpdateAvailable);
      bridge.off('app.updateProgress', onUpdateProgress);
      bridge.off('voice.connected', onVoiceConnected);
      bridge.off('voice.disconnected', onVoiceDisconnected);
      bridge.off('voice.error', onVoiceError);
      bridge.off('voice.message', onVoiceMessage);
      bridge.off('voice.system', onVoiceSystem);
      bridge.off('voice.userJoined', onVoiceUserJoined);
      bridge.off('voice.channelJoined', onVoiceChannelJoined);
      bridge.off('voice.channelRemoved', onVoiceChannelRemoved);
      bridge.off('voice.userLeft', onVoiceUserLeft);
      bridge.off('voice.channelChanged', onVoiceChannelChanged);
      bridge.off('voice.selfMuteChanged', onSelfMuteChanged);
      bridge.off('voice.selfDeafChanged', onSelfDeafChanged);
      bridge.off('voice.leftVoiceChanged', onLeftVoiceChanged);
      bridge.off('voice.canRejoinChanged', onCanRejoinChanged);
      bridge.off('voice.userSpeaking', onVoiceUserSpeaking);
      bridge.off('voice.userSilent', onVoiceUserSilent);
      bridge.off('voice.userCommentChanged', onVoiceUserCommentChanged);
      bridge.off('voice.shortcutPressed', onShortcutPressed);
      bridge.off('voice.shortcutReleased', onShortcutReleased);
      bridge.off('voice.toggleDmScreen', onToggleDmScreen);
      bridge.off('voice.toggleScreenShare', onToggleScreenShare);
      bridge.off('game.toggle', onToggleGame);
      bridge.off('window.showCloseDialog', onShowCloseDialog);
      bridge.off('cert.status', onCertStatus);
      bridge.off('cert.generated', onCertGenerated);
      bridge.off('cert.imported', onCertImported);
      bridge.off('profiles.activeChanged', onProfilesActiveChanged);
      bridge.off('profiles.list', onProfilesList);
      bridge.off('voice.autoConnect', onAutoConnect);
      bridge.off('voice.reconnecting', onVoiceReconnecting);
      bridge.off('voice.reconnectFailed', onVoiceReconnectFailed);
      bridge.off('server.credentials', onServerCredentials);
      bridge.off('voice.authError', onVoiceAuthError);
      bridge.off('voice.userMappingUpdated', onUserMappingUpdated);
      bridge.off('voice.sessionMappingSnapshot', onSessionMappingSnapshot);
      bridge.off('voice.brmbleClientActivated', onBrmbleClientActivated);
      bridge.off('voice.brmbleClientDeactivated', onBrmbleClientDeactivated);
      bridge.off('voice.registrationStatus', onRegistrationStatus);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bridge.send('cert.requestStatus');
    bridge.send('profiles.list');
  }, []);

  useEffect(() => {
    if (currentChannelId && currentChannelId !== 'server-root' && matrixCredentials) {
      matrixClient.fetchHistory(currentChannelId).catch(console.error);
    }
  }, [currentChannelId, matrixCredentials]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (pendingChannelActionTimeoutRef.current) {
        clearTimeout(pendingChannelActionTimeoutRef.current);
      }
    };
  }, []);

const handleConnect = (serverData: SavedServer) => {
    // Don't store password in localStorage - use secure storage instead
    const { password, ...safeServerData } = serverData;
    localStorage.setItem('brmble-server', JSON.stringify(safeServerData));
    setServerAddress(`${serverData.host}:${serverData.port}`);
    setConnectionStatus('connecting');
    userSawConnectedRef.current = false;
    bridge.send('voice.connect', serverData);
    updateStatus('voice', { state: 'connecting', error: undefined, label: `${serverData.host}:${serverData.port}` });
    
    // Send transmission mode from settings
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (stored) {
        const settings = JSON.parse(stored);
        if (settings.audio?.transmissionMode) {
          bridge.send('voice.setTransmissionMode', {
            mode: settings.audio.transmissionMode,
            key: settings.audio.transmissionMode === 'pushToTalk' ? settings.audio.pushToTalkKey : null,
          });
        }
      }
    } catch (e) {
      console.error('Failed to send transmission mode:', e);
    }
  };

  const handleServerConnect = (server: ServerEntry) => {
    setServerLabel(server.label || `${server.host}:${server.port}`);

    // Resolve the effective profile name synchronously before switching profiles.
    // If the server has a defaultProfileId override, look it up in the profiles list
    // rather than using activeProfileName (which would be stale until the async
    // profiles.activeChanged event arrives).
    let effectiveProfileName = activeProfileName;
    if (server.defaultProfileId) {
      const overrideProfile = profiles.find(p => p.id === server.defaultProfileId);
      if (overrideProfile) effectiveProfileName = overrideProfile.name;
      bridge.send('profiles.setActive', { id: server.defaultProfileId });
    }

    handleConnect({
      id: server.id,
      label: server.label,
      apiUrl: server.apiUrl,
      host: server.host,
      port: server.port,
      username: (!server.defaultProfileId && server.registered ? server.registeredName : null) || effectiveProfileName || 'Brmble User',
      password: server.password || '',
      registered: server.registered,
      registeredName: server.registeredName,
      defaultProfileId: server.defaultProfileId,
    });
  };

  const handleJoinChannel = async (channelId: number) => {
    const selfVoiceChannelId = users.find(u => u.self)?.channelId;
    if (selfVoiceChannelId === channelId) {
      return;
    }
    if (isSharing && sharingChannelId && String(channelId) !== sharingChannelId) {
      const sharingChannel = channels.find(c => String(c.id) === sharingChannelId);
      const sharingChannelName = sharingChannel?.name || `channel ${sharingChannelId}`;
      const shouldStop = await confirm({
        title: 'Screen share active',
        message: `You are sharing your screen to "${sharingChannelName}". Stop sharing?`,
        confirmLabel: 'Stop Sharing',
        cancelLabel: 'Keep Sharing',
      });
      if (shouldStop) {
        await stopSharing();
        setSharingChannelId(undefined);
      }
    }
    startPendingAction(channelId);
    bridge.send('voice.joinChannel', { channelId });
  };

  const handleSelectChannel = (channelId: number) => {
    const channel = channels.find(c => c.id === channelId);
    if (channel) {
      setCurrentChannelId(String(channelId));
      setCurrentChannelName(channel.name);
      setUnreadCount(0);
      setShowGame(false);

      if (dmStore.appMode === 'dm') {
        dmStore.toggleMode();
      }
      dmStore.clearSelection();
    }
  };

  const handleSelectServer = () => {
    setCurrentChannelId('server-root');
    setCurrentChannelName(serverLabel || 'Server');
    // Close DM mode if open and clear selection (mirrors handleSelectChannel)
    if (dmStore.appMode === 'dm') {
      dmStore.toggleMode();
    }
    dmStore.clearSelection();
  };

  const handleSendMessage = (content: string, image?: File, replyTo?: { sender: string; content: string } | null) => {
    if (!username || (!content && !image)) return;

    const channelId = currentChannelId;
    if (!channelId) return;

    const isMatrixChannel = channelId !== 'server-root' &&
      matrixCredentials?.roomMap[channelId] !== undefined;

    // Send text content (existing behavior)
    if (content) {
      if (!isMatrixChannel) {
        addMessage(username, content, undefined, undefined, undefined, undefined, replyTo ?? undefined);
      }

      if (channelId === 'server-root') {
        bridge.send('voice.sendMessage', { message: content, channelId: 0 });
      } else {
        bridge.send('voice.sendMessage', { message: content, channelId: Number(channelId) });
        if (isMatrixChannel) {
          matrixClient.sendMessage(channelId, content, replyTo ?? undefined).catch(console.error);
        }
      }
    }

    // Send image
    if (image) {
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const objectUrl = URL.createObjectURL(image);

      const optimisticMsg: ChatMessage = {
        id: tempId,
        channelId,
        sender: username,
        content: '',
        timestamp: new Date(),
        pending: true,
        media: [{
          type: image.type === 'image/gif' ? 'gif' : 'image',
          url: objectUrl,
          mimetype: image.type,
          size: image.size,
        }],
      };

      setOptimisticImages(prev => [...prev, optimisticMsg]);

      // Mumble path (fire and forget)
      encodeForMumble(image).then(imgTag => {
        if (channelId === 'server-root') {
          bridge.send('voice.sendMessage', { message: imgTag, channelId: 0 });
        } else {
          bridge.send('voice.sendMessage', { message: imgTag, channelId: Number(channelId) });
        }
      }).catch(err => console.error('Mumble image send failed:', err));

      // Matrix path
      if (isMatrixChannel) {
        matrixClient.uploadContent(image)
          .then(mxcUrl => matrixClient.sendImageMessage(channelId, image, mxcUrl))
          .then(() => {
            setOptimisticImages(prev => prev.filter(m => m.id !== tempId));
            URL.revokeObjectURL(objectUrl);
          })
          .catch(err => {
            console.error('Matrix image upload failed:', err);
            setOptimisticImages(prev => prev.map(m =>
              m.id === tempId ? { ...m, pending: false, error: true } : m
            ));
          });
      } else {
        setOptimisticImages(prev => prev.map(m =>
          m.id === tempId ? { ...m, pending: false } : m
        ));
      }
    }

    setUnreadCount(0);
  };

  const handleDismissMessage = (messageId: string) => {
    setOptimisticImages(prev => {
      const msg = prev.find(m => m.id === messageId);
      if (msg?.media) {
        for (const item of msg.media) {
          if (item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
        }
      }
      return prev.filter(m => m.id !== messageId);
    });
  };

  const handleDisconnect = () => {
    bridge.send('voice.disconnect');
  };

  const handleCancelReconnect = () => {
    bridge.send('voice.cancelReconnect');
  };

  const handleReconnect = () => {
    const stored = localStorage.getItem('brmble-server');
    if (stored) {
      try {
        const serverData = JSON.parse(stored) as SavedServer;
        handleConnect(serverData);
      } catch {
        setConnectionStatus('idle');
      }
    } else {
      setConnectionStatus('idle');
    }
  };

  const handleBackToServerList = () => {
    bridge.send('voice.disconnect');
    clearPendingAction();
    userSawConnectedRef.current = false;
    setConnectionStatus('idle');
    resetStatuses();
    setServerLabel('');
    setServerAddress('');
    setUsername('');
    setChannels([]);
    setUsers([]);
    setCurrentChannelId(undefined);
    setCurrentChannelName('');
    setSelfMuted(false);
    setSelfDeafened(false);
    setSelfLeftVoice(false);
    setSelfCanRejoin(false);
    setSelfSession(0);
    setSpeakingUsers(new Map());
    setMatrixCredentials(null);
    setSharingChannelId(undefined);
  };

  const handleToggleMute = () => {
    if (muteOnCooldown) return;
    triggerMuteCooldown();
    bridge.send('voice.toggleMute', {});
  };

  const handleToggleDeaf = () => {
    if (deafOnCooldown) return;
    triggerDeafCooldown();
    bridge.send('voice.toggleDeaf', {});
  };

  const handleLeaveVoice = async () => {
    if (leaveVoiceOnCooldown) return;

    triggerLeaveVoiceCooldown();

    if (isSharing) {
      const shouldStop = await confirm({
        title: 'Screen share active',
        message: 'You are currently sharing your screen. Stop sharing?',
        confirmLabel: 'Stop Sharing',
        cancelLabel: 'Keep Sharing',
      });
      if (shouldStop) {
        await stopSharing();
        setSharingChannelId(undefined);
      }
    }
    startPendingAction('leave');
    bridge.send('voice.leaveVoice', {});
  };

  const handleCloseMinimize = useCallback((dontAskAgain: boolean) => {
    setShowCloseDialog(false);
    if (dontAskAgain) {
      bridge.send('window.setClosePreference', { action: 'minimize' });
    }
    bridge.send('window.minimize');
  }, []);

  const handleCloseQuit = useCallback((dontAskAgain: boolean) => {
    setShowCloseDialog(false);
    if (dontAskAgain) {
      bridge.send('window.setClosePreference', { action: 'quit' });
    }
    bridge.send('window.quit');
  }, []);

  const toggleDMMode = () => {
    setShowGame(false);
    // Clear selection when toggling FROM dm TO channels
    if (dmStore.appMode === 'dm') {
      dmStore.clearSelection();
    }
    dmStore.toggleMode();
  };

  // Push DM badge state to native side whenever unread count changes
  useEffect(() => {
    updateBadge(totalDmUnreadCount, hasPendingInvite);
  }, [totalDmUnreadCount, hasPendingInvite, updateBadge]);

  // Push current theme to native side for themed tray/taskbar icons
  useEffect(() => {
    const sendTheme = () => {
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme) {
        bridge.send('notification.theme', { theme });
      }
    };

    // Send current theme on mount
    sendTheme();

    // Watch for theme changes (applyTheme sets data-theme attribute)
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme') {
          sendTheme();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => observer.disconnect();
  }, []);

  const handleStartDMFromContextMenu = useCallback((sessionIdStr: string, userName: string) => {
    const user = users.find(u => String(u.session) === sessionIdStr);

    // Route based on whether the user is on a Brmble client
    if (user?.isBrmbleClient && user.matrixUserId) {
      // Brmble client → Matrix DM (persistent)
      dmStore.startDM(user.matrixUserId, userName, user.avatarUrl);
    } else if (user?.certHash) {
      // Mumble client (even if Brmble-registered) → Mumble DM (ephemeral)
      // Check for existing ephemeral contact first
      const existingMumbleContact = dmStore.contacts.find(c => c.isEphemeral && c.mumbleCertHash === user.certHash);
      if (existingMumbleContact) {
        dmStore.selectContact(existingMumbleContact.id);
      } else {
        dmStore.startMumbleDM(user.certHash, user.session, userName);
      }
    } else {
      console.warn('[DM] Cannot start DM: user has no certHash');
    }
  }, [users, dmStore]);

  const handleChatMessageContextMenu = useCallback((_x: number, _y: number, sender: string, senderMatrixUserId?: string) => {
    // Look up user by matrixUserId first, then by name
    let user = users.find(u => u.matrixUserId === senderMatrixUserId);
    if (!user && sender) {
      user = users.find(u => u.name === sender);
    }
    
    if (user) {
      if (user.isBrmbleClient && user.matrixUserId) {
        dmStore.startDM(user.matrixUserId, sender, user.avatarUrl);
      } else if (user.certHash) {
        const existingMumbleContact = dmStore.contacts.find(c => c.isEphemeral && c.mumbleCertHash === user!.certHash);
        if (existingMumbleContact) {
          dmStore.selectContact(existingMumbleContact.id);
        } else {
          dmStore.startMumbleDM(user.certHash, user.session, sender);
        }
      } else {
        console.warn('[DM] Cannot start DM: user has no certHash');
      }
    } else {
      // Fallback: try starting DM by matrixUserId directly for users not in the users list
      if (senderMatrixUserId) {
        dmStore.startDM(senderMatrixUserId, sender, undefined);
      } else {
        console.warn('[DM] Cannot start DM: user not found');
      }
    }
  }, [users, dmStore]);

  const handleCopyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopyToast({ message: 'Copied to clipboard' });
    setTimeout(() => setCopyToast(null), 2000);
  }, []);

  const activeChannelId = currentChannelId && currentChannelId !== 'server-root'
    ? currentChannelId
    : undefined;
  const isMatrixActive = !!activeChannelId && matrixCredentials?.roomMap[activeChannelId] !== undefined;
  const matrixMessages = activeChannelId
    ? matrixClient.messages.get(activeChannelId)
    : undefined;

  const { Prompt, PromptWithInput } = usePrompt();

  const { isSharing, startSharing, stopSharing, error: screenShareError, activeShare, remoteVideoEl, disconnectViewer, connectAsViewer } = useScreenShare(() => {
    setSharingChannelId(undefined);
  });
  disconnectViewerRef.current = disconnectViewer;
  const [sharingChannelId, setSharingChannelId] = useState<string | undefined>();
  const [screenShareToast, setScreenShareToast] = useState<{
    userName: string;
    roomName: string;
  } | null>(null);
  const [copyToast, setCopyToast] = useState<{ message: string } | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);

  const { isOnCooldown: leaveVoiceOnCooldown, trigger: triggerLeaveVoiceCooldown } = useLeaveVoiceCooldown(1000);
  const { isOnCooldown: muteOnCooldown, trigger: triggerMuteCooldown } = useLeaveVoiceCooldown(1000);
  const { isOnCooldown: deafOnCooldown, trigger: triggerDeafCooldown } = useLeaveVoiceCooldown(1000);

  const handleDismissToast = useCallback(() => setScreenShareToast(null), []);

  const handleApplyUpdate = useCallback(() => {
    bridge.send('app.applyUpdate', {});
  }, []);

  const handleDismissUpdate = useCallback(() => {
    setUpdateInfo(null);
    setUpdateProgress(null);
    bridge.send('app.dismissUpdate');
  }, []);

  const channelUnreads = useMemo(() => {
    if (!matrixCredentials?.roomMap) return new Map<string, { notificationCount: number; highlightCount: number }>();
    const map = new Map<string, { notificationCount: number; highlightCount: number }>();
    for (const [channelId, roomId] of Object.entries(matrixCredentials.roomMap)) {
      const unread = unreadTracker.getRoomUnread(roomId);
      if (unread.notificationCount > 0) {
        map.set(channelId, {
          notificationCount: unread.notificationCount,
          highlightCount: unread.highlightCount,
        });
      }
    }
    return map;
  }, [matrixCredentials?.roomMap, unreadTracker.roomUnreads]);

  useEffect(() => {
    if (screenShareError) {
      console.error('Screen share error:', screenShareError);
      updateStatus('livekit', { state: 'disconnected', error: screenShareError });
    }
  }, [screenShareError, updateStatus]);

  // Track screenshare connection state for service status indicator
  useEffect(() => {
    if (isSharing) {
      updateStatus('livekit', { state: 'connected', error: undefined });
    } else if (!screenShareError) {
      // Only reset to idle if there's no active error (error case handled above)
      updateStatus('livekit', { state: 'idle', error: undefined });
    }
  }, [isSharing, screenShareError, updateStatus]);

  // Show toast notification when someone starts sharing in the user's voice channel
  useEffect(() => {
    const onRemoteShareStarted = (data: unknown) => {
      const d = data as { roomName: string; userName: string; sessionId?: number };
      const selfUser = usersRef.current.find(u => u.self);
      const voiceChannelId = selfUser?.channelId;
      if (voiceChannelId != null && d.roomName === `channel-${voiceChannelId}` && !isSharing) {
        setScreenShareToast({ userName: d.userName, roomName: d.roomName });
      }
    };

    const onRemoteShareStopped = () => {
      setScreenShareToast(null);
    };

    bridge.on('livekit.screenShareStarted', onRemoteShareStarted);
    bridge.on('livekit.screenShareStopped', onRemoteShareStopped);
    return () => {
      bridge.off('livekit.screenShareStarted', onRemoteShareStarted);
      bridge.off('livekit.screenShareStopped', onRemoteShareStopped);
    };
  }, [isSharing]);

  // Check for active screen shares when switching channels
  useEffect(() => {
    disconnectViewer();
    setScreenShareToast(null);
    if (currentChannelId && currentChannelId !== 'server-root') {
      bridge.send('livekit.checkActiveShare', { roomName: `channel-${currentChannelId}` });
    }
  }, [currentChannelId, disconnectViewer]);

  const handleToggleScreenShare = useCallback(async () => {
    if (isSharing) {
      await stopSharing();
      setSharingChannelId(undefined);
    } else if (!selfLeftVoice) {
      const selfUser = usersRef.current.find(u => u.self);
      const voiceChannelId = selfUser?.channelId;
      if (voiceChannelId != null && voiceChannelId !== 0) {
        updateStatus('livekit', { state: 'connecting', error: undefined });
        try {
          await startSharing(`channel-${voiceChannelId}`);
          setSharingChannelId(String(voiceChannelId));
        } catch {
          // startSharing sets error state internally; useEffect above handles status
        }
      }
    }
  }, [isSharing, startSharing, stopSharing, selfLeftVoice, updateStatus]);
  handleToggleScreenShareRef.current = handleToggleScreenShare;

  const handleWatchScreenShare = useCallback((roomName: string) => {
    connectAsViewer(roomName);
  }, [connectAsViewer]);

  // Track which channel/DM was last opened so we only snapshot + mark-read on actual switches.
  const prevChannelIdRef = useRef<string | undefined>(undefined);
  const prevDMUserIdRef = useRef<string | null>(null);

  // Snapshot the read marker ONCE when the user switches to a channel, then mark the room
  // as read. The divider stays at the snapshotted position until the user switches away.
  // We depend on roomUnreads so that on reconnect (when sync populates data after
  // the channel was already selected) we get a second chance to snapshot.
  useEffect(() => {
    const channelChanged = currentChannelId !== prevChannelIdRef.current;
    if (channelChanged) {
      prevChannelIdRef.current = currentChannelId;
    }

    if (!currentChannelId || currentChannelId === 'server-root') {
      if (channelChanged) setChannelDividerTs(null);
      return;
    }
    const roomId = matrixCredentials?.roomMap?.[currentChannelId];
    if (!roomId || !matrixClient?.client) {
      if (channelChanged) setChannelDividerTs(null);
      return;
    }

    const { notificationCount } = unreadTracker.getRoomUnread(roomId);
    const markerTs = unreadTracker.getMarkerTimestamp(roomId);
    const hasUnread = markerTs != null && notificationCount > 0;

    if (channelChanged) {
      // Snapshot the divider timestamp before marking read
      setChannelDividerTs(hasUnread ? markerTs : null);

      // Mark the room as read
      const room = matrixClient.client.getRoom(roomId);
      const timeline = room?.getLiveTimeline()?.getEvents();
      if (timeline && timeline.length > 0) {
        const lastEventId = timeline[timeline.length - 1].getId();
        if (lastEventId) {
          unreadTracker.markRoomRead(roomId, lastEventId);
        }
      }
    } else if (hasUnread) {
      // Same channel, but roomUnreads updated (e.g. sync just completed on reconnect).
      // Backfill the divider only if we haven't set one yet.
      setChannelDividerTs(prev => {
        if (prev !== null) return prev; // keep existing snapshot
        // Also mark read now that we have data
        const room = matrixClient.client!.getRoom(roomId);
        const timeline = room?.getLiveTimeline()?.getEvents();
        if (timeline && timeline.length > 0) {
          const lastEventId = timeline[timeline.length - 1].getId();
          if (lastEventId) {
            unreadTracker.markRoomRead(roomId, lastEventId);
          }
        }
        return markerTs;
      });
    }
  }, [currentChannelId, matrixCredentials?.roomMap, matrixClient, unreadTracker]);

  // Same pattern for DM switches
  useEffect(() => {
    const selectedId = dmStore.selectedContact?.id ?? null;
    const dmChanged = selectedId !== prevDMUserIdRef.current;
    if (dmChanged) {
      prevDMUserIdRef.current = selectedId;
    }

    if (!selectedId || !dmStore.selectedContact) {
      if (dmChanged) setDmDividerTs(null);
      return;
    }
    // Only Matrix contacts have room IDs for unread tracking
    if (!matrixClient?.dmRoomMap || !matrixClient?.client) {
      if (dmChanged) setDmDividerTs(null);
      return;
    }
    const roomId = matrixClient.dmRoomMap.get(selectedId);
    if (!roomId) {
      if (dmChanged) setDmDividerTs(null);
      return;
    }

    const { notificationCount } = unreadTracker.getRoomUnread(roomId);
    const markerTs = unreadTracker.getMarkerTimestamp(roomId);
    const hasUnread = markerTs != null && notificationCount > 0;

    if (dmChanged) {
      setDmDividerTs(hasUnread ? markerTs : null);

      const room = matrixClient.client.getRoom(roomId);
      const timeline = room?.getLiveTimeline()?.getEvents();
      if (timeline && timeline.length > 0) {
        const lastEventId = timeline[timeline.length - 1].getId();
        if (lastEventId) {
          unreadTracker.markRoomRead(roomId, lastEventId);
        }
      }
    } else if (hasUnread) {
      setDmDividerTs(prev => {
        if (prev !== null) return prev;
        const room = matrixClient.client!.getRoom(roomId);
        const timeline = room?.getLiveTimeline()?.getEvents();
        if (timeline && timeline.length > 0) {
          const lastEventId = timeline[timeline.length - 1].getId();
          if (lastEventId) {
            unreadTracker.markRoomRead(roomId, lastEventId);
          }
        }
        return markerTs;
      });
    }
  }, [dmStore.selectedContact, unreadTracker.roomUnreads, matrixClient.client, unreadTracker, matrixClient?.dmRoomMap]);

  return (
    <div className="app">
      <ProfileProvider value={certFingerprint}>
      <ErrorBoundary label="Header">
      <Header
        username={username}
        onToggleDM={connected ? toggleDMMode : undefined}
        dmActive={dmStore.appMode === 'dm'}
        unreadDMCount={totalDmUnreadCount}
        onOpenSettings={() => { setSettingsTab('profile'); setShowSettings(true); }}
        onOpenAudioSettings={() => { setSettingsTab('audio'); setShowSettings(true); }}
        onAvatarClick={connected ? () => setShowAvatarEditor(true) : undefined}
        avatarUrl={currentUserAvatarUrl}
        matrixUserId={matrixCredentials?.userId}
        muted={selfMuted}
        deafened={selfDeafened}
        leftVoice={selfLeftVoice}
        canRejoin={selfCanRejoin}
        onToggleMute={connected ? handleToggleMute : undefined}
        onToggleDeaf={connected ? handleToggleDeaf : undefined}
        onLeaveVoice={connected ? handleLeaveVoice : undefined}
        screenSharing={isSharing}
        screenShareError={screenShareError}
        onToggleScreenShare={connected ? handleToggleScreenShare : undefined}
        canScreenShare={connected && !selfLeftVoice && (users.find(u => u.self)?.channelId ?? 0) !== 0}
        speaking={speakingUsers.has(selfSession) || false}
        pendingChannelAction={pendingChannelAction}
        hotkeyPressedBtn={hotkeyPressedBtn}
        leaveVoiceOnCooldown={leaveVoiceOnCooldown}
        muteOnCooldown={muteOnCooldown}
        deafOnCooldown={deafOnCooldown}
        onToggleGame={() => setShowGame(prev => !prev)}
      />
      </ErrorBoundary>
      
      <div className="app-body">
        <ErrorBoundary label="Sidebar">
        <Sidebar
          channels={channels}
          users={users}
          currentChannelId={currentChannelId && currentChannelId !== 'server-root' ? Number(currentChannelId) : undefined}
          onJoinChannel={handleJoinChannel}
          onSelectChannel={handleSelectChannel}
          onSelectServer={handleSelectServer}
          isServerChatActive={currentChannelId === 'server-root'}
          serverLabel={serverLabel}
          serverAddress={serverAddress}
          username={username}
          onDisconnect={handleDisconnect}
          onStartDM={handleStartDMFromContextMenu}
          speakingUsers={speakingUsers}
          connectionStatus={connectionStatus}
          onCancelReconnect={handleCancelReconnect}
          pendingChannelAction={pendingChannelAction}
          channelUnreads={channelUnreads}
          sharingChannelId={sharingChannelId ? Number(sharingChannelId) : (activeShare?.roomName ? Number(activeShare.roomName.replace('channel-', '')) : undefined)}
          sharingUserSession={isSharing ? selfSession : activeShare?.sessionId}
          onWatchScreenShare={handleWatchScreenShare}
          onEditAvatar={connected ? () => setShowAvatarEditor(true) : undefined}
        />
        </ErrorBoundary>
        
        <main className="main-content">
          {connectionStatus === 'idle' ? (
            certExists === true ? (
              <ServerList onConnect={handleServerConnect} connectionError={connectionError} onClearError={() => setConnectionError(null)} activeProfileName={activeProfileName} />
            ) : (
              <div className="connection-state">
                <div className="connection-state-content">
                  <div className="connection-state-logo">
                    <BrmbleLogo size={192} heartbeat />
                  </div>
                  <p className="connection-state-subtext">Checking client certificate…</p>
                </div>
              </div>
            )
          ) : connectionStatus === 'connected' ? (
            showGame ? (
              <GameUI onClose={() => setShowGame(false)} />
            ) : (
              <div className={`content-slider ${dmStore.appMode === 'dm' ? 'dm-active' : ''}`}>
                <div className="content-slide">
                  <ErrorBoundary label="ChatPanel:Channel">
                   <ChatPanel
                    channelId={currentChannelId || undefined}
                    channelName={currentChannelId === 'server-root' ? (serverLabel || 'Server') : currentChannelName}
                    messages={[...(isMatrixActive ? (matrixMessages ?? []) : messages), ...optimisticImages.filter(m => m.channelId === currentChannelId)]}
                    currentUsername={username}
                    onSendMessage={handleSendMessage}
                    onDismissMessage={handleDismissMessage}
                    matrixClient={matrixClient.client}
                    matrixRoomId={channelMatrixRoomId}
                    readMarkerTs={channelDividerTs}
                    screenShareVideoEl={remoteVideoEl}
                    screenSharerName={activeShare?.userName}
                    onCloseScreenShare={disconnectViewer}
                    users={users}
                    onMessageContextMenu={handleChatMessageContextMenu}
                    onCopyToClipboard={handleCopyToClipboard}
                  />
                  </ErrorBoundary>
                </div>
                <div className="content-slide">
                  <ErrorBoundary label="ChatPanel:DM">
                   <ChatPanel
                    channelId={dmStore.selectedContact ? `dm-${dmStore.selectedContact.id}` : undefined}
                    channelName={dmStore.selectedContact?.displayName ?? ''}
                    messages={dmStore.messages}
                    currentUsername={username}
                    onSendMessage={dmStore.sendMessage}
                    isDM={true}
                    matrixClient={matrixClient.client}
                    matrixRoomId={dmMatrixRoomId}
                    readMarkerTs={dmDividerTs}
                    users={users}
                    disabled={dmStore.selectedContact?.isEphemeral === true && dmStore.selectedContact?.mumbleSessionId == null}
                    topNotice={dmStore.selectedContact?.isEphemeral ? 'This is a Mumble direct message. Chat history will be lost when you disconnect.' : undefined}
                    onMessageContextMenu={handleChatMessageContextMenu}
                    onCopyToClipboard={handleCopyToClipboard}
                  />
                  </ErrorBoundary>
                </div>
              </div>
            )
          ) : (
            <ConnectionState
              connectionStatus={connectionStatus}
              serverLabel={serverLabel}
              errorMessage={statuses.voice.error}
              onCancel={connectionStatus === 'connecting' || connectionStatus === 'reconnecting' ? handleCancelReconnect : undefined}
              onReconnect={connectionStatus === 'disconnected' ? handleReconnect : undefined}
              onBackToServerList={handleBackToServerList}
            />
          )}
        </main>

        <DMContactList
          contacts={dmContactsWithUnreads}
          selectedUserId={dmStore.selectedContact?.id ?? null}
          onSelectContact={(id: string, _name: string) => dmStore.selectContact(id)}
          onCloseConversation={dmStore.closeDM}
           onlineUserIds={users.filter(u => !u.self && u.matrixUserId).map(u => u.matrixUserId!)}
          visible={dmStore.appMode === 'dm'}
        />
      </div>

      {certExists === false && (
        <CertWizard onComplete={(fp) => { setCertExists(true); setCertFingerprint(fp); }} />
      )}

      <ConnectModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        onConnect={handleConnect}
      />

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        initialTab={settingsTab}
        username={username}
        connected={connected}
        currentUser={{ name: username || 'Unknown', matrixUserId: matrixCredentials?.userId, avatarUrl: currentUserAvatarUrl }}
        onUploadAvatar={onUploadAvatar}
        onRemoveAvatar={onRemoveAvatar}
        brmblegotchiEnabled={brmblegotchiEnabled}
        setBrmblegotchiEnabled={setBrmblegotchiEnabled}
      />

      <AvatarEditorModal
        isOpen={showAvatarEditor}
        onClose={() => setShowAvatarEditor(false)}
        currentUser={{
          name: username ?? 'Unknown',
          matrixUserId: matrixCredentials?.userId,
          avatarUrl: currentUserAvatarUrl,
        }}
        comment={users.find(u => u.self)?.comment}
        onSetComment={(comment) => bridge.send('voice.setComment', { comment })}
        onUploadAvatar={onUploadAvatar}
        onRemoveAvatar={onRemoveAvatar}
      />

      <CloseDialog
        isOpen={showCloseDialog}
        onMinimize={handleCloseMinimize}
        onQuit={handleCloseQuit}
      />

      <Prompt />
      <PromptWithInput />

      {updateInfo && (
        <UpdateNotification
          version={updateInfo.version}
          onUpdate={handleApplyUpdate}
          onDismiss={handleDismissUpdate}
          progress={updateProgress}
        />
      )}

      {screenShareToast && (
        <Toast
          message={`${screenShareToast.userName} started sharing their screen`}
          actions={[
            { label: 'Dismiss', onClick: () => setScreenShareToast(null) },
            { label: 'Watch', onClick: () => {
              connectAsViewer(screenShareToast.roomName);
              setScreenShareToast(null);
            }, primary: true },
          ]}
          onDismiss={handleDismissToast}
        />
      )}

      {copyToast && (
        <Toast
          message={copyToast.message}
          onDismiss={() => setCopyToast(null)}
        />
      )}

      <ZoomIndicator />
      <Version />
      <Brmblegotchi enabled={brmblegotchiEnabled} onOpenSettings={() => { setSettingsTab('appearance'); setShowSettings(true); }} />
      </ProfileProvider>
    </div>
  );
}

export default App;
