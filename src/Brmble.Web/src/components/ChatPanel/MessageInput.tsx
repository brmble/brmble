import { useState, useRef, useEffect, useCallback, useId, type KeyboardEvent } from 'react';
import type { MentionableUser } from '../../types';
import type { MatrixClient } from 'matrix-js-sdk';
import { MentionDropdown } from './MentionDropdown';
import { ReplyHeader } from './ReplyHeader';
import { Tooltip } from '../Tooltip/Tooltip';
import { Icon } from '../Icon/Icon';
import { validateImageFile } from '../../utils/imageUpload';
import { SUPPORTED_REACTIONS } from '../../utils/chatReactions';
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
  typingTargetId?: string;
  onTypingStart?: (targetId: string) => void | Promise<void>;
  onTypingStop?: (targetId: string) => void | Promise<void>;
  editState?: {
    eventId: string;
    originalContent: string;
    currentContent: string;
  } | null;
  onClearEdit?: () => void;
  onSaveEdit?: (eventId: string, body: string) => Promise<boolean>;
}

export function MessageInput({ onSend, placeholder = 'Type a message...', mentionableUsers = [], disabled, replyState, onClearReply, matrixClient, matrixRoomId, typingTargetId, onTypingStart, onTypingStop, editState, onClearEdit, onSaveEdit }: MessageInputProps) {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
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
  const lastTypingDraftRef = useRef(false);
  const lastStartedTypingTargetRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (!editState) return;
    // Only seed the composer when entering edit mode for a specific message.
    // This prevents parent re-renders from overwriting in-progress typing.
    setMessage(editState.originalContent || editState.currentContent);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [editState?.eventId]);

  const stopTypingIfNeeded = useCallback(() => {
    const targetToStop = lastStartedTypingTargetRef.current;
    if (!targetToStop || !lastTypingDraftRef.current) return;
    lastTypingDraftRef.current = false;
    lastStartedTypingTargetRef.current = null;
    void onTypingStop?.(targetToStop);
  }, [onTypingStop]);

  useEffect(() => {
    const hasDraftText = message.trim().length > 0;
    if (!typingTargetId) return;

    if (hasDraftText && !lastTypingDraftRef.current) {
      lastTypingDraftRef.current = true;
      lastStartedTypingTargetRef.current = typingTargetId;
      void onTypingStart?.(typingTargetId);
      return;
    }

    if (!hasDraftText && lastTypingDraftRef.current) {
      lastTypingDraftRef.current = false;
      const targetToStop = lastStartedTypingTargetRef.current;
      lastStartedTypingTargetRef.current = null;
      if (targetToStop) void onTypingStop?.(targetToStop);
    }
  }, [message, onTypingStart, onTypingStop, typingTargetId]);

  useEffect(() => stopTypingIfNeeded, [stopTypingIfNeeded]);
  useEffect(() => { stopTypingIfNeeded(); }, [typingTargetId, stopTypingIfNeeded]);

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
        setIsEmojiPickerOpen(false);
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

  const closeEmojiPicker = useCallback(() => {
    setIsEmojiPickerOpen(false);
  }, []);

  const handleEmojiTriggerClick = useCallback(() => {
    if (disabled) return;
    setIsEmojiPickerOpen((open) => !open);
  }, [disabled]);

  const handleEmojiInsert = useCallback((emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const selectionStart = textarea.selectionStart ?? message.length;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const before = message.slice(0, selectionStart);
    const after = message.slice(selectionEnd);
    const nextMessage = `${before}${emoji}${after}`;
    const nextCaret = selectionStart + emoji.length;

    setMessage(nextMessage);
    setIsEmojiPickerOpen(false);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
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
      const trimmed = message.trim();
      if (editState && onSaveEdit) {
        if (!trimmed || trimmed === editState.currentContent.trim()) {
          return;
        }

        const saved = await onSaveEdit(editState.eventId, trimmed);
        if (saved) {
          setMessage('');
          onClearEdit?.();
        }
        return;
      }
      // If there's a replyState, we need to send a Matrix reply
      if (replyState && matrixClient && matrixRoomId) {
        const { buildReplyContent } = await import('../../utils/replyHelpers');
        const content = buildReplyContent(
          matrixRoomId,
          replyState.eventId,
          replyState.sender,
          replyState.senderMatrixUserId,
          replyState.content,
          trimmed
        );
        await matrixClient.sendMessage(matrixRoomId, content);
        if (onClearReply) onClearReply();
      } else {
        onSend(trimmed, pendingImage ?? undefined);
      }
      stopTypingIfNeeded();
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

    if (e.key === 'Escape' && isEmojiPickerOpen) {
      e.preventDefault();
      closeEmojiPicker();
      return;
    }

    if (e.key === 'Escape' && pendingImage) {
      e.preventDefault();
      clearImage();
      return;
    }

    if (e.key === 'Escape' && editState) {
      e.preventDefault();
      onClearEdit?.();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend().catch(error => console.error('Failed to send message:', error));
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

  useEffect(() => {
    if (!isEmojiPickerOpen) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (emojiPickerRef.current?.contains(target)) return;
      setIsEmojiPickerOpen(false);
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isEmojiPickerOpen]);

  // Compute ARIA active descendant
  const activeDescendant = mentionActive && filteredUsers.length > 0
    ? `${listboxId}-option-${Math.min(mentionActiveIndex, filteredUsers.length - 1)}`
    : undefined;
  const trimmedMessage = message.trim();
  const canSubmit = editState
    ? trimmedMessage.length > 0 && trimmedMessage !== editState.currentContent.trim()
    : trimmedMessage.length > 0 || Boolean(pendingImage);

  return (
    <div className="message-input-container">
      {editState && onClearEdit && (
        <div className="message-edit-header">
          <span>Editing message</span>
          <button type="button" onClick={onClearEdit} aria-label="Cancel edit">
            Cancel
          </button>
        </div>
      )}
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
            <Icon name="x" size={16} />
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
          onBlur={stopTypingIfNeeded}
        />
        <Tooltip content="Insert emoji">
          <button
            type="button"
            className="btn btn-secondary btn-icon emoji-button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleEmojiTriggerClick}
            disabled={disabled}
            aria-label="Insert emoji"
            aria-expanded={isEmojiPickerOpen}
            aria-haspopup="dialog"
          >
            <Icon name="palette" size={18} />
          </button>
        </Tooltip>
        {isEmojiPickerOpen && (
          <div
            ref={emojiPickerRef}
            className="message-emoji-picker"
            role="dialog"
            aria-label="Emoji picker"
          >
            {SUPPORTED_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="message-emoji-option"
                onClick={() => handleEmojiInsert(emoji)}
                aria-label={`Insert ${emoji}`}
              >
                <span aria-hidden="true">{emoji}</span>
              </button>
            ))}
          </div>
        )}
        <Tooltip content="Send message">
          <button
            className="btn btn-primary btn-icon send-button"
            onClick={() => handleSend().catch(error => console.error('Failed to send message:', error))}
            disabled={disabled || !canSubmit}
            aria-label="Send message"
          >
            <Icon name="send" size={20} />
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
