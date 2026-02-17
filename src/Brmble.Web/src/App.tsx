import { useState, useEffect, useRef } from 'react';
import bridge from './bridge';
import { Header } from './components/Header/Header';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { ConnectModal } from './components/ConnectModal/ConnectModal';
import { ServerList } from './components/ServerList/ServerList';
import type { ServerEntry } from './hooks/useServerlist';
import { DMPanel } from './components/DMPanel/DMPanel';
import { SettingsModal } from './components/SettingsModal/SettingsModal';
import { useChatStore } from './hooks/useChatStore';
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


function App() {
  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState('');
  const [serverAddress, setServerAddress] = useState('');
  const [serverLabel, setServerLabel] = useState('');
  
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentChannelId, setCurrentChannelId] = useState<number | undefined>();
  const [currentChannelName, setCurrentChannelName] = useState<string>('');
  const [selfMuted, setSelfMuted] = useState(false);
  const [selfDeafened, setSelfDeafened] = useState(false);

  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showDMPanel, setShowDMPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasPendingInvite] = useState(false);

  const channelKey = currentChannelId ? `channel-${currentChannelId}` : 'no-channel';
  const { messages, addMessage } = useChatStore(channelKey);

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
  const unreadCountRef = useRef(unreadCount);
  unreadCountRef.current = unreadCount;
  const hasPendingInviteRef = useRef(hasPendingInvite);
  hasPendingInviteRef.current = hasPendingInvite;

  // Register all bridge handlers once on mount
  useEffect(() => {
    const onVoiceConnected = ((data: unknown) => {
      setConnected(true);
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
    };

    const onVoiceError = ((data: unknown) => {
      const d = data as { message: string } | undefined;
      console.error('Voice error:', d?.message);
    });

    const onVoiceMessage = ((data: unknown) => {
      const d = data as { message: string; senderSession?: number } | undefined;
      if (d?.message) {
        const senderUser = usersRef.current.find(u => u.session === d.senderSession);
        const senderName = senderUser?.name || 'Unknown';
        addMessageRef.current(senderName, d.message);
        const newUnread = unreadCountRef.current + 1;
        setUnreadCount(newUnread);
        updateBadge(newUnread, hasPendingInviteRef.current);
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
      if (d?.id && d?.name) {
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
      if (d?.channelId) {
        setCurrentChannelId(d.channelId);
        if (d.name) {
          setCurrentChannelName(d.name);
        } else {
          const channel = channelsRef.current.find(c => c.id === d.channelId);
          setCurrentChannelName(channel?.name || '');
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

    bridge.on('voice.connected', onVoiceConnected);
    bridge.on('voice.disconnected', onVoiceDisconnected);
    bridge.on('voice.error', onVoiceError);
    bridge.on('voice.message', onVoiceMessage);
    bridge.on('voice.userJoined', onVoiceUserJoined);
    bridge.on('voice.channelJoined', onVoiceChannelJoined);
    bridge.on('voice.userLeft', onVoiceUserLeft);
    bridge.on('voice.channelChanged', onVoiceChannelChanged);
    bridge.on('voice.selfMuteChanged', onSelfMuteChanged);
    bridge.on('voice.selfDeafChanged', onSelfDeafChanged);

    return () => {
      bridge.off('voice.connected', onVoiceConnected);
      bridge.off('voice.disconnected', onVoiceDisconnected);
      bridge.off('voice.error', onVoiceError);
      bridge.off('voice.message', onVoiceMessage);
      bridge.off('voice.userJoined', onVoiceUserJoined);
      bridge.off('voice.channelJoined', onVoiceChannelJoined);
      bridge.off('voice.userLeft', onVoiceUserLeft);
      bridge.off('voice.channelChanged', onVoiceChannelChanged);
      bridge.off('voice.selfMuteChanged', onSelfMuteChanged);
      bridge.off('voice.selfDeafChanged', onSelfDeafChanged);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setCurrentChannelId(channelId);
      setCurrentChannelName(channel.name);
      setUnreadCount(0);
      updateBadge(0, hasPendingInvite);
    }
  };

  const handleSendMessage = (content: string) => {
    if (username && content) {
      addMessage(username, content);
      bridge.send('voice.sendMessage', { message: content });
      setUnreadCount(0);
      updateBadge(0, hasPendingInvite);
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

  const handleStartDM = (userId: string) => {
    console.log('Starting DM with user:', userId);
    setShowDMPanel(false);
  };

  const availableUsers = users
    .filter(u => !u.self)
    .map(u => ({ id: String(u.session), name: u.name }));

  return (
    <div className="app">
      <Header
        username={username}
        onOpenDMPanel={() => setShowDMPanel(true)}
        onOpenSettings={() => setShowSettings(true)}
        muted={selfMuted}
        deafened={selfDeafened}
        onToggleMute={connected ? handleToggleMute : undefined}
        onToggleDeaf={connected ? handleToggleDeaf : undefined}
      />
      
      <div className="app-body">
        <Sidebar
          channels={channels}
          users={users}
          currentChannelId={currentChannelId}
          onJoinChannel={handleJoinChannel}
          onSelectChannel={handleSelectChannel}
          connected={connected}
          serverLabel={serverLabel}
          serverAddress={serverAddress}
          username={username}
          onDisconnect={handleDisconnect}
        />
        
        <main className="main-content">
          <ChatPanel
            channelId={currentChannelId ? String(currentChannelId) : undefined}
            channelName={currentChannelName}
            messages={messages}
            currentUsername={username}
            onSendMessage={handleSendMessage}
          />
        </main>
      </div>

      {!connected && (
        <div className="connect-overlay">
          <ServerList onConnect={handleServerConnect} />
        </div>
      )}

      <ConnectModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        onConnect={handleConnect}
      />

      <DMPanel
        isOpen={showDMPanel}
        onClose={() => setShowDMPanel(false)}
        users={availableUsers}
        conversations={[]}
        onStartDM={handleStartDM}
      />

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        username={username}
      />
    </div>
  );
}

export default App;
