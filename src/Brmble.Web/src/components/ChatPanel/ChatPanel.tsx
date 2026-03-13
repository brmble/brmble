import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { BrmbleLogo } from '../Header/BrmbleLogo';
import { groupMessages } from '../../utils/groupMessages';
import { formatDateSeparator, formatFullDate } from '../../utils/formatDateSeparator';
import type { ChatMessage } from '../../types';
import { ScreenShareViewer } from '../ScreenShareViewer/ScreenShareViewer';
import { Tooltip } from '../Tooltip/Tooltip';
import Avatar from '../Avatar/Avatar';
import './ChatPanel.css';

interface ChatPanelProps {
  channelId?: string;
  channelName?: string;
  messages: ChatMessage[];
  currentUsername?: string;
  onSendMessage: (content: string) => void;
  isDM?: boolean;
  matrixClient?: MatrixClient | null;
  readMarkerTs?: number | null;
  screenShareVideoEl?: HTMLVideoElement | null;
  screenSharerName?: string;
  onCloseScreenShare?: () => void;
  /** Connected users for avatar lookup by sender name */
  users?: { name: string; matrixUserId?: string; avatarUrl?: string }[];
}

const SCROLL_THRESHOLD = 150;
const SPLIT_STORAGE_KEY = 'brmble-screenshare-split';
const DEFAULT_SPLIT = 50;

export function ChatPanel({ channelId, channelName, messages, currentUsername, onSendMessage, isDM, matrixClient, readMarkerTs, screenShareVideoEl, screenSharerName, onCloseScreenShare, users }: ChatPanelProps) {
  // Build a lookup map from sender name → avatar data for MessageBubble
  const senderAvatarMap = useMemo(() => {
    const map = new Map<string, { avatarUrl?: string; matrixUserId?: string }>();
    if (users) {
      for (const u of users) {
        map.set(u.name, { avatarUrl: u.avatarUrl, matrixUserId: u.matrixUserId });
      }
    }
    return map;
  }, [users]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const unreadDividerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [stuckSeparators, setStuckSeparators] = useState<Set<string>>(() => new Set());
  const stickyObserverRef = useRef<IntersectionObserver | null>(null);
  const sentinelMapRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [splitPercent, setSplitPercent] = useState(() => {
    const stored = localStorage.getItem(SPLIT_STORAGE_KEY);
    return stored ? Number(stored) : DEFAULT_SPLIT;
  });
  const isDraggingRef = useRef(false);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const headerEl = panel.querySelector('.chat-header') as HTMLElement;
      const headerHeight = headerEl ? headerEl.offsetHeight : 0;
      const availableHeight = rect.height - headerHeight;
      const y = moveEvent.clientY - rect.top - headerHeight;
      const pct = Math.min(80, Math.max(20, (y / availableHeight) * 100));
      setSplitPercent(pct);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      setSplitPercent(prev => {
        localStorage.setItem(SPLIT_STORAGE_KEY, String(prev));
        return prev;
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const hasScreenShare = !!screenShareVideoEl && !!screenSharerName && !!onCloseScreenShare;

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const shouldShow = distanceFromBottom > SCROLL_THRESHOLD;
    setShowScrollButton(prev => prev !== shouldShow ? shouldShow : prev);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const checkScrollButton = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      setShowScrollButton(false);
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollButton(distanceFromBottom > SCROLL_THRESHOLD);
  }, []);

  // One-shot flag: allow the ResizeObserver to auto-scroll only once after
  // a channel/DM switch (i.e. during the initial slide-in transition).
  // Cleared after the first resize fires, so subsequent resizes (e.g.
  // screen-share divider drag) don't override the user's scroll position.
  const pendingSlideScrollRef = useRef(false);

  // Re-evaluate scroll button when the messages container resizes
  // (e.g. when the DM/channel slide becomes visible).
  // Only auto-scroll during the initial slide-in transition (one-shot).
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      checkScrollButton();
      if (pendingSlideScrollRef.current) {
        pendingSlideScrollRef.current = false;
        if (unreadDividerRef.current) {
          unreadDividerRef.current.scrollIntoView({ behavior: 'auto', block: 'start' });
        } else if (messagesEndRef.current) {
          messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [checkScrollButton]);

  // Re-evaluate scroll button visibility when switching channels or messages change.
  // Uses requestAnimationFrame so the DOM has rendered the new messages
  // before we measure scrollHeight.
  useEffect(() => {
    const rafId = requestAnimationFrame(checkScrollButton);
    return () => cancelAnimationFrame(rafId);
  }, [channelId, messages, checkScrollButton]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    // Only auto-scroll if user is within threshold of bottom
    if (distanceFromBottom < SCROLL_THRESHOLD) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Scroll to unread divider on channel switch, or bottom if fully read.
  // Delay must exceed the slide transition (400ms) so layout has settled.
  // Also arm the one-shot ResizeObserver scroll for the slide-in transition.
  useEffect(() => {
    pendingSlideScrollRef.current = true;
    const timer = setTimeout(() => {
      pendingSlideScrollRef.current = false;
      if (unreadDividerRef.current) {
        unreadDividerRef.current.scrollIntoView({ behavior: 'auto', block: 'start' });
      } else if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView();
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [channelId, readMarkerTs]);

  // --- Sticky date separator detection ---
  // Each date separator has a 1px sentinel div above it. When the sentinel
  // scrolls out of the container viewport (above the top), its separator is
  // "stuck". We track this with an IntersectionObserver on the sentinels.
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    setStuckSeparators(new Set());

    const observer = new IntersectionObserver(
      (entries) => {
        setStuckSeparators(prev => {
          const next = new Set(prev);
          let changed = false;
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.sentinelFor;
            if (!id) continue;
            // Only mark as stuck when sentinel is above the viewport top
            // (not when it's below the viewport, e.g. before user scrolls to it)
            const rootTop = entry.rootBounds ? entry.rootBounds.top : container.getBoundingClientRect().top;
            const isAboveViewport = entry.boundingClientRect.top < rootTop;
            if (!entry.isIntersecting && isAboveViewport) {
              if (!next.has(id)) { next.add(id); changed = true; }
            } else {
              if (next.has(id)) { next.delete(id); changed = true; }
            }
          }
          return changed ? next : prev;
        });
      },
      { root: container, threshold: 0 }
    );

    stickyObserverRef.current = observer;

    // Observe any sentinels already in the DOM
    sentinelMapRef.current.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      stickyObserverRef.current = null;
    };
  }, [channelId]);

  const sentinelRefCallback = useCallback((id: string) => (el: HTMLDivElement | null) => {
    const map = sentinelMapRef.current;
    const observer = stickyObserverRef.current;
    const prev = map.get(id);

    if (prev && observer) observer.unobserve(prev);

    if (el) {
      map.set(id, el);
      if (observer) observer.observe(el);
    } else {
      map.delete(id);
    }
  }, []);

  // --- Search logic ---
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    const indices: number[] = [];
    messages.forEach((msg, i) => {
      if (msg.content && msg.content.toLowerCase().includes(query)) {
        indices.push(i);
      }
    });
    return indices;
  }, [messages, searchQuery]);

  const handleSearchPrev = useCallback(() => {
    if (searchMatches.length === 0) return;
    setCurrentMatchIndex(prev => (prev - 1 + searchMatches.length) % searchMatches.length);
  }, [searchMatches.length]);

  const handleSearchNext = useCallback(() => {
    if (searchMatches.length === 0) return;
    setCurrentMatchIndex(prev => (prev + 1) % searchMatches.length);
  }, [searchMatches.length]);

  // Auto-focus search input when opening
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  // Ctrl+F toggles search when chat panel is active
  useEffect(() => {
    if (!channelId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        // Only intercept when focus is inside the chat panel
        if (!panelRef.current?.contains(document.activeElement)) return;
        e.preventDefault();
        setSearchOpen(prev => {
          if (prev) {
            setSearchQuery('');
            setCurrentMatchIndex(0);
          }
          return !prev;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [channelId]);

  // Reset search on channel switch
  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setCurrentMatchIndex(0);
  }, [channelId]);

  // Scroll to active match
  useEffect(() => {
    if (searchMatches.length === 0 || !messagesContainerRef.current) return;
    const msgIndex = searchMatches[searchMatches.length - 1 - currentMatchIndex];
    const target = messagesContainerRef.current.querySelector(`[data-message-index="${msgIndex}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentMatchIndex, searchMatches]);

  const grouped = useMemo(() => groupMessages(messages, readMarkerTs), [messages, readMarkerTs]);

  // Precompute message-id → index map to avoid O(n²) indexOf in render loop
  const messageIndexById = useMemo(() => new Map(messages.map((m, i) => [m.id, i])), [messages]);

  // Group messages into date sections for proper sticky push-out behavior.
  // Each section contains a date separator header + its messages.
  const dateSections = useMemo(() => {
    const sections: { dateMessageId: string; timestamp: Date; items: typeof grouped }[] = [];
    for (const item of grouped) {
      if (item.showDateSeparator) {
        sections.push({ dateMessageId: item.message.id, timestamp: item.message.timestamp, items: [] });
      }
      if (sections.length > 0) {
        sections[sections.length - 1].items.push(item);
      }
    }
    return sections;
  }, [grouped]);

  if (!channelId) {
    return (
      <div className="chat-panel chat-panel--empty">
        <div className="chat-empty-state">
          {isDM ? (
            <div className="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </div>
          ) : (
            <div className="empty-logo">
              <BrmbleLogo size={192} heartbeat />
            </div>
          )}
          <h2 className="heading-title">{isDM ? 'Direct Messages' : 'Welcome to Brmble'}</h2>
          <p>{isDM ? 'Right-click a user to start a private conversation' : 'Select a channel to start talking and chatting'}</p>
        </div>
      </div>
    );
  }


  return (
    <div className="chat-panel" ref={panelRef}>
      <div className="chat-header">
        <div className="chat-header-left">
          {isDM ? (
            <Avatar user={{ name: channelName || '', matrixUserId: senderAvatarMap.get(channelName || '')?.matrixUserId, avatarUrl: senderAvatarMap.get(channelName || '')?.avatarUrl }} size={28} />
          ) : (
            <span className="channel-hash">#</span>
          )}
          <h3 className="heading-section">{channelName}</h3>
        </div>
        {searchOpen && (
          <div className="chat-search-inline">
            <div className="chat-search-input-wrapper">
              <svg className="chat-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchInputRef}
                className="chat-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentMatchIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearchOpen(false);
                    setSearchQuery('');
                    setCurrentMatchIndex(0);
                  } else if (e.key === 'Enter') {
                    if (e.shiftKey) handleSearchPrev();
                    else handleSearchNext();
                  }
                }}
                placeholder="Search messages..."
                aria-label="Search messages"
              />
              {searchQuery && (
                <span className="chat-search-count">
                  {searchMatches.length > 0 ? `${currentMatchIndex + 1} of ${searchMatches.length}` : 'No results'}
                </span>
              )}
            </div>
            <div className="chat-search-nav">
              <Tooltip content="Next match (Enter)">
                <button
                  className="chat-search-nav-btn"
                  onClick={handleSearchNext}
                  disabled={searchMatches.length === 0}
                  aria-label="Next match"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="18 15 12 9 6 15" /></svg>
                </button>
              </Tooltip>
              <Tooltip content="Previous match (Shift+Enter)">
                <button
                  className="chat-search-nav-btn"
                  onClick={handleSearchPrev}
                  disabled={searchMatches.length === 0}
                  aria-label="Previous match"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
              </Tooltip>
              <Tooltip content="Close search (Esc)">
                <button
                  className="chat-search-nav-btn"
                  onClick={() => { setSearchOpen(false); setSearchQuery(''); setCurrentMatchIndex(0); }}
                  aria-label="Close search"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </Tooltip>
            </div>
          </div>
        )}
        <div className="chat-header-right">
          <Tooltip content={searchOpen ? 'Close search' : 'Search messages (Ctrl+F)'}>
            <button
              className={`chat-search-toggle${searchOpen ? ' active' : ''}`}
              onClick={() => {
                setSearchOpen(prev => !prev);
                if (searchOpen) {
                  setSearchQuery('');
                  setCurrentMatchIndex(0);
                }
              }}
              aria-label={searchOpen ? 'Close search' : 'Search messages'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>

      {hasScreenShare && (
        <>
          <div className="chat-split-video" style={{ flex: `0 0 ${splitPercent}%` }}>
            <ScreenShareViewer
              videoEl={screenShareVideoEl}
              sharerName={screenSharerName}
              onClose={onCloseScreenShare}
            />
          </div>
          <div
            className="chat-split-divider"
            role="separator"
            aria-orientation="horizontal"
            aria-valuenow={splitPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            tabIndex={0}
            onMouseDown={handleDividerMouseDown}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                const delta = event.key === 'ArrowUp' ? -5 : 5;
                const next = Math.min(80, Math.max(20, splitPercent + delta));
                if (next !== splitPercent) {
                  setSplitPercent(next);
                  localStorage.setItem(SPLIT_STORAGE_KEY, String(next));
                }
              }
            }}
          />
        </>
      )}

      <div className="chat-messages" ref={messagesContainerRef} onScroll={handleScroll}>
        {grouped.length === 0 ? (
          <div className="chat-no-messages">
            <p>No messages yet. Start the conversation!</p>
          </div>
        ) : (
          dateSections.map((section) => (
            <div className="chat-date-group" key={`date-${section.dateMessageId}`}>
              <div
                className="chat-date-sentinel"
                ref={sentinelRefCallback(section.dateMessageId)}
                data-sentinel-for={section.dateMessageId}
              />
              <div className={`chat-date-separator-wrapper${stuckSeparators.has(section.dateMessageId) ? ' is-stuck' : ''}`}>
                <Tooltip content={formatFullDate(section.timestamp)}>
                <div className="chat-date-separator">
                  <span className="chat-date-separator-label">
                    {formatDateSeparator(section.timestamp)}
                  </span>
                </div>
                </Tooltip>
              </div>
              {section.items.map((item) => {
                const msgIndex = messageIndexById.get(item.message.id) ?? -1;
                const isActiveMatch = searchMatches.length > 0 && msgIndex === searchMatches[searchMatches.length - 1 - currentMatchIndex];
                return (
                <Fragment key={item.message.id}>
                  {item.showUnreadDivider && (
                    <div className="chat-unread-divider" ref={unreadDividerRef} key={`unread-${item.message.id}`}>
                      <span className="chat-unread-divider-label">New Messages</span>
                    </div>
                  )}
                  <MessageBubble
                    sender={item.message.sender}
                    content={item.message.content}
                    timestamp={item.message.timestamp}
                    isOwnMessage={!item.message.type && item.message.sender === currentUsername}
                    isSystem={item.message.type === 'system'}
                    collapsed={!item.isGroupStart}
                    html={item.message.html}
                    media={item.message.media}
                    matrixClient={matrixClient}
                    searchQuery={searchQuery}
                    isActiveMatch={isActiveMatch}
                    messageIndex={msgIndex}
                    senderAvatarUrl={senderAvatarMap.get(item.message.sender)?.avatarUrl}
                    senderMatrixUserId={senderAvatarMap.get(item.message.sender)?.matrixUserId}
                  />
                </Fragment>
                );
              })}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        {showScrollButton && (
          <Tooltip content="Scroll to bottom">
          <button
            className="chat-scroll-bottom"
            onClick={scrollToBottom}
            onMouseDown={(e) => e.preventDefault()}
            aria-label="Scroll to latest messages"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          </Tooltip>
        )}
        <MessageInput onSend={onSendMessage} placeholder={isDM ? `Message @${channelName}` : `Message #${channelName}`} />
      </div>
    </div>
  );
}
