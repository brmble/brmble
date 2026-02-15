import { useState, useEffect } from 'react'
import bridge from './bridge'
import { ChannelTree } from './components/ChannelTree';
import './App.css'

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
  self?: boolean;
  muted?: boolean;
  deafened?: boolean;
}

function App() {
  const [messages, setMessages] = useState<string[]>([])
  const [connected, setConnected] = useState<boolean>(false)
  const [connecting, setConnecting] = useState<boolean>(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [currentChannelId, setCurrentChannelId] = useState<number | undefined>();
  
  const [host, setHost] = useState<string>('mumble.hashbang.dk')
  const [port, setPort] = useState<number>(64738)
  const [username, setUsername] = useState<string>('TestUser')
  const [password, setPassword] = useState<string>('')

  useEffect(() => {
    const saved = localStorage.getItem('brmble-server');
    if (saved) {
      try {
        const data: SavedServer = JSON.parse(saved);
        setHost(data.host);
        setPort(data.port);
        setUsername(data.username);
        setPassword(data.password);
      } catch (e) {
        console.error('Failed to load saved server:', e);
      }
    }
  }, []);

  useEffect(() => {
    const onVoiceConnected = ((data: unknown) => {
      setConnected(true);
      setConnecting(false);
      const d = data as { username?: string; channels?: Channel[]; users?: User[] } | undefined;
      
      if (d?.channels) {
        setChannels(d.channels);
      }
      if (d?.users) {
        setUsers(d.users);
      }
      
      setMessages(prev => [...prev, `Connected to ${d?.username || 'server'}`]);
    });

    const onVoiceDisconnected = () => {
      setConnected(false);
      setConnecting(false);
      setChannels([]);
      setUsers([]);
      setMessages(prev => [...prev, 'Disconnected']);
    };

    const onVoiceError = ((data: unknown) => {
      setConnecting(false);
      const d = data as { message: string } | undefined;
      setMessages(prev => [...prev, `Error: ${d?.message || 'Unknown error'}`]);
    });

    const onVoiceMessage = ((data: unknown) => {
      const d = data as { message: string; senderSession?: number } | undefined;
      if (d?.message) {
        setMessages(prev => [...prev, `Chat: ${d.message}`]);
      }
    });

    const onVoiceUserJoined = ((data: unknown) => {
      const d = data as { session: number; name: string; channelId?: number; muted?: boolean; deafened?: boolean; self?: boolean } | undefined;
      if (d?.session && d?.name) {
        setUsers(prev => {
          const existing = prev.find(u => u.session === d.session);
          if (existing) {
            // Only update channelId if it's a valid (non-zero) value
            const updatedChannelId = d.channelId && d.channelId > 0 ? d.channelId : existing.channelId;
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
      const d = data as { channelId: number } | undefined;
      if (d?.channelId) {
        setCurrentChannelId(d.channelId);
        setMessages(prev => [...prev, `Joined channel`]);
      }
    });

    const onVoiceUserLeft = ((data: unknown) => {
      const d = data as { session: number } | undefined;
      if (d?.session) {
        setUsers(prev => prev.filter(u => u.session !== d.session));
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

    return () => {
      bridge.off('voice.connected', onVoiceConnected);
      bridge.off('voice.disconnected', onVoiceDisconnected);
      bridge.off('voice.error', onVoiceError);
      bridge.off('voice.message', onVoiceMessage);
      bridge.off('voice.userJoined', onVoiceUserJoined);
      bridge.off('voice.channelJoined', onVoiceChannelJoined);
      bridge.off('voice.userLeft', onVoiceUserLeft);
      bridge.off('voice.channelChanged', onVoiceChannelChanged);
    };
  }, []);

  const handleConnect = () => {
    const serverData = { host, port, username, password };
    localStorage.setItem('brmble-server', JSON.stringify(serverData));
    
    setConnecting(true);
    setMessages(prev => [...prev, `Connecting to ${host}:${port}...`]);
    bridge.send('voice.connect', serverData);
  };

  const handleDisconnect = () => {
    bridge.send('voice.disconnect');
  };

  const handleJoinChannel = (channelId: number) => {
    bridge.send('voice.joinChannel', { channelId });
    setMessages(prev => [...prev, `Joining channel ${channelId}...`]);
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Brmble</h1>
        <span className={`platform-badge ${connected ? 'connected' : ''}`}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </header>
      
      <main className="main">
        <div className="main-left">
          <section className="connect-form">
            <h2>Connect to Mumble</h2>
            <div className="form-row">
              <label>
                Server
                <input 
                  type="text" 
                  value={host} 
                  onChange={e => setHost(e.target.value)}
                  disabled={connected || connecting}
                />
              </label>
              <label>
                Port
                <input 
                  type="number" 
                  value={port} 
                  onChange={e => setPort(parseInt(e.target.value) || 64738)}
                  disabled={connected || connecting}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Username
                <input 
                  type="text" 
                  value={username} 
                  onChange={e => setUsername(e.target.value)}
                  disabled={connected || connecting}
                />
              </label>
              <label>
                Password
                <input 
                  type="password" 
                  value={password} 
                  onChange={e => setPassword(e.target.value)}
                  disabled={connected || connecting}
                />
              </label>
            </div>
            <div className="form-actions">
              {!connected ? (
                <button onClick={handleConnect} disabled={connecting || !host || !username}>
                  {connecting ? 'Connecting...' : 'Connect'}
                </button>
              ) : (
                <button onClick={handleDisconnect} className="disconnect">
                  Disconnect
                </button>
              )}
            </div>
          </section>

          <section className="messages">
            <h2>Messages</h2>
            <div className="message-list">
              {messages.length === 0 ? (
                <p className="empty">No messages yet</p>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className="message">{msg}</div>
                ))
              )}
            </div>
          </section>
        </div>

        {connected && (
          <section className="server-panel">
            <div className="channels">
              <div className="panel-header">
                <h2>Channels</h2>
              </div>
              <div className="channel-list">
                {channels.length === 0 ? (
                  <p className="empty">No channels</p>
                ) : (
                  <ChannelTree
                    channels={channels}
                    users={users}
                    currentChannelId={currentChannelId}
                    onJoinChannel={handleJoinChannel}
                  />
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
