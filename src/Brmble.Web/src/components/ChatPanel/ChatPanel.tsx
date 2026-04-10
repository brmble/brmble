import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { BrmbleLogo } from '../Header/BrmbleLogo';
import { groupMessages } from '../../utils/groupMessages';
import { formatDateSeparator, formatFullDate } from '../../utils/formatDateSeparator';
import type { ChatMessage, MentionableUser } from '../../types';
import { ScreenShareViewer } from '../ScreenShareViewer/ScreenShareViewer';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import { Tooltip } from '../Tooltip/Tooltip';
import { Icon } from '../Icon/Icon';
import Avatar from '../Avatar/Avatar';
import './ChatPanel.css';

interface ChatPanelProps {
  channelId?: string;
  channelName?: string;
  messages: ChatMessage[];
  currentUsername?: string;
  onSendMessage: (content: string, image?: File) => void;
  onDismissMessage?: (messageId: string) => void;
  isDM?: boolean;
  matrixClient?: MatrixClient | null;
  matrixRoomId?: string | null;
  readMarkerTs?: number | null;
  screenShareVideoEl?: HTMLVideoElement | null;
  screenSharerName?: string;
  screenShareViewerMode?: 'in-app' | 'new-window';
  onCloseScreenShare?: () => void;
  /** Connected users for avatar lookup by sender name */
  users?: { name: string; matrixUserId?: string; avatarUrl?: string }[];
  disabled?: boolean;
  /** Optional notice shown at the top of the message area (e.g. ephemeral chat warning). */
  topNotice?: string;
  onMessageContextMenu?: (x: number, y: number, sender: string, senderMatrixUserId?: string, content?: string, messageId?: string) => void;
  onCopyToClipboard?: (text: string) => void;
}

const SCROLL_THRESHOLD = 150;
const SPLIT_STORAGE_KEY = 'brmble-screenshare-split';
const DEFAULT_SPLIT = 50;

export function ChatPanel({ channelId, channelName, messages, currentUsername, onSendMessage, onDismissMessage, isDM, matrixClient, matrixRoomId, readMarkerTs, screenShareVideoEl, screenSharerName, screenShareViewerMode, onCloseScreenShare, users, disabled, topNotice, onMessageContextMenu, onCopyToClipboard }: ChatPanelProps) {
  // Build lookup maps from sender name and matrixUserId → avatar data for MessageBubble.
  // Name-based lookup works when Mumble name matches message sender.
  // MatrixUserId-based lookup handles cases where the user connected with a different
  // Mumble name than the Matrix display name used in messages.
  // Falls back to Matrix room membership for offline users.
  const senderAvatarMap = useMemo(() => {
    const byName = new Map<string, { avatarUrl?: string; matrixUserId?: string }>();
    const byMatrixId = new Map<string, { avatarUrl?: string; matrixUserId?: string }>();

    // First, populate from Matrix room members (lower priority — offline fallback)
    if (matrixClient && matrixRoomId) {
      const room = matrixClient.getRoom(matrixRoomId);
      if (room) {
        for (const member of room.getJoinedMembers()) {
          const avatarUrl = member.getAvatarUrl(matrixClient.baseUrl, 128, 128, 'crop', false, false) ?? undefined;
          const displayName = member.rawDisplayName || member.name;
          const entry = { avatarUrl, matrixUserId: member.userId };
          if (displayName && displayName !== member.userId) {
            byName.set(displayName, entry);
          }
          byMatrixId.set(member.userId, entry);
        }
      }
    }

    // Then, overwrite with live Mumble users (higher priority — online with fresh data)
    if (users) {
      for (const u of users) {
        const entry = { avatarUrl: u.avatarUrl, matrixUserId: u.matrixUserId };
        byName.set(u.name, entry);
        if (u.matrixUserId) {
          byMatrixId.set(u.matrixUserId, entry);
        }
      }
    }
    return { byName, byMatrixId };
  }, [users, matrixClient, matrixRoomId]);

  /** Look up avatar data by sender name first, then fall back to matrixUserId. */
  const lookupAvatar = useCallback((senderName: string, senderMatrixId?: string) => {
    return senderAvatarMap.byName.get(senderName)
      ?? (senderMatrixId ? senderAvatarMap.byMatrixId.get(senderMatrixId) : undefined);
  }, [senderAvatarMap]);

  /** Look up a message by event ID from the messages array. */
  const lookupMessageById = useCallback((eventId: string): ChatMessage | undefined => {
    for (const msg of messages) {
      if (msg.id === eventId) return msg;
    }
    return undefined;
  }, [messages]);

  const mentionableUsers = useMemo<MentionableUser[]>(() => {
    const result: MentionableUser[] = [];
    const seen = new Set<string>();

    // Add connected Mumble users first (they're online)
    if (users) {
      for (const u of users) {
        result.push({
          displayName: u.name,
          matrixUserId: u.matrixUserId,
          avatarUrl: u.avatarUrl,
          isOnline: true,
        });
        seen.add(u.name.toLowerCase());
        if (u.matrixUserId) seen.add(u.matrixUserId);
      }
    }

    // Add Matrix room members who aren't already in the list (scoped to active room)
    if (matrixClient && matrixRoomId) {
      const room = matrixClient.getRoom(matrixRoomId);
      if (room) {
        const members = room.getJoinedMembers();
        for (const member of members) {
          const userId = member.userId;
          const displayName = member.rawDisplayName || member.name || userId;
          if (seen.has(userId) || seen.has(displayName.toLowerCase())) continue;
          seen.add(userId);
          seen.add(displayName.toLowerCase());
          result.push({
            displayName,
            matrixUserId: userId,
            isOnline: false,
          });
        }
      }
    }

    return result;
  }, [users, matrixClient, matrixRoomId]);

  const knownUsernames = useMemo(() => {
    return new Set(mentionableUsers.map(u => u.displayName));
  }, [mentionableUsers]);

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
  const [hiddenCounts, setHiddenCounts] = useState<Map<string, number>>(() => new Map());
  const messageObserverRef = useRef<IntersectionObserver | null>(null);
  const messageElMapRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const hiddenSetRef = useRef<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sender: string; senderMatrixUserId?: string; content?: string; messageId?: string; msgType?: string } | null>(null);
const [replyState, setReplyState] = useState<{
  eventId: string;
  sender: string;
  senderMatrixUserId?: string;
  content: string;
  html?: string;
  msgType: string;
} | null>(null);
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

  const hasScreenShare = screenShareViewerMode === 'in-app' && !!screenShareVideoEl && !!screenSharerName && !!onCloseScreenShare;
  const hasNewWindowScreenShare = screenShareViewerMode === 'new-window' && !!screenShareVideoEl && !!screenSharerName && !!onCloseScreenShare;

  useEffect(() => {
    if (hasNewWindowScreenShare && screenShareVideoEl && screenSharerName) {
      const existingOverlay = document.getElementById('screenshare-new-window-overlay');
      if (existingOverlay) {
        existingOverlay.remove();
      }
      
      const overlay = document.createElement('div');
      overlay.id = 'screenshare-new-window-overlay';
      
      const closeOverlay = () => {
        overlay.remove();
        onCloseScreenShare?.();
      };
      
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          closeOverlay();
        }
      };
      document.addEventListener('keydown', handleEsc);
      
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Tab') {
          const focusable = overlay.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      };
      overlay.addEventListener('keydown', handleKeyDown);
      
      overlay.id = 'screenshare-new-window-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', `Screen share from ${screenSharerName}`);
      
      const style = document.createElement('style');
      style.textContent = `
        #screenshare-new-window-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: #000;
          z-index: 99999;
          display: flex;
          flex-direction: column;
        }
        #screenshare-new-window-overlay .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 20px;
          background: #1a1a1a;
          -webkit-app-region: drag;
        }
        #screenshare-new-window-overlay .title {
          color: #fff;
          font-size: 15px;
          font-weight: 500;
        }
        #screenshare-new-window-overlay .buttons {
          display: flex;
          gap: 8px;
          -webkit-app-region: no-drag;
        }
        #screenshare-new-window-overlay .btn {
          background: #333;
          border: none;
          color: #fff;
          padding: 6px 14px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        }
        #screenshare-new-window-overlay .btn-close {
          background: #d32f2f;
        }
        #screenshare-new-window-overlay .btn-close:hover {
          background: #b71c1c;
        }
        #screenshare-new-window-overlay .video-container {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #000;
        }
        #screenshare-new-window-overlay video {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }
      `;
      
      const header = document.createElement('div');
      header.className = 'header';
      
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = `Screen Share - ${screenSharerName}`;
      
      const buttons = document.createElement('div');
      buttons.className = 'buttons';
      
      const closeButton = document.createElement('button');
      closeButton.className = 'btn btn-close';
      closeButton.id = 'screenshare-close-btn';
      closeButton.textContent = 'Close';
      
      const videoContainer = document.createElement('div');
      videoContainer.className = 'video-container';
      
      const newVideo = document.createElement('video');
      newVideo.autoplay = true;
      newVideo.playsInline = true;
      
      buttons.appendChild(closeButton);
      header.appendChild(title);
      header.appendChild(buttons);
      videoContainer.appendChild(newVideo);
      overlay.appendChild(style);
      overlay.appendChild(header);
      overlay.appendChild(videoContainer);
      
      document.body.appendChild(overlay);
      
      if (screenShareVideoEl.srcObject) {
        newVideo.srcObject = screenShareVideoEl.srcObject;
      }
      
      closeButton.addEventListener('click', closeOverlay);
      
      const previousActiveElement = document.activeElement;
      closeButton.focus();
      
      return () => {
        overlay.remove();
        document.removeEventListener('keydown', handleEsc);
        overlay.removeEventListener('keydown', handleKeyDown);
        if (previousActiveElement instanceof HTMLElement) {
          previousActiveElement.focus();
        }
      };
    }
  }, [hasNewWindowScreenShare, screenShareVideoEl, screenSharerName, onCloseScreenShare]);

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
          unreadDividerRef.current.scrollIntoView({ behavior: 'auto', block: 'center' });
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
        unreadDividerRef.current.scrollIntoView({ behavior: 'auto', block: 'center' });
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

  const grouped = useMemo(() => groupMessages(messages, readMarkerTs, currentUsername), [messages, readMarkerTs, currentUsername]);

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

  // --- Hidden message counting for cascading dots ---
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    hiddenSetRef.current.clear();
    setHiddenCounts(new Map());

    const observer = new IntersectionObserver(
      (entries) => {
        const hiddenSet = hiddenSetRef.current;
        let changed = false;

        // Incrementally update hidden set from observer entries only —
        // no full DOM scan. We compute containerRect once per callback batch.
        const containerRect = container.getBoundingClientRect();
        for (const entry of entries) {
          const msgId = (entry.target as HTMLElement).dataset.msgTrack;
          if (!msgId) continue;
          const isAbove = entry.boundingClientRect.bottom < containerRect.top;
          if (!entry.isIntersecting && isAbove) {
            if (!hiddenSet.has(msgId)) { hiddenSet.add(msgId); changed = true; }
          } else {
            if (hiddenSet.has(msgId)) { hiddenSet.delete(msgId); changed = true; }
          }
        }

        if (!changed) return;

        // Count hidden messages per section
        const next = new Map<string, number>();
        for (const section of dateSections) {
          let count = 0;
          for (const item of section.items) {
            if (hiddenSet.has(item.message.id)) count++;
          }
          if (count > 0) next.set(section.dateMessageId, count);
        }

        setHiddenCounts(prev => {
          // Only update state if changed
          if (next.size !== prev.size) return next;
          for (const [k, v] of next) {
            if (prev.get(k) !== v) return next;
          }
          return prev;
        });
      },
      { root: container, threshold: 0 }
    );

    messageObserverRef.current = observer;
    messageElMapRef.current.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      messageObserverRef.current = null;
    };
  }, [channelId, dateSections]);

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

  const messageRefCallback = useCallback((id: string) => (el: HTMLDivElement | null) => {
    const map = messageElMapRef.current;
    const observer = messageObserverRef.current;
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

  if (!channelId) {
    return (
      <div className="chat-panel chat-panel--empty">
        <div className="chat-empty-state">
          {isDM ? (
            <div className="empty-icon">
              <Icon name="message-circle" size={48} strokeWidth={1.5} />
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
            <Avatar user={{ name: channelName || '', matrixUserId: lookupAvatar(channelName || '')?.matrixUserId, avatarUrl: lookupAvatar(channelName || '')?.avatarUrl }} size={28} isMumbleOnly={!lookupAvatar(channelName || '')?.matrixUserId} />
          ) : (
            <span className="channel-hash">#</span>
          )}
          <h3 className="heading-section">{channelName}</h3>
        </div>
        {searchOpen && (
          <div className="chat-search-inline">
            <div className="chat-search-input-wrapper">
              <Icon name="search" size={14} className="chat-search-icon" />
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
                  <Icon name="chevron-up" size={14} />
                </button>
              </Tooltip>
              <Tooltip content="Previous match (Shift+Enter)">
                <button
                  className="chat-search-nav-btn"
                  onClick={handleSearchPrev}
                  disabled={searchMatches.length === 0}
                  aria-label="Previous match"
                >
                  <Icon name="chevron-down" size={14} />
                </button>
              </Tooltip>
              <Tooltip content="Close search (Esc)">
                <button
                  className="chat-search-nav-btn"
                  onClick={() => { setSearchOpen(false); setSearchQuery(''); setCurrentMatchIndex(0); }}
                  aria-label="Close search"
                >
                  <Icon name="x" size={14} />
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
              <Icon name="search" size={18} />
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
        {topNotice && (
          <div className="chat-top-notice">
            <Icon name="info" size={14} />
            <span>{topNotice}</span>
          </div>
        )}
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
              <div className="chat-date-separator-wrapper">
                <Tooltip content={formatFullDate(section.timestamp)}>
                <div className="chat-date-separator">
                  <span className="chat-date-separator-label">
                    {formatDateSeparator(section.timestamp)}
                  </span>
                </div>
                </Tooltip>
                {stuckSeparators.has(section.dateMessageId) && (hiddenCounts.get(section.dateMessageId) ?? 0) > 0 && (() => {
                  const hiddenCount = hiddenCounts.get(section.dateMessageId) ?? 0;
                  const dotCount = hiddenCount >= 7 ? 3 : hiddenCount >= 3 ? 2 : 1;
                  return (
                    <div className="chat-date-dots">
                      {Array.from({ length: dotCount }, (_, i) => (
                        <div key={i} className="chat-date-dot" />
                      ))}
                    </div>
                  );
                })()}
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
                    ref={messageRefCallback(item.message.id)}
                    data-msg-track={item.message.id}
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
                    senderAvatarUrl={lookupAvatar(item.message.sender, item.message.senderMatrixUserId)?.avatarUrl}
                    senderMatrixUserId={lookupAvatar(item.message.sender, item.message.senderMatrixUserId)?.matrixUserId}
                    currentUsername={currentUsername}
                    knownUsernames={knownUsernames}
                    messageId={item.message.id}
                    pending={item.message.pending}
                    error={item.message.error}
                    replyToEventId={item.message.replyToEventId}
                    replyToSender={(item.message.replyToSender) || (item.message.replyToEventId ? lookupMessageById(item.message.replyToEventId)?.sender : undefined)}
                    replyToContent={(item.message.replyToContent) || (item.message.replyToEventId ? lookupMessageById(item.message.replyToEventId)?.content : undefined)}
                    onDismiss={onDismissMessage}
                    onOpenContextMenu={onMessageContextMenu ? (x, y, s, m, c, msgId, msgType = 'm.text') => {
                      if (s !== currentUsername) {
                        setContextMenu({ x, y, sender: s, senderMatrixUserId: m, content: c, messageId: msgId, msgType });
                      }
                    } : undefined}
                  />
                </Fragment>
                );
              })}
            </div>
          ))
        )}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={[
              { type: 'item', label: 'Copy', onClick: () => {
                if (contextMenu.content && onCopyToClipboard) {
                  onCopyToClipboard(contextMenu.content);
                }
                setContextMenu(null);
              }},
              { type: 'item', label: 'Reply', onClick: () => {
                if (contextMenu.messageId && contextMenu.sender) {
                  setReplyState({
                    eventId: contextMenu.messageId,
                    sender: contextMenu.sender,
                    senderMatrixUserId: contextMenu.senderMatrixUserId,
                    content: contextMenu.content || '',
                    msgType: contextMenu.msgType || 'm.text',
                  });
                }
                setContextMenu(null);
              }},
              { type: 'divider' },
              { type: 'item', label: 'Send DM', onClick: () => {
                if (onMessageContextMenu) {
                  onMessageContextMenu(contextMenu.x, contextMenu.y, contextMenu.sender, contextMenu.senderMatrixUserId);
                }
                setContextMenu(null);
              }}
            ]}
            onClose={() => setContextMenu(null)}
          />
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
            <Icon name="chevron-down" size={20} />
          </button>
          </Tooltip>
        )}
        <MessageInput onSend={onSendMessage} placeholder={isDM ? `Message @${channelName}` : `Message #${channelName}`} mentionableUsers={mentionableUsers} disabled={disabled} replyState={replyState} onClearReply={() => setReplyState(null)} matrixClient={matrixClient} matrixRoomId={matrixRoomId} />
      </div>
    </div>
  );
}
