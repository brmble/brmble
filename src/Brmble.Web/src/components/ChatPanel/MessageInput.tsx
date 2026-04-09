import { useState, useRef, useEffect, useCallback, useId, type KeyboardEvent } from 'react';
import type { MentionableUser } from '../../types';
import type { MatrixClient } from 'matrix-js-sdk';
import { MentionDropdown } from './MentionDropdown';
import { ReplyHeader } from './ReplyHeader';
import { Tooltip } from '../Tooltip/Tooltip';
import { validateImageFile } from '../../utils/imageUpload';
import './MessageInput.css';

interface MessageInputProps {
  onSend: (content: string, image?: File) => void;
  placeholder?: string;
  mentionableUsers?: MentionableUser[];
  disabled?: boolean;
  replyState?: {
    eventId: string;
    sender: string;
    senderMatrixUserId?: string;
    content: string;
    html?: string;
    msgType: string;
  } | null;
  onClearReply?: () => void;
  matrixClient?: MatrixClient | null;
  matrixRoomId?: string | null;
}

export function MessageInput({ onSend, placeholder = 'Type a message...', mentionableUsers = [], disabled, replyState, onClearReply, matrixClient, matrixRoomId }: MessageInputProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [mentionAnchorRect, setMentionAnchorRect] = useState<DOMRect | null>(null);
  const mentionStartRef = useRef<number>(-1);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ARIA IDs for combobox pattern
  const listboxId = useId();

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

  // Compute filtered users for reuse across handlers
  const filteredUsers = (() => {
    if (!mentionActive) return [];
    const q = mentionQuery.toLowerCase();
    return mentionableUsers
      .filter(u => u.displayName.toLowerCase().startsWith(q))
      .sort((a, b) => {
        if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
      });
  })();

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
      // Allow spaces in usernames (e.g. "First Last"), but stop at newlines
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
        // Recalculate anchor position each time
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

  // Recalculate dropdown position on scroll/resize while mention is active
  useEffect(() => {
    if (!mentionActive) return;
    const recalc = () => {
      if (wrapperRef.current) {
        setMentionAnchorRect(wrapperRef.current.getBoundingClientRect());
      }
    };
    window.addEventListener('scroll', recalc, true);
    window.addEventListener('resize', recalc);
    return () => {
      window.removeEventListener('scroll', recalc, true);
      window.removeEventListener('resize', recalc);
    };
  }, [mentionActive]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessage(value);
    updateMentionState(value, e.target.selectionStart ?? value.length);
  }, [updateMentionState]);

  // Recompute mention state when cursor moves without text change
  const handleSelect = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    updateMentionState(textarea.value, textarea.selectionStart ?? textarea.value.length);
  }, [updateMentionState]);

  const handleMentionSelect = useCallback((user: MentionableUser) => {
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

  const stageImage = useCallback((file: File) => {
    const error = validateImageFile(file);
    if (error) {
      if (error.type === 'empty') return; // silently ignore
      setValidationError(error.message);
      if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
      validationTimerRef.current = setTimeout(() => setValidationError(null), 3000);
      return;
    }
    // Revoke previous preview URL
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setPendingImage(file);
    setImagePreviewUrl(URL.createObjectURL(file));
    setValidationError(null);
  }, [imagePreviewUrl]);

  const clearImage = useCallback(() => {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setPendingImage(null);
    setImagePreviewUrl(null);
    setValidationError(null);
  }, [imagePreviewUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
      if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
    };
  }, [imagePreviewUrl]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) stageImage(file);
        return;
      }
    }
  }, [stageImage]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      stageImage(file);
    }
  }, [stageImage]);

  const handleSend = async () => {
    if (message.trim() || pendingImage) {
      // If there's a replyState, we need to send a Matrix reply
      if (replyState && matrixClient && matrixRoomId) {
        const { buildReplyContent } = await import('../../utils/replyHelpers');
        const content = buildReplyContent(
          matrixRoomId,
          replyState.eventId,
          replyState.sender,
          replyState.senderMatrixUserId,
          replyState.content,
          message.trim()
        );
        await matrixClient.sendMessage(matrixRoomId, content);
        if (onClearReply) onClearReply();
      } else {
        onSend(message.trim(), pendingImage ?? undefined);
      }
      setMessage('');
      setMentionActive(false);
      setPendingImage(null);
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
      setImagePreviewUrl(null);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionActive && filteredUsers.length > 0) {
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
        e.preventDefault();
        const idx = Math.min(mentionActiveIndex, filteredUsers.length - 1);
        handleMentionSelect(filteredUsers[idx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionActive(false);
        return;
      }
    }

    if (e.key === 'Escape' && pendingImage) {
      e.preventDefault();
      clearImage();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Close mention dropdown when clicking outside (handles portaled dropdown)
  useEffect(() => {
    if (!mentionActive) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // Check if click is inside the wrapper OR inside the portaled dropdown
      if (wrapperRef.current?.contains(target)) return;
      if ((target as Element).closest?.('.mention-dropdown')) return;
      setMentionActive(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [mentionActive]);

  // Compute ARIA active descendant
  const activeDescendant = mentionActive && filteredUsers.length > 0
    ? `${listboxId}-option-${Math.min(mentionActiveIndex, filteredUsers.length - 1)}`
    : undefined;

  return (
    <div className="message-input-container">
      {replyState && onClearReply && (
        <ReplyHeader 
          replyState={replyState} 
          onCancel={onClearReply}
        />
      )}
      {pendingImage && imagePreviewUrl && (
        <div className="image-preview-strip">
          <img
            src={imagePreviewUrl}
            alt={pendingImage.name}
            className="image-preview-thumbnail"
          />
          <span className="image-preview-size">
            {(pendingImage.size / 1024).toFixed(0)} KB
          </span>
          <button
            className="image-preview-remove"
            onClick={clearImage}
            aria-label="Remove image"
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
      {validationError && (
        <div className="image-validation-error">{validationError}</div>
      )}
      <div
        className={`message-input-wrapper${isDragOver ? ' drag-over' : ''}`}
        ref={wrapperRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <textarea
          ref={textareaRef}
          className="message-input"
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onSelect={handleSelect}
          onPaste={handlePaste}
          placeholder={disabled ? 'User is offline' : placeholder}
          disabled={disabled}
          rows={1}
          role="combobox"
          aria-expanded={mentionActive && filteredUsers.length > 0}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-controls={mentionActive ? listboxId : undefined}
          aria-activedescendant={activeDescendant}
        />
        <Tooltip content="Send message">
        <button
          className="btn btn-primary btn-icon send-button"
          onClick={handleSend}
          disabled={disabled || (!message.trim() && !pendingImage)}
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
          onSelect={handleMentionSelect}
          onActiveIndexChange={setMentionActiveIndex}
          listboxId={listboxId}
        />
      )}
    </div>
  );
}
