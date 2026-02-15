import { useState, useEffect } from 'react'
import bridge from './bridge'
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
}

function App() {
  const [messages, setMessages] = useState<string[]>([])
  const [connected, setConnected] = useState<boolean>(false)
  const [connecting, setConnecting] = useState<boolean>(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [users, setUsers] = useState<User[]>([])
  
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
    const onMumbleConnected = ((data: unknown) => {
      setConnected(true);
      setConnecting(false);
      setMessages(prev => [...prev, `Connected to ${(data as { host?: string })?.host || 'server'}`]);
    });

    const onMumbleDisconnected = () => {
      setConnected(false);
      setConnecting(false);
      setChannels([]);
      setUsers([]);
      setMessages(prev => [...prev, 'Disconnected']);
    };

    const onMumbleError = ((data: unknown) => {
      setConnecting(false);
      const d = data as { message: string } | undefined;
      setMessages(prev => [...prev, `Error: ${d?.message || 'Unknown error'}`]);
    });

    const onMumbleMessage = ((data: unknown) => {
      const d = data as { message: string; senderSession?: number } | undefined;
      if (d?.message) {
        setMessages(prev => [...prev, `Chat: ${d.message}`]);
      }
    });

    const onMumbleUser = ((data: unknown) => {
      const d = data as { session: number; name: string; channelId?: number; self?: boolean } | undefined;
      if (d?.session && d?.name) {
        setUsers(prev => {
          const existing = prev.find(u => u.session === d.session);
          if (existing) {
            return prev.map(u => u.session === d.session ? d : u);
          }
          return [...prev, d];
        });
      }
    });

    const onMumbleChannel = ((data: unknown) => {
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

    bridge.on('mumbleConnected', onMumbleConnected);
    bridge.on('mumbleDisconnected', onMumbleDisconnected);
    bridge.on('mumbleError', onMumbleError);
    bridge.on('mumbleMessage', onMumbleMessage);
    bridge.on('mumbleUser', onMumbleUser);
    bridge.on('mumbleChannel', onMumbleChannel);

    return () => {
      bridge.off('mumbleConnected', onMumbleConnected);
      bridge.off('mumbleDisconnected', onMumbleDisconnected);
      bridge.off('mumbleError', onMumbleError);
      bridge.off('mumbleMessage', onMumbleMessage);
      bridge.off('mumbleUser', onMumbleUser);
      bridge.off('mumbleChannel', onMumbleChannel);
    };
  }, []);

  const handleConnect = () => {
    const serverData = { host, port, username, password };
    localStorage.setItem('brmble-server', JSON.stringify(serverData));
    
    setConnecting(true);
    setMessages(prev => [...prev, `Connecting to ${host}:${port}...`]);
    bridge.send('mumbleConnect', serverData);
  };

  const handleDisconnect = () => {
    bridge.send('mumbleDisconnect');
  };

  const handleJoinChannel = (channelId: number) => {
    bridge.send('mumbleJoinChannel', { channelId });
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

        {connected && (
          <section className="server-panel">
            <div className="channels">
              <h2>Channels</h2>
              <div className="channel-list">
                {channels.length === 0 ? (
                  <p className="empty">No channels</p>
                ) : (
                  channels.map(channel => (
                    <div 
                      key={channel.id} 
                      className="channel"
                      onDoubleClick={() => handleJoinChannel(channel.id)}
                      title="Double-click to join"
                    >
                      📁 {channel.name}
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="users">
              <h2>Users ({users.length})</h2>
              <div className="user-list">
                {users.length === 0 ? (
                  <p className="empty">No users</p>
                ) : (
                  users.map(user => (
                    <div key={user.session} className={`user ${user.self ? 'self' : ''}`}>
                      🎤 {user.name}
                    </div>
                  ))
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
