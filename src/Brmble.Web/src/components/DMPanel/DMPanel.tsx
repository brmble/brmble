import './DMPanel.css';

interface DMPanelProps {
  isOpen: boolean;
  onClose: () => void;
  users: { id: string; name: string }[];
  conversations: { id: string; name: string; lastMessage: string; unread: number }[];
  onStartDM: (userId: string) => void;
  selectedConversation?: string;
}

export function DMPanel({ isOpen, onClose, users, conversations, onStartDM, selectedConversation }: DMPanelProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="dm-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dm-panel-header">
          <h2 className="dm-panel-title">Direct Messages</h2>
          <button className="modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="dm-panel-content">
          {conversations.length > 0 && (
            <div className="dm-section">
              <h3 className="dm-section-title">Recent Conversations</h3>
              <div className="dm-conversations">
                {conversations.map(conv => (
                  <div 
                    key={conv.id} 
                    className={`dm-conversation ${selectedConversation === conv.id ? 'active' : ''}`}
                  >
                    <div className="dm-avatar">
                      <span>{conv.name.charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="dm-conversation-info">
                      <span className="dm-conversation-name">{conv.name}</span>
                      <span className="dm-conversation-preview">{conv.lastMessage}</span>
                    </div>
                    {conv.unread > 0 && (
                      <span className="dm-unread-badge">{conv.unread}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="dm-section">
            <h3 className="dm-section-title">Start a New Conversation</h3>
            <div className="dm-users">
              {users.map(user => (
                <button 
                  key={user.id} 
                  className="dm-user"
                  onClick={() => onStartDM(user.id)}
                >
                  <div className="dm-avatar">
                    <span>{user.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <span className="dm-user-name">{user.name}</span>
                </button>
              ))}
              {users.length === 0 && (
                <p className="dm-no-users">No users available</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
