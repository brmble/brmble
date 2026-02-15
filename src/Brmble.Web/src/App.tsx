import { useState, useEffect } from 'react'
import bridge from './bridge'
import './App.css'

interface SavedServer {
  host: string;
  port: number;
  username: string;
  password: string;
}

function App() {
  const [platform, setPlatform] = useState<string>('unknown')
  const [messages, setMessages] = useState<string[]>([])
  const [connected, setConnected] = useState<boolean>(false)
  const [connecting, setConnecting] = useState<boolean>(false)
  
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
    const onPong = () => {
      setMessages(prev => [...prev, 'C#: pong']);
    };

    const onPlatform = ((data: unknown) => {
      const d = data as { platform: string } | undefined;
      if (d?.platform) {
        setPlatform(d.platform);
        setMessages(prev => [...prev, `C#: platform = ${d.platform}`]);
      }
    });

    const onMumbleConnected = ((data: unknown) => {
      setConnected(true);
      setConnecting(false);
      setMessages(prev => [...prev, `Connected to ${(data as { host?: string })?.host || 'server'}`]);
    });

    const onMumbleDisconnected = () => {
      setConnected(false);
      setConnecting(false);
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

    bridge.on('pong', onPong);
    bridge.on('platform', onPlatform);
    bridge.on('mumbleConnected', onMumbleConnected);
    bridge.on('mumbleDisconnected', onMumbleDisconnected);
    bridge.on('mumbleError', onMumbleError);
    bridge.on('mumbleMessage', onMumbleMessage);

    return () => {
      bridge.off('pong', onPong);
      bridge.off('platform', onPlatform);
      bridge.off('mumbleConnected', onMumbleConnected);
      bridge.off('mumbleDisconnected', onMumbleDisconnected);
      bridge.off('mumbleError', onMumbleError);
      bridge.off('mumbleMessage', onMumbleMessage);
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

  const sendPing = () => {
    bridge.send('ping');
  };

  const getPlatform = () => {
    bridge.send('getPlatform');
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Brmble</h1>
        <span className={`platform-badge ${connected ? 'connected' : ''}`}>
          {connected ? 'Connected' : platform}
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

        <section className="controls">
          <button onClick={sendPing}>Send Ping</button>
          <button onClick={getPlatform}>Get Platform</button>
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
      </main>
    </div>
  )
}

export default App
