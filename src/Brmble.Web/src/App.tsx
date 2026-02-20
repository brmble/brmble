import { useState, useEffect, useRef, useCallback } from 'react';
import bridge from './bridge';
import { Header } from './components/Header/Header';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { ConnectModal } from './components/ConnectModal/ConnectModal';
import { ServerList } from './components/ServerList/ServerList';
import type { ServerEntry } from './hooks/useServerlist';
import { SettingsModal } from './components/SettingsModal/SettingsModal';
import { CloseDialog } from './components/CloseDialog/CloseDialog';
import { CertWizard } from './components/CertWizard/CertWizard';
import { useChatStore, addMessageToStore, loadDMContacts, upsertDMContact, markDMContactRead } from './hooks/useChatStore';
import type { StoredDMContact } from './hooks/useChatStore';
import { DMContactList } from './components/DMContactList/DMContactList';
import './App.css';

interface SavedServer {
  host: string;
  port: number;
  username: string;
  password: string;
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
}


const mapStoredContacts = (contacts: StoredDMContact[]) =>
  contacts.map(c => ({
    userId: c.userId,
    userName: c.userName,
    lastMessage: c.lastMessage,
    lastMessageTime: c.lastMessageTime ? new Date(c.lastMessageTime) : undefined,
    unread: c.unread,
  }));

function App() {
  // null = status not yet received, false = no cert, true = cert exists
  const [certExists, setCertExists] = useState<boolean | null>(null);
  const [certFingerprint, setCertFingerprint] = useState('');

  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState('');
  const [serverAddress, setServerAddress] = useState('');
  const [serverLabel, setServerLabel] = useState('');
  
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentChannelId, setCurrentChannelId] = useState<string | undefined>();
  const [currentChannelName, setCurrentChannelName] = useState<string>('');
  const [selfMuted, setSelfMuted] = useState(false);
  const [selfDeafened, setSelfDeafened] = useState(false);
  const [selfLeftVoice, setSelfLeftVoice] = useState(false);
  const [selfSession, setSelfSession] = useState<number>(0);
  const [speakingUsers, setSpeakingUsers] = useState<Map<number, boolean>>(new Map());

  const [showConnectModal, setShowConnectModal] = useState(false);
  const [dmContacts, setDmContacts] = useState(() => mapStoredContacts(loadDMContacts()));
  const [appMode, setAppMode] = useState<'channels' | 'dm'>('channels');
  const [selectedDMUserId, setSelectedDMUserId] = useState<string | null>(null);
  const [selectedDMUserName, setSelectedDMUserName] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasPendingInvite] = useState(false);

  const channelKey = currentChannelId === 'server-root' ? 'server-root' : currentChannelId ? `channel-${currentChannelId}` : 'no-channel';
  const { messages, addMessage } = useChatStore(channelKey);

  const dmKey = selectedDMUserId ? `dm-${selectedDMUserId}` : 'no-dm';
  const { messages: dmMessages, addMessage: addDMMessage } = useChatStore(dmKey);

  const updateBadge = (unread: number, invite: boolean) => {
    bridge.send('notification.badge', { unreadDMs: unread > 0, pendingInvite: invite });
  };

  // Refs to avoid re-registering bridge handlers on every state change
  const usersRef = useRef(users);
  usersRef.current = users;
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
  const selectedDMUserIdRef = useRef(selectedDMUserId);
  selectedDMUserIdRef.current = selectedDMUserId;
  const appModeRef = useRef(appMode);
  appModeRef.current = appMode;
  const addDMMessageRef = useRef(addDMMessage);
  addDMMessageRef.current = addDMMessage;

  // Register all bridge handlers once on mount
  useEffect(() => {
    const onVoiceConnected = ((data: unknown) => {
      setConnected(true);
      setCurrentChannelId('server-root');
      setCurrentChannelName('');
      const d = data as { username?: string; channels?: Channel[]; users?: User[] } | undefined;
      
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
      }
    });

    const onVoiceDisconnected = () => {
      setConnected(false);
      setServerAddress('');
      setServerLabel('');
      setChannels([]);
      setUsers([]);
      setCurrentChannelId(undefined);
      setCurrentChannelName('');
      setSelfMuted(false);
      setSelfDeafened(false);
      setSelfLeftVoice(false);
      setSelfSession(0);
      setSpeakingUsers(new Map());
    };

    const onVoiceError = ((data: unknown) => {
      const d = data as { message: string } | undefined;
      console.error('Voice error:', d?.message);
    });

    const onVoiceMessage = ((data: unknown) => {
      const d = data as {
        message: string;
        senderSession?: number;
        channelIds?: number[];
        sessions?: number[];
      } | undefined;
      if (!d?.message) return;

      const selfUser = usersRef.current.find(u => u.self);
      if (selfUser && d.senderSession === selfUser.session) return; // self-echo check (once)
      if (d.senderSession === undefined) return; // guard against undefined

      const senderUser = usersRef.current.find(u => u.session === d.senderSession);
      const senderName = senderUser?.name || 'Unknown';

      // Detect private message: has sessions, no channelIds
      const isPrivateMessage = d.sessions && d.sessions.length > 0 &&
        (!d.channelIds || d.channelIds.length === 0);

      if (isPrivateMessage) {
        const senderSession = String(d.senderSession);
        const dmStoreKey = `dm-${senderSession}`;

        // Check if user is currently viewing this DM conversation
        const isViewingThisDM = appModeRef.current === 'dm' &&
          selectedDMUserIdRef.current === senderSession;

        if (isViewingThisDM) {
          // Add via React state so it appears immediately
          addDMMessageRef.current(senderName, d.message);
        } else {
          // Write to localStorage in the background
          addMessageToStore(dmStoreKey, senderName, d.message);
        }

        // Update DM contacts: upsert with lastMessage and increment unread
        // (only increment if not currently viewing this DM)
        const updated = upsertDMContact(senderSession, senderName, d.message, !isViewingThisDM);
        setDmContacts(mapStoredContacts(updated));
        return;
      }

      // Channel message (existing logic)
      const isRootMessage = !d.channelIds || d.channelIds.length === 0 || d.channelIds.includes(0);
      const targetKey = isRootMessage ? 'server-root' : `channel-${d.channelIds![0]}`;
      const currentKey = currentChannelIdRef.current;
      const currentStoreKey = currentKey === 'server-root' ? 'server-root' : currentKey ? `channel-${currentKey}` : 'no-channel';
      if (targetKey === currentStoreKey) {
        addMessageRef.current(senderName, d.message);
      } else {
        addMessageToStore(targetKey, senderName, d.message);
      }
      const newUnread = unreadCountRef.current + 1;
      setUnreadCount(newUnread);
      updateBadge(newUnread, hasPendingInviteRef.current);
    });

    const onVoiceSystem = ((data: unknown) => {
      const d = data as { message: string; systemType?: string; html?: boolean } | undefined;
      if (d?.message) {
        const currentKey = currentChannelIdRef.current;
        if (currentKey === 'server-root') {
          addMessageRef.current('Server', d.message, 'system', d.html);
        } else {
          addMessageToStore('server-root', 'Server', d.message, 'system', d.html);
        }
      }
    });

    const onVoiceUserJoined = ((data: unknown) => {
      const d = data as { session: number; name: string; channelId?: number; muted?: boolean; deafened?: boolean; self?: boolean } | undefined;
      if (d?.session && d?.name && d.channelId !== undefined) {
        setUsers(prev => {
          const existing = prev.find(u => u.session === d.session);
          if (existing) {
            const updatedChannelId = d.channelId !== undefined ? d.channelId : existing.channelId;
            return prev.map(u => u.session === d.session ? { ...u, ...d, channelId: updatedChannelId } : u);
          }
          return [...prev, d];
        });
      }
    });

    const onVoiceChannelJoined = ((data: unknown) => {
      const d = data as { id: number; name: string; parent?: number } | undefined;
      if (d?.id !== undefined && d?.name) {
        setChannels(prev => {
          const existing = prev.find(c => c.id === d.id);
          if (existing) {
            return prev.map(c => c.id === d.id ? d : c);
          }
          return [...prev, d];
        });
      }
    });

    const onVoiceChannelChanged = ((data: unknown) => {
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
      const d = data as { session: number } | undefined;
      if (d?.session) {
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
      const d = data as { leftVoice: boolean } | undefined;
      if (d?.leftVoice !== undefined) {
        setSelfLeftVoice(d.leftVoice);
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

    const onShowCloseDialog = () => {
      setShowCloseDialog(true);
    };

    const onCertStatus = (data: unknown) => {
      const d = data as { exists: boolean; fingerprint?: string } | undefined;
      if (d?.exists) {
        setCertExists(true);
        setCertFingerprint(d.fingerprint ?? '');
      } else {
        setCertExists(false);
      }
    };
    const onCertGenerated = (data: unknown) => {
      const d = data as { fingerprint?: string } | undefined;
      setCertExists(true);
      setCertFingerprint(d?.fingerprint ?? '');
    };
    const onCertImported = (data: unknown) => {
      const d = data as { fingerprint?: string } | undefined;
      setCertExists(true);
      setCertFingerprint(d?.fingerprint ?? '');
    };

    bridge.on('voice.connected', onVoiceConnected);
    bridge.on('voice.disconnected', onVoiceDisconnected);
    bridge.on('voice.error', onVoiceError);
    bridge.on('voice.message', onVoiceMessage);
    bridge.on('voice.system', onVoiceSystem);
    bridge.on('voice.userJoined', onVoiceUserJoined);
    bridge.on('voice.channelJoined', onVoiceChannelJoined);
    bridge.on('voice.userLeft', onVoiceUserLeft);
    bridge.on('voice.channelChanged', onVoiceChannelChanged);
    bridge.on('voice.selfMuteChanged', onSelfMuteChanged);
    bridge.on('voice.selfDeafChanged', onSelfDeafChanged);
    bridge.on('voice.leftVoiceChanged', onLeftVoiceChanged);
    bridge.on('voice.userSpeaking', onVoiceUserSpeaking);
    bridge.on('voice.userSilent', onVoiceUserSilent);
    bridge.on('window.showCloseDialog', onShowCloseDialog);
    bridge.on('cert.status', onCertStatus);
    bridge.on('cert.generated', onCertGenerated);
    bridge.on('cert.imported', onCertImported);

    return () => {
      bridge.off('voice.connected', onVoiceConnected);
      bridge.off('voice.disconnected', onVoiceDisconnected);
      bridge.off('voice.error', onVoiceError);
      bridge.off('voice.message', onVoiceMessage);
      bridge.off('voice.system', onVoiceSystem);
      bridge.off('voice.userJoined', onVoiceUserJoined);
      bridge.off('voice.channelJoined', onVoiceChannelJoined);
      bridge.off('voice.userLeft', onVoiceUserLeft);
      bridge.off('voice.channelChanged', onVoiceChannelChanged);
      bridge.off('voice.selfMuteChanged', onSelfMuteChanged);
      bridge.off('voice.selfDeafChanged', onSelfDeafChanged);
      bridge.off('voice.leftVoiceChanged', onLeftVoiceChanged);
      bridge.off('voice.userSpeaking', onVoiceUserSpeaking);
      bridge.off('voice.userSilent', onVoiceUserSilent);
      bridge.off('window.showCloseDialog', onShowCloseDialog);
      bridge.off('cert.status', onCertStatus);
      bridge.off('cert.generated', onCertGenerated);
      bridge.off('cert.imported', onCertImported);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bridge.send('cert.requestStatus');
  }, []);

const handleConnect = (serverData: SavedServer) => {
    localStorage.setItem('brmble-server', JSON.stringify(serverData));
    setServerAddress(`${serverData.host}:${serverData.port}`);
    bridge.send('voice.connect', serverData);
  };

  const handleServerConnect = (server: ServerEntry) => {
    setServerLabel(server.label || `${server.host}:${server.port}`);
    handleConnect({
      host: server.host, 
      port: server.port, 
      username: server.username, 
      password: '' 
    });
  };

  const handleJoinChannel = (channelId: number) => {
    bridge.send('voice.joinChannel', { channelId });
  };

  const handleSelectChannel = (channelId: number) => {
    const channel = channels.find(c => c.id === channelId);
    if (channel) {
      setCurrentChannelId(String(channelId));
      setCurrentChannelName(channel.name);
      setUnreadCount(0);
      updateBadge(0, hasPendingInvite);
    }
  };

  const handleSelectServer = () => {
    setCurrentChannelId('server-root');
    setCurrentChannelName(serverLabel || 'Server');
  };

  const handleSendMessage = (content: string) => {
    if (username && content) {
      addMessage(username, content);
      if (currentChannelId === 'server-root') {
        bridge.send('voice.sendMessage', { message: content, channelId: 0 });
      } else if (currentChannelId) {
        bridge.send('voice.sendMessage', { message: content, channelId: Number(currentChannelId) });
      }
      setUnreadCount(0);
      updateBadge(0, hasPendingInvite);
    }
  };

  const handleSendDMMessage = (content: string) => {
    if (username && content && selectedDMUserId) {
      addDMMessage(username, content);
      bridge.send('voice.sendPrivateMessage', {
        message: content,
        targetSession: Number(selectedDMUserId),
      });
      const updated = upsertDMContact(selectedDMUserId, selectedDMUserName, content);
      setDmContacts(mapStoredContacts(updated));
    }
  };

  const handleDisconnect = () => {
    bridge.send('voice.disconnect');
  };

  const handleToggleMute = () => {
    bridge.send('voice.toggleMute', {});
  };

  const handleToggleDeaf = () => {
    bridge.send('voice.toggleDeaf', {});
  };

  const handleLeaveVoice = () => {
    bridge.send('voice.leaveVoice', {});
    if (!selfLeftVoice) {
      handleSelectServer();
    }
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
    setAppMode(prev => prev === 'channels' ? 'dm' : 'channels');
  };

  const unreadDMUserCount = dmContacts.filter(c => c.unread > 0).length;

  const handleSelectDMUser = (userId: string, userName: string) => {
    setSelectedDMUserId(userId);
    setSelectedDMUserName(userName);
    setAppMode('dm');
    // Mark this contact as read, then upsert to ensure contact exists
    markDMContactRead(userId);
    const updated = upsertDMContact(userId, userName);
    setDmContacts(mapStoredContacts(updated));
  };

  const availableUsers = users
    .filter(u => !u.self)
    .map(u => ({ id: String(u.session), name: u.name }));

  // Suppress unused warnings — these are wired up in subsequent DM tasks
  void availableUsers;

  return (
    <div className="app">
      <Header
        username={username}
        onToggleDM={toggleDMMode}
        dmActive={appMode === 'dm'}
        unreadDMCount={unreadDMUserCount}
        onOpenSettings={() => setShowSettings(true)}
        muted={selfMuted}
        deafened={selfDeafened}
        leftVoice={selfLeftVoice}
        onToggleMute={connected ? handleToggleMute : undefined}
        onToggleDeaf={connected ? handleToggleDeaf : undefined}
        onLeaveVoice={connected ? handleLeaveVoice : undefined}
        speaking={speakingUsers.has(selfSession) || false}
      />
      
      <div className="app-body">
        <Sidebar
          channels={channels}
          users={users}
          currentChannelId={currentChannelId && currentChannelId !== 'server-root' ? Number(currentChannelId) : undefined}
          onJoinChannel={handleJoinChannel}
          onSelectChannel={handleSelectChannel}
          onSelectServer={handleSelectServer}
          isServerChatActive={currentChannelId === 'server-root'}
          connected={connected}
          serverLabel={serverLabel}
          serverAddress={serverAddress}
          username={username}
          onDisconnect={handleDisconnect}
          onStartDM={handleSelectDMUser}
          speakingUsers={speakingUsers}
        />
        
        <main className="main-content">
          <div className={`content-slider ${appMode === 'dm' ? 'dm-active' : ''}`}>
            <div className="content-slide">
              <ChatPanel
                channelId={currentChannelId || undefined}
                channelName={currentChannelId === 'server-root' ? (serverLabel || 'Server') : currentChannelName}
                messages={messages}
                currentUsername={username}
                onSendMessage={handleSendMessage}
              />
            </div>
            <div className="content-slide">
              <ChatPanel
                channelId={selectedDMUserId ? `dm-${selectedDMUserId}` : undefined}
                channelName={selectedDMUserName}
                messages={dmMessages}
                currentUsername={username}
                onSendMessage={handleSendDMMessage}
                isDM={true}
              />
            </div>
          </div>
        </main>

        <DMContactList
          contacts={dmContacts}
          selectedUserId={selectedDMUserId}
          onSelectContact={handleSelectDMUser}
          visible={appMode === 'dm'}
        />
      </div>

      {certExists === false && (
        <CertWizard onComplete={(fp) => { setCertExists(true); setCertFingerprint(fp); }} />
      )}

      {certExists === true && !connected && (
        <div className="connect-overlay">
          <ServerList onConnect={handleServerConnect} />
        </div>
      )}

      <ConnectModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        onConnect={handleConnect}
      />

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        username={username}
        certFingerprint={certFingerprint}
      />

      <CloseDialog
        isOpen={showCloseDialog}
        onMinimize={handleCloseMinimize}
        onQuit={handleCloseQuit}
      />
    </div>
  );
}

export default App;
