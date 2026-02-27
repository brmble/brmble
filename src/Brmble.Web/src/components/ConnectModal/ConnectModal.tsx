import { useState } from 'react';
import './ConnectModal.css';

interface ConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (serverData: { host: string; port: number; username: string; password: string }) => void;
}

export function ConnectModal({ isOpen, onClose, onConnect }: ConnectModalProps) {
  const [host, setHost] = useState('mumble.hashbang.dk');
  const [port, setPort] = useState(64738);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConnect({ host, port, username, password });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="connect-modal glass-panel animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ pointerEvents: 'none' }}>
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        <div className="modal-header">
          <h2 className="modal-title">Connect to Server</h2>
          <p className="modal-subtitle">Enter your server details to join</p>
        </div>

        <form onSubmit={handleSubmit} className="connect-form">
          <div className="form-group">
            <label htmlFor="host">Server Address</label>
            <div className="input-row">
              <input
                id="host"
                className="brmble-input"
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="mumble.example.com"
                required
              />
              <input
                id="port"
                className="brmble-input port-input"
                type="number"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value) || 64738)}
                placeholder="Port"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              className="brmble-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Your display name"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password <span className="optional">(optional)</span></label>
            <input
              id="password"
              className="brmble-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Server password"
            />
          </div>

          <button type="submit" className="btn btn-primary connect-btn">
            Connect
          </button>
        </form>
      </div>
    </div>
  );
}
