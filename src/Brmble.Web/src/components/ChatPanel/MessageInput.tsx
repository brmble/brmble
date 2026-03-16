import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import type { MentionableUser } from '../../types';
import { MentionDropdown } from './MentionDropdown';
import { Tooltip } from '../Tooltip/Tooltip';
import './MessageInput.css';

interface MessageInputProps {
  onSend: (content: string) => void;
  placeholder?: string;
  mentionableUsers?: MentionableUser[];
}

export function MessageInput({ onSend, placeholder = 'Type a message...', mentionableUsers = [] }: MessageInputProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [mentionAnchorRect, setMentionAnchorRect] = useState<DOMRect | null>(null);
  const mentionStartRef = useRef<number>(-1);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [message, resizeTextarea]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [placeholder]);

  const updateMentionState = useCallback((value: string, cursorPos: number) => {
    // Look backwards from cursor for @ that starts a mention
    let atIndex = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      const ch = value[i];
      if (ch === '@') {
        // Check if @ is at start or preceded by whitespace
        if (i === 0 || /\s/.test(value[i - 1])) {
          atIndex = i;
        }
        break;
      }
      if (ch === ' ' && i < cursorPos - 1) {
        // Allow spaces in usernames, but break on double space or newline
        continue;
      }
      if (ch === '\n') break;
    }

    if (atIndex >= 0) {
      const query = value.slice(atIndex + 1, cursorPos);
      // Don't activate if there's a space right after @ with no text
      if (query.length === 0 || !query.startsWith(' ')) {
        setMentionActive(true);
        setMentionQuery(query);
        setMentionActiveIndex(0);
        mentionStartRef.current = atIndex;
        // Position dropdown based on wrapper
        if (wrapperRef.current) {
          setMentionAnchorRect(wrapperRef.current.getBoundingClientRect());
        }
        return;
      }
    }

    setMentionActive(false);
    setMentionQuery('');
    mentionStartRef.current = -1;
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessage(value);
    updateMentionState(value, e.target.selectionStart ?? value.length);
  }, [updateMentionState]);

  const handleSelect = useCallback((user: MentionableUser) => {
    const start = mentionStartRef.current;
    if (start < 0) return;
    const textarea = textareaRef.current;
    const cursorPos = textarea?.selectionStart ?? message.length;
    const before = message.slice(0, start);
    const after = message.slice(cursorPos);
    const newMessage = `${before}@${user.displayName} ${after}`;
    setMessage(newMessage);
    setMentionActive(false);
    setMentionQuery('');
    mentionStartRef.current = -1;

    // Set cursor position after the inserted mention
    const newPos = start + user.displayName.length + 2; // @ + name + space
    requestAnimationFrame(() => {
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(newPos, newPos);
      }
    });
  }, [message]);

  const handleSend = () => {
    if (message.trim()) {
      onSend(message.trim());
      setMessage('');
      setMentionActive(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionActive && mentionableUsers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionActiveIndex(prev => prev + 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionActiveIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        // Only intercept if there are filtered results
        const q = mentionQuery.toLowerCase();
        const hasMatch = mentionableUsers.some(u =>
          u.displayName.toLowerCase().startsWith(q)
        );
        if (hasMatch) {
          e.preventDefault();
          // Find the filtered user at activeIndex
          const filtered = mentionableUsers
            .filter(u => u.displayName.toLowerCase().startsWith(q))
            .sort((a, b) => {
              if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
              return a.displayName.localeCompare(b.displayName);
            });
          if (filtered.length > 0) {
            const idx = Math.min(mentionActiveIndex, filtered.length - 1);
            handleSelect(filtered[idx]);
          }
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionActive(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Close mention dropdown when clicking outside
  useEffect(() => {
    if (!mentionActive) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setMentionActive(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [mentionActive]);

  return (
    <div className="message-input-container">
      <div className="message-input-wrapper" ref={wrapperRef}>
        <textarea
          ref={textareaRef}
          className="message-input"
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          role="combobox"
          aria-expanded={mentionActive}
          aria-autocomplete="list"
        />
        <Tooltip content="Send message">
        <button
          className="btn btn-primary btn-icon send-button"
          onClick={handleSend}
          disabled={!message.trim()}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
        </Tooltip>
      </div>
      {mentionActive && (
        <MentionDropdown
          query={mentionQuery}
          users={mentionableUsers}
          activeIndex={mentionActiveIndex}
          anchorRect={mentionAnchorRect}
          onSelect={handleSelect}
          onActiveIndexChange={setMentionActiveIndex}
        />
      )}
    </div>
  );
}
