import { useState, useEffect } from 'react';
import bridge from './bridge';
import { Header } from './components/Header/Header';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { ConnectModal } from './components/ConnectModal/ConnectModal';
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

interface Server {
  id: string;
  name: string;
  host?: string;
  port?: number;
}

function App() {
  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState('');
  const [serverAddress, setServerAddress] = useState('');
  const [servers] = useState<Server[]>([
    { id: '1', name: 'Mumble Server' }
  ]);
  const [selectedServerId, setSelectedServerId] = useState('1');
  
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentChannelId, setCurrentChannelId] = useState<number | undefined>();
  const [currentChannelName, setCurrentChannelName] = useState<string>('');
  const [selfMuted, setSelfMuted] = useState(false);
  const [selfDeafened, setSelfDeafened] = useState(false);

  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showDMPanel, setShowDMPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const channelKey = currentChannelId ? `channel-${currentChannelId}` : 'no-channel';
  const { messages, addMessage } = useChatStore(channelKey);

  useEffect(() => {
    const saved = localStorage.getItem('brmble-server');
    if (saved) {
      try {
        const data: SavedServer = JSON.parse(saved);
        setUsername(data.username);
        handleConnect(data);
      } catch (e) {
        console.error('Failed to load saved server:', e);
      }
    }
  }, []);

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
        const senderUser = users.find(u => u.session === d.senderSession);
        const senderName = senderUser?.name || 'Unknown';
        addMessage(senderName, d.message);
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
          const channel = channels.find(c => c.id === d.channelId);
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
  }, [addMessage, channels, users]);

  const handleConnect = (serverData: SavedServer) => {
    localStorage.setItem('brmble-server', JSON.stringify(serverData));
    setServerAddress(`${serverData.host}:${serverData.port}`);
    bridge.send('voice.connect', serverData);
  };

  const handleJoinChannel = (channelId: number) => {
    bridge.send('voice.joinChannel', { channelId });
  };

  const handleSelectChannel = (channelId: number) => {
    const channel = channels.find(c => c.id === channelId);
    if (channel) {
      setCurrentChannelId(channelId);
      setCurrentChannelName(channel.name);
    }
  };

  const handleSendMessage = (content: string) => {
    if (username && content) {
      addMessage(username, content);
      bridge.send('voice.sendMessage', { message: content });
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
          servers={servers}
          selectedServerId={selectedServerId}
          onSelectServer={setSelectedServerId}
          channels={channels}
          users={users}
          currentChannelId={currentChannelId}
          onJoinChannel={handleJoinChannel}
          onSelectChannel={handleSelectChannel}
          connected={connected}
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
          <button className="connect-overlay-btn" onClick={() => setShowConnectModal(true)}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            Connect to Server
          </button>
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
