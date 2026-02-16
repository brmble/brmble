import { useState } from 'react';
import { useServerlist } from '../../hooks/useServerlist';
import type { ServerEntry } from '../../hooks/useServerlist';

export function ServerList({ onConnect }: { onConnect: (server: ServerEntry) => void }) {
  const { servers, loading, addServer, updateServer, removeServer } = useServerlist();
  const [editing, setEditing] = useState<ServerEntry | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState({ label: '', host: '', port: '64738', username: '' });

  if (loading) return <div>Loading servers...</div>;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const server = { ...form, port: parseInt(form.port) };
    if (editing) {
      updateServer({ ...server, id: editing.id });
      setEditing(null);
    } else {
      addServer(server);
      setIsAdding(false);
    }
    setForm({ label: '', host: '', port: '64738', username: '' });
  };

  return (
    <div className="server-list">
      <h2>Servers</h2>
      {servers.map(server => (
        <div key={server.id} className="server-item">
          <span>{server.label} - {server.host}:{server.port}</span>
          <div>
            <button onClick={() => onConnect(server)}>Connect</button>
            <button onClick={() => setEditing(server)}>Edit</button>
            <button onClick={() => removeServer(server.id)}>Delete</button>
          </div>
        </div>
      ))}
      
      {isAdding || editing ? (
        <form onSubmit={handleSubmit}>
          <input 
            placeholder="Label" 
            value={editing?.label ?? form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
          />
          <input 
            placeholder="Host" 
            value={editing?.host ?? form.host}
            onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
          />
          <input 
            placeholder="Port" 
            type="number"
            value={editing?.port ?? form.port}
            onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
          />
          <input 
            placeholder="Username" 
            value={editing?.username ?? form.username}
            onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
          />
          <button type="submit">{editing ? 'Update' : 'Add'}</button>
          <button type="button" onClick={() => { setEditing(null); setIsAdding(false); }}>
            Cancel
          </button>
        </form>
      ) : (
        <button onClick={() => setIsAdding(true)}>+ Add Server</button>
      )}
    </div>
  );
}
