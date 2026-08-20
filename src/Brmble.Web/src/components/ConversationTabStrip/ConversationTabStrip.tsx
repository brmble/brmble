import type { Conversation } from '../../workspace/conversation';
import { Icon } from '../Icon/Icon';
import styles from './ConversationTabStrip.module.css';

export interface ConversationTabItem {
  conversation: Conversation;
  key: string;
  label: string;
  isHome: boolean;
  unreadCount: number;
  mentionCount: number;
}

interface ConversationTabStripProps {
  tabs: ConversationTabItem[];
  activeKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
}

export function ConversationTabStrip({ tabs, activeKey, onActivate, onClose }: ConversationTabStripProps) {
  if (tabs.length === 0) return null;

  // Indexes into the combined `tabs` list so arrow keys traverse the pinned home
  // tab and the scrolled tabs as one tab set.
  const move = (index: number, delta: number) => {
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) onActivate(next.key);
  };

  const renderTab = (tab: ConversationTabItem, index: number) => (
    <div key={tab.key} className={`${styles.tab} ${activeKey === tab.key ? styles.active : ''} ${tab.isHome ? styles.home : ''}`}>
      <button
        type="button"
        role="tab"
        aria-selected={activeKey === tab.key}
        tabIndex={activeKey === tab.key ? 0 : -1}
        className={styles.label}
        onClick={() => onActivate(tab.key)}
        onKeyDown={event => {
          if (event.key === 'ArrowRight') { event.preventDefault(); move(index, 1); }
          if (event.key === 'ArrowLeft') { event.preventDefault(); move(index, -1); }
          if (event.key === 'Delete' && !tab.isHome) { event.preventDefault(); onClose(tab.key); }
        }}
      >
        <span className={styles.text} data-testid="conversation-tab-label" aria-hidden={tab.isHome || undefined}>{tab.label}</span>
        {tab.isHome && <span className="sr-only">{`${tab.label} (you are here)`}</span>}
        {tab.mentionCount > 0 && <span className={styles.mention}>@{tab.mentionCount}</span>}
        {tab.mentionCount === 0 && tab.unreadCount > 0 && <span className={styles.unread}>{tab.unreadCount}</span>}
      </button>
      {!tab.isHome && (
        <button
          type="button"
          className={styles.close}
          aria-label={`Close ${tab.label}`}
          onClick={() => onClose(tab.key)}
        >
          <Icon name="x" size={10} />
        </button>
      )}
    </div>
  );

  return (
    <div className={styles.strip} role="tablist" aria-label="Conversations">
      {tabs.map((tab, index) => (tab.isHome ? renderTab(tab, index) : null))}
      <div
        className={styles.scroller}
        data-testid="conversation-tab-scroller"
        tabIndex={0}
        role="group"
        aria-label="Scroll conversations"
      >
        {tabs.map((tab, index) => (tab.isHome ? null : renderTab(tab, index)))}
      </div>
    </div>
  );
}
