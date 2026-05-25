import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient, RoomEvent, RoomStateEvent, RoomMemberEvent, ClientEvent, EventType, MsgType, KnownMembership, RelationType } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room, RoomMember, RoomState } from 'matrix-js-sdk';
import type { ChatMessage, MediaAttachment } from '../types';
import { addReactionSender, removeReactionSender } from '../utils/chatReactions';
import { formatTypingIndicator } from '../utils/formatTypingIndicator';
import {
  compareReplacementEdits,
  parseBundledReplacementFromUnsigned,
  parseReplacementEvent,
  type ParsedReplacementEvent,
} from '../utils/matrixMessageEditing';
import { useServiceStatus } from './useServiceStatus';
import bridge from '../bridge';

const TYPING_TIMEOUT_MS = 10_000;
const TYPING_REFRESH_MS = 5_000;

type TypingEntry = {
  userId: string;
  displayName: string;
  expiresAt: number;
};

/** Insert a message into a chronologically sorted array, deduplicating by id. Returns the same array if already present. */
function insertMessage(existing: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  if (existing.some(m => m.id === msg.id)) return existing;
  const last = existing[existing.length - 1];
  if (!last || msg.timestamp.getTime() >= last.timestamp.getTime()) {
    return [...existing, msg];
  }
  const ts = msg.timestamp.getTime();
  let lo = 0, hi = existing.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (existing[mid].timestamp.getTime() <= ts) lo = mid + 1;
    else hi = mid;
  }
  const updated = [...existing];
  updated.splice(lo, 0, msg);
  return updated;
}

/**
 * Transform a Matrix `m.room.message` event into a ChatMessage.
 * Pure: only depends on its arguments. No SDK calls beyond what's
 * passed in via `client` (used for mxc → http URL resolution).
 *
 * Returns null for non-message events.
 */
function transformEventToChatMessage(
  event: MatrixEvent,
  room: Room | undefined,
  channelId: string,
  client: MatrixClient | null,
): ChatMessage | null {
  if (event.getType() !== EventType.RoomMessage) return null;

  const senderId = event.getSender() ?? 'Unknown';
  const senderMember = room?.getMember(senderId);
  const displayName = senderMember?.rawDisplayName || senderMember?.name || senderId;

  const content = event.getContent() as {
    body?: string;
    msgtype?: string;
    url?: string;
    info?: { thumbnail_url?: string; w?: number; h?: number; mimetype?: string; size?: number };
    'm.relates_to'?: { 'm.in_reply_to'?: { event_id: string } };
  };

  let media: MediaAttachment[] | undefined;
  if (content.msgtype === 'm.image' && content.url) {
    const fullUrl = client?.mxcUrlToHttp(content.url) ?? content.url;
    media = [{
      type: content.info?.mimetype?.toLowerCase() === 'image/gif' ? 'gif' : 'image',
      url: fullUrl,
      width: content.info?.w,
      height: content.info?.h,
      mimetype: content.info?.mimetype,
      size: content.info?.size,
    }];
  }

  const rawBody = content.body ?? '';
  const isBridgeBotSender = /^@brmble[_-]?/.test(senderId);
  const bridgeMatch = isBridgeBotSender ? rawBody.match(/^\[(.+?)\]:\s*/) : null;
  const messageSender = bridgeMatch ? bridgeMatch[1] : displayName;
  let messageContent = bridgeMatch ? rawBody.slice(bridgeMatch[0].length) : rawBody;

  // Strip reply fallback from body (lines starting with > )
  messageContent = messageContent.split('\n').filter(line => !/^> ?/.test(line)).join('\n').trim();

  // For image-only messages, body is just the filename — don't show it as text
  const displayContent = media ? '' : messageContent;

  const relatesTo = content['m.relates_to'] as { 'm.in_reply_to'?: { event_id: string } } | undefined;
  const replyToEventId = relatesTo?.['m.in_reply_to']?.event_id;

  return {
    id: event.getId() ?? crypto.randomUUID(),
    channelId,
    sender: messageSender,
    senderMatrixUserId: senderId,
    content: displayContent,
    timestamp: new Date(event.getTs()),
    msgType: content.msgtype,
    ...(media && { media }),
    ...(replyToEventId && { replyToEventId }),
  };
}

type ReactionContent = {
  'm.relates_to'?: {
    rel_type?: string;
    event_id?: string;
    key?: string;
  };
};

interface ReactionEventRecord {
  reactionEventId: string;
  targetEventId: string;
  emoji: string;
  senderId: string;
}

type ReplacementEventRecord = ParsedReplacementEvent;

function parseReactionEvent(event: MatrixEvent): ReactionEventRecord | null {
  if (event.getType() !== 'm.reaction') return null;
  const reactionEventId = event.getId();
  const senderId = event.getSender();
  const relatesTo = (event.getContent() as ReactionContent)['m.relates_to'];
  const targetEventId = relatesTo?.event_id;
  const emoji = relatesTo?.key;

  if (!reactionEventId || !senderId || !targetEventId || !emoji) return null;
  if (relatesTo?.rel_type && relatesTo.rel_type !== 'm.annotation') return null;

  return { reactionEventId, targetEventId, emoji, senderId };
}

function applyReactionToMessages(
  existing: ChatMessage[],
  reaction: ReactionEventRecord,
): ChatMessage[] {
  let changed = false;
  const updated = existing.map((message) => {
    if (message.id !== reaction.targetEventId) return message;
    const reactions = addReactionSender(message.reactions, reaction.emoji, reaction.senderId);
    if (reactions === message.reactions) return message;
    changed = true;
    return { ...message, reactions };
  });
  return changed ? updated : existing;
}

function removeReactionFromMessages(
  existing: ChatMessage[],
  reaction: ReactionEventRecord,
): ChatMessage[] {
  let changed = false;
  const updated = existing.map((message) => {
    if (message.id !== reaction.targetEventId) return message;
    const reactions = removeReactionSender(message.reactions, reaction.emoji, reaction.senderId);
    if (reactions === message.reactions) return message;
    changed = true;
    return { ...message, reactions };
  });
  return changed ? updated : existing;
}

type RedactionLikeEvent = {
  getType(): string;
  getId(): string | undefined;
  getRedacts?(): string | undefined;
  getContent?(): Record<string, unknown>;
};

function getRedactedEventId(event: RedactionLikeEvent): string | undefined {
  if (typeof event.getRedacts === 'function') {
    const id = event.getRedacts();
    if (id) return id;
  }
  const content = event.getContent?.() as { redacts?: string } | undefined;
  return content?.redacts;
}

function markMessageRedacted(
  existing: ChatMessage[],
  redactedEventId: string | undefined,
): ChatMessage[] {
  if (!redactedEventId) return existing;
  let changed = false;
  const updated = existing.map((message) => {
    if (message.id !== redactedEventId) return message;
    changed = true;
    return { ...message, redacted: true, content: '', media: undefined };
  });
  return changed ? updated : existing;
}

function applyReplacementToMessages(
  existing: ChatMessage[],
  replacement: ReplacementEventRecord,
): ChatMessage[] {
  let changed = false;
  const updated = existing.map((message) => {
    if (message.id !== replacement.targetEventId) return message;
    if (message.senderMatrixUserId && message.senderMatrixUserId !== replacement.senderId) return message;
    changed = true;
    return {
      ...message,
      content: replacement.body,
      edited: true,
      originalContent: message.originalContent ?? message.content,
      latestEditTimestamp: replacement.timestamp,
      latestEditEventId: replacement.editEventId,
    };
  });
  return changed ? updated : existing;
}

/**
 * Read all `m.room.message` events from a room's live timeline and transform
 * them into ChatMessages. Pure helper for active-message loading.
 *
 * Returns `[]` when the room cannot be resolved (caller's responsibility to
 * setState on the returned value).
 *
 * Optionally populates reactionEventsRef and ownReactionEventIdsRef to enable
 * removal of reactions loaded from timeline history.
 */
function loadMessagesFromTimeline(
  client: MatrixClient,
  roomId: string,
  targetId: string,
  currentUserId?: string,
  reactionEventsRef?: React.MutableRefObject<Map<string, ReactionEventRecord>>,
  ownReactionEventIdsRef?: React.MutableRefObject<Map<string, Map<string, string>>>,
  onReplacementEdit?: (replacement: ReplacementEventRecord) => void,
): ChatMessage[] {
  const room = client.getRoom(roomId);
  if (!room) return [];
  const out: ChatMessage[] = [];
  const pendingReactions: ReactionEventRecord[] = [];
  const pendingReplacements: ReplacementEventRecord[] = [];
  const redactedEventIds = new Set<string>();

  for (const ev of room.getLiveTimeline().getEvents()) {
    // Track redaction events
    if (ev.getType() === 'm.room.redaction') {
      const redactedId = getRedactedEventId(ev);
      if (redactedId) redactedEventIds.add(redactedId);
    }

    const m = transformEventToChatMessage(ev, room, targetId, client);
    if (m) {
      const bundled = parseBundledReplacementFromUnsigned(ev as never);
      if (bundled && !redactedEventIds.has(bundled.editEventId)) {
        pendingReplacements.push(bundled);
        onReplacementEdit?.(bundled);
      }
      // Mark message as redacted if already redacted or has redaction event
      const isEventRedacted = typeof ev.isRedacted === 'function' && ev.isRedacted();
      if (isEventRedacted || redactedEventIds.has(m.id)) {
        out.push({ ...m, redacted: true, content: '', media: undefined });
      } else {
        out.push(m);
      }
      continue;
    }

    const replacement = parseReplacementEvent(ev as never);
    if (replacement) {
      if (!redactedEventIds.has(replacement.editEventId)) {
        pendingReplacements.push(replacement);
        onReplacementEdit?.(replacement);
      }
      continue;
    }

    const reaction = parseReactionEvent(ev);
    if (reaction) {
      pendingReactions.push(reaction);
      
      // Track reaction events in refs so they can be removed later
      if (reactionEventsRef) {
        reactionEventsRef.current.set(reaction.reactionEventId, reaction);
      }
      
      // Track own reactions for removal
      if (ownReactionEventIdsRef && currentUserId && reaction.senderId === currentUserId) {
        const ownForMessage = ownReactionEventIdsRef.current.get(reaction.targetEventId) ?? new Map<string, string>();
        ownForMessage.set(reaction.emoji, reaction.reactionEventId);
        ownReactionEventIdsRef.current.set(reaction.targetEventId, ownForMessage);
      }
    }
  }

  const withReplacements = pendingReplacements.sort(compareReplacementEdits).reduce(applyReplacementToMessages, out);
  return pendingReactions.reduce(applyReactionToMessages, withReplacements);
}

export interface MatrixCredentials {
  homeserverUrl: string;
  accessToken: string;
  userId: string;
  roomMap: Record<string, string>; // mumbleChannelId → matrixRoomId
  dmRoomMap?: Record<string, string>; // matrixUserId → matrixRoomId (from server)
}

export interface MessagePreview {
  content: string;
  ts: number;
  sender: string;
}

interface MatrixClientOverlayCallbacks {
  onChannelMessage?: (channelId: string, message: ChatMessage) => void;
  onDirectMessage?: (matrixUserId: string, message: ChatMessage) => void;
  onUserAvatarChanged?: (matrixUserId: string, avatarUrl: string | null) => void;
}

export function useMatrixClient(
  credentials: MatrixCredentials | null,
  callbacks?: MatrixClientOverlayCallbacks,
) {
  const clientRef = useRef<MatrixClient | null>(null);
  const overlayLiveSinceRef = useRef<number | null>(null);
  const [client, setClient] = useState<MatrixClient | null>(null);
  const { updateStatus } = useServiceStatus();

  // Store callbacks in refs to avoid reconnect loops from object identity changes
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  // DM room tracking: matrixUserId -> roomId
  const [dmRoomMap, setDmRoomMap] = useState<Map<string, string>>(new Map());

  // Last-message previews: one entry per channel/DM user (bounded)
  const [lastMessages, setLastMessages] = useState<Map<string, MessagePreview>>(new Map());
  const [dmLastMessages, setDmLastMessages] = useState<Map<string, MessagePreview>>(new Map());

  // Active-only message state: only the currently-viewed channel/DM is loaded
  const [activeMessages, setActiveMessages] = useState<ChatMessage[]>([]);
  const [activeDmMessages, setActiveDmMessages] = useState<ChatMessage[]>([]);
  const [activeTypingText, setActiveTypingText] = useState<string | null>(null);
  const activeChannelIdRef = useRef<string | null>(null);
  const activeDmContactIdRef = useRef<string | null>(null);
  const activeRoomVersionRef = useRef(0);
  const activeDmVersionRef = useRef(0);
  const roomTypingRef = useRef<Map<string, TypingEntry[]>>(new Map());
  const typingExpiryTimerRef = useRef<number | null>(null);
  const localTypingRoomRef = useRef<string | null>(null);
  const localTypingLastSentAtRef = useRef<number | null>(null);
  const localTypingRefreshTimerRef = useRef<number | null>(null);

  const dmRoomMapRef = useRef<Map<string, string>>(new Map());
  // Keep ref in sync
  useEffect(() => { dmRoomMapRef.current = dmRoomMap; }, [dmRoomMap]);

  const roomIdToDMUserIdRef = useRef<Map<string, string>>(new Map());
  const pendingRoomCreations = useRef(new Map<string, Promise<string>>());
  const lastSyncStateRef = useRef<string | null>(null);
  const waitForRoomRef = useRef<((roomId: string, timeoutMs?: number) => Promise<Room>) | null>(null);
  const reactionEventsRef = useRef<Map<string, ReactionEventRecord>>(new Map());
  const ownReactionEventIdsRef = useRef<Map<string, Map<string, string>>>(new Map());
  const replacementEventsByEditIdRef = useRef<Map<string, ReplacementEventRecord>>(new Map());
  const replacementEditsByTargetRef = useRef<Map<string, ReplacementEventRecord[]>>(new Map());

  const rememberReplacementEdit = useCallback((replacement: ReplacementEventRecord) => {
    replacementEventsByEditIdRef.current.set(replacement.editEventId, replacement);
    const existing = replacementEditsByTargetRef.current.get(replacement.targetEventId) ?? [];
    const filtered = existing.filter((item) => item.editEventId !== replacement.editEventId);
    filtered.push(replacement);
    filtered.sort(compareReplacementEdits);
    replacementEditsByTargetRef.current.set(replacement.targetEventId, filtered);
  }, []);

  const forgetReplacementEdit = useCallback((editEventId: string): { targetEventId: string; latestRemaining: ReplacementEventRecord | null } | null => {
    const replacement = replacementEventsByEditIdRef.current.get(editEventId);
    if (!replacement) return null;
    replacementEventsByEditIdRef.current.delete(editEventId);
    const existing = replacementEditsByTargetRef.current.get(replacement.targetEventId) ?? [];
    const next = existing.filter((item) => item.editEventId !== editEventId);
    if (next.length === 0) {
      replacementEditsByTargetRef.current.delete(replacement.targetEventId);
    } else {
      replacementEditsByTargetRef.current.set(replacement.targetEventId, next);
    }
    return {
      targetEventId: replacement.targetEventId,
      latestRemaining: next.length > 0 ? next[next.length - 1] : null,
    };
  }, []);

  // Reverse lookup: matrixRoomId → mumbleChannelId
  const roomIdToChannelId = useMemo(() => {
    if (!credentials) return new Map<string, string>();
    return new Map(
      Object.entries(credentials.roomMap).map(([channelId, roomId]) => [roomId, channelId])
    );
  }, [credentials]);

  const getActiveMatrixRoomId = useCallback((): string | null => {
    if (activeChannelIdRef.current && credentials?.roomMap[activeChannelIdRef.current]) {
      return credentials.roomMap[activeChannelIdRef.current];
    }
    if (activeDmContactIdRef.current) {
      return dmRoomMapRef.current.get(activeDmContactIdRef.current) ?? null;
    }
    return null;
  }, [credentials]);

  const refreshActiveTypingText = useCallback(() => {
    const activeRoomId = getActiveMatrixRoomId();
    if (!activeRoomId) {
      setActiveTypingText(null);
      return;
    }
    const names = (roomTypingRef.current.get(activeRoomId) ?? []).map((entry) => entry.displayName);
    setActiveTypingText(formatTypingIndicator(names));
  }, [getActiveMatrixRoomId]);

  const scheduleTypingExpirySweep = useCallback(() => {
    if (typingExpiryTimerRef.current !== null) {
      window.clearTimeout(typingExpiryTimerRef.current);
      typingExpiryTimerRef.current = null;
    }

    let nextExpiry: number | null = null;
    const now = Date.now();
    for (const [roomId, entries] of roomTypingRef.current) {
      const fresh = entries.filter((entry) => entry.expiresAt > now);
      roomTypingRef.current.set(roomId, fresh);
      for (const entry of fresh) {
        nextExpiry = nextExpiry === null ? entry.expiresAt : Math.min(nextExpiry, entry.expiresAt);
      }
    }

    refreshActiveTypingText();
    if (nextExpiry !== null) {
      typingExpiryTimerRef.current = window.setTimeout(scheduleTypingExpirySweep, Math.max(0, nextExpiry - now + 1));
    }
  }, [refreshActiveTypingText]);

  const replaceRoomTypingFromMembers = useCallback((room: Room | undefined, roomId: string, now: number) => {
    const members = typeof room?.getMembers === 'function' ? room.getMembers() : [];
    const nextEntries = members
      .filter((member) => member.typing)
      .filter((member) => member.userId !== credentials?.userId)
      .map((member) => ({
        userId: member.userId,
        displayName: member.name || member.rawDisplayName || member.userId,
        expiresAt: now + TYPING_TIMEOUT_MS,
      }));

    roomTypingRef.current.set(roomId, nextEntries);
    refreshActiveTypingText();
    scheduleTypingExpirySweep();
  }, [credentials?.userId, refreshActiveTypingText, scheduleTypingExpirySweep]);

  const hydrateRoomTypingFromCurrentMembers = useCallback((roomId: string | null) => {
    if (!roomId) {
      setActiveTypingText(null);
      return;
    }
    const room = clientRef.current?.getRoom(roomId) ?? undefined;
    replaceRoomTypingFromMembers(room, roomId, Date.now());
  }, [replaceRoomTypingFromMembers]);

  const clearLocalTypingState = useCallback(() => {
    if (localTypingRefreshTimerRef.current !== null) {
      window.clearTimeout(localTypingRefreshTimerRef.current);
      localTypingRefreshTimerRef.current = null;
    }
    localTypingRoomRef.current = null;
    localTypingLastSentAtRef.current = null;
  }, []);

  const stopTypingForRoom = useCallback(async (roomId: string | null) => {
    if (!clientRef.current || !roomId) return;
    try {
      await clientRef.current.sendTyping(roomId, false, 0);
    } catch (err) {
      console.warn('[Matrix] Failed to stop typing:', err);
    }
  }, []);

  useEffect(() => {
    if (!credentials) {
      if (localTypingRoomRef.current) {
        void stopTypingForRoom(localTypingRoomRef.current);
      }
      clientRef.current?.stopClient();
      clientRef.current = null;
      overlayLiveSinceRef.current = null;
      setClient(null);
      setLastMessages(new Map());
      setDmLastMessages(new Map());
      setActiveMessages([]);
      setActiveDmMessages([]);
      setActiveTypingText(null);
      activeChannelIdRef.current = null;
      activeDmContactIdRef.current = null;
      setDmRoomMap(new Map());
      dmRoomMapRef.current = new Map();
      roomIdToDMUserIdRef.current = new Map();
      lastSyncStateRef.current = null;
      reactionEventsRef.current.clear();
      ownReactionEventIdsRef.current.clear();
      replacementEventsByEditIdRef.current.clear();
      replacementEditsByTargetRef.current.clear();
      roomTypingRef.current.clear();
      if (typingExpiryTimerRef.current !== null) {
        window.clearTimeout(typingExpiryTimerRef.current);
        typingExpiryTimerRef.current = null;
      }
      clearLocalTypingState();
      updateStatus('chat', { state: 'idle', error: undefined });
      return;
    }

    const client = createClient({
      baseUrl: credentials.homeserverUrl,
      accessToken: credentials.accessToken,
      userId: credentials.userId,
    });

    let isPrepared = false;
    const bufferedDmEvents: Array<{ room: Room | undefined; event: MatrixEvent }> = [];

    const shouldPublishOverlayEvent = (
      event: MatrixEvent,
      data?: { liveEvent?: boolean } | null,
    ): boolean => {
      const liveSince = overlayLiveSinceRef.current;
      if (!isPrepared || liveSince === null) return false;
      if (data && typeof data.liveEvent === 'boolean' && !data.liveEvent) return false;
      return event.getTs() >= liveSince;
    };

    const onMemberChanged = (_event: MatrixEvent, _state: RoomState, member: RoomMember) => {
      if (!member.userId || !member.getAvatarUrl) return;
      const avatarUrl = member.getAvatarUrl(client.baseUrl, 128, 128, 'crop', false, false);
      callbacksRef.current?.onUserAvatarChanged?.(member.userId, avatarUrl ?? null);
    };

    const onMemberTyping = (event: MatrixEvent, member: RoomMember) => {
      const roomId = event.getRoomId() ?? (member as RoomMember & { roomId?: string }).roomId;
      if (!roomId) return;
      const room = clientRef.current?.getRoom(roomId) ?? undefined;
      replaceRoomTypingFromMembers(room, roomId, Date.now());
    };

    const onTimeline = (
      event: MatrixEvent,
      room: Room | undefined,
      _toStartOfTimeline?: boolean,
      _removed?: boolean,
      data?: { liveEvent?: boolean } | null,
    ) => {
      const eventType = event.getType();

      const replacement = parseReplacementEvent(event as never);
      if (replacement) {
        rememberReplacementEdit(replacement);
        const channelId = roomIdToChannelId.get(room?.roomId ?? '');
        if (channelId && activeChannelIdRef.current === channelId) {
          setActiveMessages(prev => applyReplacementToMessages(prev, replacement));
        }
        const dmUserId = roomIdToDMUserIdRef.current.get(room?.roomId ?? '');
        if (dmUserId && activeDmContactIdRef.current === dmUserId) {
          setActiveDmMessages(prev => applyReplacementToMessages(prev, replacement));
        }
        return;
      }

      if (eventType === 'm.reaction') {
        const reaction = parseReactionEvent(event);
        if (!reaction) return;
        reactionEventsRef.current.set(reaction.reactionEventId, reaction);

        if (credentials && reaction.senderId === credentials.userId) {
          const existing = ownReactionEventIdsRef.current.get(reaction.targetEventId) ?? new Map<string, string>();
          existing.set(reaction.emoji, reaction.reactionEventId);
          ownReactionEventIdsRef.current.set(reaction.targetEventId, existing);
        }

        const channelId = roomIdToChannelId.get(room?.roomId ?? '');
        if (channelId && activeChannelIdRef.current === channelId) {
          setActiveMessages(prev => applyReactionToMessages(prev, reaction));
          return;
        }

        const dmUserId = roomIdToDMUserIdRef.current.get(room?.roomId ?? '');
        if (dmUserId && activeDmContactIdRef.current === dmUserId) {
          setActiveDmMessages(prev => applyReactionToMessages(prev, reaction));
        }
        return;
      }

      if (eventType === EventType.RoomRedaction) {
        const redactedEventId = getRedactedEventId(event as unknown as RedactionLikeEvent);
        if (redactedEventId) {
          const replacementState = forgetReplacementEdit(redactedEventId);
          if (replacementState) {
            const { targetEventId, latestRemaining } = replacementState;
            const applyRevert = (existing: ChatMessage[]) => existing.map((message) => {
              if (message.id !== targetEventId) return message;
              if (latestRemaining && (!message.senderMatrixUserId || message.senderMatrixUserId === latestRemaining.senderId)) {
                return {
                  ...message,
                  content: latestRemaining.body,
                  edited: true,
                  latestEditTimestamp: latestRemaining.timestamp,
                  latestEditEventId: latestRemaining.editEventId,
                };
              }
              return {
                ...message,
                content: message.originalContent ?? message.content,
                edited: false,
                latestEditTimestamp: undefined,
                latestEditEventId: undefined,
              };
            });
            setActiveMessages(prev => applyRevert(prev));
            setActiveDmMessages(prev => applyRevert(prev));
            return;
          }
        }
        const redactedReaction = redactedEventId ? reactionEventsRef.current.get(redactedEventId) : undefined;
        if (redactedReaction && redactedEventId) {
          reactionEventsRef.current.delete(redactedEventId);

          const ownForMessage = ownReactionEventIdsRef.current.get(redactedReaction.targetEventId);
          if (ownForMessage?.get(redactedReaction.emoji) === redactedEventId) {
            ownForMessage.delete(redactedReaction.emoji);
            if (ownForMessage.size === 0) {
              ownReactionEventIdsRef.current.delete(redactedReaction.targetEventId);
            }
          }

          const channelId = roomIdToChannelId.get(room?.roomId ?? '');
          if (channelId && activeChannelIdRef.current === channelId) {
            setActiveMessages(prev => removeReactionFromMessages(prev, redactedReaction));
            return;
          }

          const dmUserId = roomIdToDMUserIdRef.current.get(room?.roomId ?? '');
          if (dmUserId && activeDmContactIdRef.current === dmUserId) {
            setActiveDmMessages(prev => removeReactionFromMessages(prev, redactedReaction));
          }
          return;
        }

        const channelId2 = roomIdToChannelId.get(room?.roomId ?? '');
        if (channelId2 && activeChannelIdRef.current === channelId2) {
          setActiveMessages(prev => markMessageRedacted(prev, redactedEventId));
          return;
        }

        const dmUserId2 = roomIdToDMUserIdRef.current.get(room?.roomId ?? '');
        if (dmUserId2 && activeDmContactIdRef.current === dmUserId2) {
          setActiveDmMessages(prev => markMessageRedacted(prev, redactedEventId));
        }
        return;
      }

      if (eventType !== EventType.RoomMessage) return;
      const channelId = roomIdToChannelId.get(room?.roomId ?? '');
      if (channelId) {
        const message = transformEventToChatMessage(event, room, channelId, clientRef.current);
        if (!message) return;
        
        // Apply cached replacement edits if any exist for this message
        const cachedReplacements = replacementEditsByTargetRef.current.get(message.id);
        if (cachedReplacements && cachedReplacements.length > 0) {
          const latestEdit = cachedReplacements[cachedReplacements.length - 1];
          message.content = latestEdit.body;
          message.edited = true;
          message.latestEditTimestamp = latestEdit.timestamp;
          message.latestEditEventId = latestEdit.editEventId;
        }
        
        if (credentials && message.senderMatrixUserId !== credentials.userId && shouldPublishOverlayEvent(event, data)) {
          callbacksRef.current?.onChannelMessage?.(channelId, message);
        }

        setLastMessages(prev => {
          const existing = prev.get(channelId);
          if (existing && existing.ts >= message.timestamp.getTime()) return prev;
          const next = new Map(prev);
          next.set(channelId, {
            content: message.content,
            ts: message.timestamp.getTime(),
            sender: message.sender,
          });
          return next;
        });
        if (activeChannelIdRef.current === channelId) {
          setActiveMessages(prev => {
            const updated = insertMessage(prev, message);
            return updated === prev ? prev : updated;
          });
        }
        return;
      }

      // DM message handling
      const dmUserId = roomIdToDMUserIdRef.current.get(room?.roomId ?? '');
      if (!dmUserId) {
        if (!isPrepared && room?.roomId) {
          bufferedDmEvents.push({ room, event });
        }
        return;
      }

      const dmMessage = transformEventToChatMessage(event, room, dmUserId, clientRef.current);
      if (!dmMessage) return;
      
      // Apply cached replacement edits if any exist for this message
      const cachedReplacements = replacementEditsByTargetRef.current.get(dmMessage.id);
      if (cachedReplacements && cachedReplacements.length > 0) {
        const latestEdit = cachedReplacements[cachedReplacements.length - 1];
        dmMessage.content = latestEdit.body;
        dmMessage.edited = true;
        dmMessage.latestEditTimestamp = latestEdit.timestamp;
        dmMessage.latestEditEventId = latestEdit.editEventId;
      }
      
      if (credentials && dmMessage.senderMatrixUserId !== credentials.userId && shouldPublishOverlayEvent(event, data)) {
        callbacksRef.current?.onDirectMessage?.(dmUserId, dmMessage);
      }

      setDmLastMessages(prev => {
        const existing = prev.get(dmUserId);
        if (existing && existing.ts >= dmMessage.timestamp.getTime()) return prev;
        const next = new Map(prev);
        next.set(dmUserId, {
          content: dmMessage.content,
          ts: dmMessage.timestamp.getTime(),
          sender: dmMessage.sender,
        });
        return next;
      });
      if (activeDmContactIdRef.current === dmUserId) {
        setActiveDmMessages(prev => {
          const updated = insertMessage(prev, dmMessage);
          return updated === prev ? prev : updated;
        });
      }
    };

    client.on(RoomEvent.Timeline, onTimeline);
    client.on(RoomStateEvent.Members, onMemberChanged);
    client.on(RoomMemberEvent.Typing, onMemberTyping);
    updateStatus('chat', { state: 'connecting', error: undefined });
    client.startClient({ initialSyncLimit: 5 });
    clientRef.current = client;
    setClient(client);

    const onSync = (state: string) => {
      let derivedState: string;
      if (state === 'PREPARED' || state === 'SYNCING') {
        derivedState = 'connected';
        if (state === 'PREPARED') {
          isPrepared = true;
          // Only publish overlay messages for events that arrive after initial sync completes.
          // This prevents the companion speech balloon from replaying message history.
          overlayLiveSinceRef.current = Date.now();

          // Server-provided DM room map is the sole source of truth
          if (credentials.dmRoomMap) {
            const serverDmMap = new Map<string, string>();
            const serverRoomToUser = new Map<string, string>();
            for (const [userId, roomId] of Object.entries(credentials.dmRoomMap)) {
              serverDmMap.set(userId, roomId);
              serverRoomToUser.set(roomId, userId);
            }
            dmRoomMapRef.current = serverDmMap;
            roomIdToDMUserIdRef.current = serverRoomToUser;
            setDmRoomMap(serverDmMap);
          }

          // Replay any DM timeline events that arrived before room maps were ready
          for (const { room, event } of bufferedDmEvents) {
            onTimeline(event, room, undefined, undefined, { liveEvent: false });
          }
          bufferedDmEvents.length = 0;

          // Bootstrap last-message previews from the SDK timelines now
          // that initial sync is complete. This avoids waiting for new
          // RoomEvent.Timeline events to populate the sidebar.
          const bootChannelPreviews = new Map<string, MessagePreview>();
          const bootDmPreviews = new Map<string, MessagePreview>();
          for (const room of client.getRooms()) {
            const channelId = roomIdToChannelId.get(room.roomId);
            const dmUserId = roomIdToDMUserIdRef.current.get(room.roomId);
            const target = channelId ?? dmUserId;
            if (!target) continue;

            const events = room.getLiveTimeline().getEvents();
            for (let i = events.length - 1; i >= 0; i--) {
              const ev = events[i];
              if (ev.getType() !== EventType.RoomMessage) continue;
              const msg = transformEventToChatMessage(ev, room, target, clientRef.current);
              if (!msg) continue;
              const preview: MessagePreview = {
                content: msg.content,
                ts: msg.timestamp.getTime(),
                sender: msg.sender,
              };
              if (channelId) bootChannelPreviews.set(channelId, preview);
              else if (dmUserId) bootDmPreviews.set(dmUserId, preview);
              break;
            }
          }
          if (bootChannelPreviews.size > 0) setLastMessages(bootChannelPreviews);
          if (bootDmPreviews.size > 0) setDmLastMessages(bootDmPreviews);

          // If a channel/DM was activated before PREPARED finished, re-run
          // the load now that the SDK has the room and its timeline.
          // Bumping the version invalidates any earlier load that committed
          // an empty array against this same channel/DM id.
          if (activeChannelIdRef.current && credentials) {
            const channelId = activeChannelIdRef.current;
            const roomId = credentials.roomMap[channelId];
            if (roomId) {
              activeRoomVersionRef.current += 1;
              const myVersion = activeRoomVersionRef.current;
              const messages = loadMessagesFromTimeline(client, roomId, channelId, credentials.userId, reactionEventsRef, ownReactionEventIdsRef, rememberReplacementEdit);
              if (activeRoomVersionRef.current === myVersion) {
                setActiveMessages(messages);
              }
            }
          }
          if (activeDmContactIdRef.current) {
            const dmContactId = activeDmContactIdRef.current;
            const dmRoomId = dmRoomMapRef.current.get(dmContactId);
            if (dmRoomId) {
              activeDmVersionRef.current += 1;
              const myVersion = activeDmVersionRef.current;
              const messages = loadMessagesFromTimeline(client, dmRoomId, dmContactId, credentials.userId, reactionEventsRef, ownReactionEventIdsRef, rememberReplacementEdit);
              if (activeDmVersionRef.current === myVersion) {
                setActiveDmMessages(messages);
              }
            }
          }
        }
      } else if (state === 'ERROR') {
        derivedState = 'disconnected';
      } else if (state === 'RECONNECTING') {
        derivedState = 'connecting';
      } else if (state === 'STOPPED') {
        derivedState = 'disconnected';
      } else {
        return;
      }

      if (derivedState === lastSyncStateRef.current) return;
      lastSyncStateRef.current = derivedState;

      if (derivedState === 'connected') {
        updateStatus('chat', { state: 'connected', error: undefined });
      } else if (state === 'ERROR') {
        updateStatus('chat', { state: 'disconnected', error: 'Sync error' });
      } else if (derivedState === 'connecting') {
        updateStatus('chat', { state: 'connecting', error: undefined });
      } else {
        updateStatus('chat', { state: 'disconnected' });
      }
    };

    /** Register a newly-discovered DM room in local maps. If this room is the
     *  currently active DM contact, also rebuild activeDmMessages from its
     *  timeline (version-guarded against rapid contact switches). */
    const registerDMRoom = (room: Room, otherUserId: string) => {
      if (roomIdToDMUserIdRef.current.has(room.roomId)) return;

      setDmRoomMap(prev => new Map(prev).set(otherUserId, room.roomId));
      dmRoomMapRef.current = new Map(dmRoomMapRef.current).set(otherUserId, room.roomId);
      roomIdToDMUserIdRef.current = new Map(roomIdToDMUserIdRef.current).set(room.roomId, otherUserId);

      const timelineEvents = room.getLiveTimeline().getEvents();

      for (let i = timelineEvents.length - 1; i >= 0; i--) {
        const ev = timelineEvents[i];
        if (ev.getType() !== EventType.RoomMessage) continue;
        const msg = transformEventToChatMessage(ev, room, otherUserId, clientRef.current);
        if (!msg) continue;
        setDmLastMessages(prev => {
          const existing = prev.get(otherUserId);
          if (existing && existing.ts >= msg.timestamp.getTime()) return prev;
          const next = new Map(prev);
          next.set(otherUserId, { content: msg.content, ts: msg.timestamp.getTime(), sender: msg.sender });
          return next;
        });
        break;
      }

      if (activeDmContactIdRef.current === otherUserId) {
        activeDmVersionRef.current += 1;
        const myVersion = activeDmVersionRef.current;
        const messages: ChatMessage[] = [];
        for (const ev of timelineEvents) {
          const m = transformEventToChatMessage(ev, room, otherUserId, clientRef.current);
          if (m) messages.push(m);
        }
        if (activeDmVersionRef.current === myVersion) {
          setActiveDmMessages(messages);
        }
      }
    };

    const onMyMembership = (room: Room, membership: string) => {
      if (membership === KnownMembership.Invite) {
        // Auto-join DM invites (server creates rooms and invites both users)
        const inviter = room.getDMInviter();
        if (!inviter) return;
        client.joinRoom(room.roomId).then(() => {
          registerDMRoom(room, inviter);
        }).catch(err => {
          console.warn(`[Matrix] Failed to auto-join DM room ${room.roomId}:`, err);
        });
      } else if (membership === KnownMembership.Join && isPrepared) {
        // Server already auto-joined us via the appservice — register the room.
        // The isPrepared guard ensures we only pick up rooms that appear AFTER
        // initial sync, not old pre-migration rooms the SDK already knows about.
        //
        // getDMInviter() returns null for force-joined users (the appservice
        // bypasses normal invite→join flow), so we determine the other user
        // from the room's joined members instead.
        const inviter = room.getDMInviter();
        if (inviter) {
          registerDMRoom(room, inviter);
        } else {
          // Look up the other user from room members
          const members = room.getJoinedMembers();
          const myUserId = credentials.userId;
          const otherMember = members.find(m => m.userId !== myUserId);
          if (otherMember) {
            registerDMRoom(room, otherMember.userId);
          }
        }
      }
    };

    client.on(ClientEvent.Sync, onSync);
    client.on(RoomEvent.MyMembership, onMyMembership);

    // Wait for the SDK to sync a room into its local store (server-created rooms
    // may not be available immediately after the server responds).
    const waitForRoom = (roomId: string, timeoutMs = 10000): Promise<Room> => {
      const existing = clientRef.current?.getRoom(roomId);
      if (existing) return Promise.resolve(existing);

      return new Promise<Room>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out waiting for room ${roomId} to appear in SDK`));
        }, timeoutMs);

        const onMyMembershipCheck = (room: Room) => {
          if (room.roomId === roomId) {
            cleanup();
            resolve(room);
          }
        };

        // Also check on every sync in case the room appears without a membership event
        const onSyncCheck = () => {
          const room = clientRef.current?.getRoom(roomId);
          if (room) {
            cleanup();
            resolve(room);
          }
        };

        const cleanup = () => {
          clearTimeout(timer);
          clientRef.current?.off(RoomEvent.MyMembership, onMyMembershipCheck);
          clientRef.current?.off(ClientEvent.Sync, onSyncCheck);
        };

        clientRef.current?.on(RoomEvent.MyMembership, onMyMembershipCheck);
        clientRef.current?.on(ClientEvent.Sync, onSyncCheck);
      });
    };

    waitForRoomRef.current = waitForRoom;

    return () => {
      waitForRoomRef.current = null;
      if (typingExpiryTimerRef.current !== null) {
        window.clearTimeout(typingExpiryTimerRef.current);
        typingExpiryTimerRef.current = null;
      }
      if (localTypingRoomRef.current) {
        void stopTypingForRoom(localTypingRoomRef.current);
      }
      clearLocalTypingState();
      roomTypingRef.current.clear();
      setActiveTypingText(null);
      client.off(RoomEvent.Timeline, onTimeline);
      client.off(RoomStateEvent.Members, onMemberChanged);
      client.off(RoomMemberEvent.Typing, onMemberTyping);
      client.off(ClientEvent.Sync, onSync);
      client.off(RoomEvent.MyMembership, onMyMembership);
      client.stopClient();
      clientRef.current = null;
      setClient(null);
      updateStatus('chat', { state: 'idle', error: undefined });
    };
  }, [clearLocalTypingState, credentials, forgetReplacementEdit, rememberReplacementEdit, replaceRoomTypingFromMembers, roomIdToChannelId, stopTypingForRoom, updateStatus]);

  const sendMessage = useCallback(async (channelId: string, text: string) => {
    if (!credentials || !clientRef.current) return;
    const roomId = credentials.roomMap[channelId];
    if (!roomId) return;
    await clientRef.current.sendMessage(roomId, { msgtype: MsgType.Text, body: text });
    await stopTypingForRoom(roomId);
    clearLocalTypingState();
  }, [clearLocalTypingState, credentials, stopTypingForRoom]);

  const sendImageMessage = useCallback(async (channelId: string, file: File, mxcUrl: string) => {
    if (!credentials || !clientRef.current) return;
    const roomId = credentials.roomMap[channelId];
    if (!roomId) return;
    await clientRef.current.sendMessage(roomId, {
      msgtype: MsgType.Image,
      url: mxcUrl,
      body: file.name,
      info: {
        mimetype: file.type,
        size: file.size,
      },
    });
  }, [credentials]);

  const uploadContent = useCallback(async (file: File): Promise<string> => {
    if (!clientRef.current) throw new Error('Matrix client not initialized');
    const response = await clientRef.current.uploadContent(file, {
      type: file.type,
      name: file.name,
    });
    return response.content_uri;
  }, []);

  const fetchHistory = useCallback(async (channelId: string) => {
    if (!credentials || !clientRef.current) return;
    const roomId = credentials.roomMap[channelId];
    if (!roomId) return;
    const room = clientRef.current.getRoom(roomId);
    if (!room) return;
    await clientRef.current.scrollback(room, 50);
  }, [credentials]);

  const sendDMMessage = useCallback(async (targetMatrixUserId: string, text: string) => {
    const client = clientRef.current;
    if (!client || !credentials) return;

    let roomId = dmRoomMapRef.current.get(targetMatrixUserId);

    if (!roomId) {
      // Check if a room resolution is already in flight for this user
      const pending = pendingRoomCreations.current.get(targetMatrixUserId);
      if (pending) {
        roomId = await pending;
      } else {
        // Request room from server via bridge (server creates if needed)
        const resolvePromise = new Promise<string>((resolve, reject) => {
          let settled = false;
          const cleanup = () => {
            bridge.off('dm.roomResolved', onResolved);
            bridge.off('dm.roomError', onError);
            clearTimeout(timeout);
          };
          const onResolved = (data: unknown) => {
            const d = data as { targetMatrixUserId?: string; roomId?: string };
            if (d?.targetMatrixUserId === targetMatrixUserId && d?.roomId) {
              settled = true;
              cleanup();
              resolve(d.roomId);
            }
          };
          const onError = (data: unknown) => {
            const d = data as { targetMatrixUserId?: string; error?: string };
            if (d?.targetMatrixUserId === targetMatrixUserId) {
              settled = true;
              cleanup();
              reject(new Error(d?.error || 'Failed to get DM room'));
            }
          };
          const timeout = setTimeout(() => {
            if (!settled) {
              settled = true;
              cleanup();
              reject(new Error('DM room creation timed out'));
            }
          }, 15_000);
          bridge.on('dm.roomResolved', onResolved);
          bridge.on('dm.roomError', onError);
          bridge.send('dm.getOrCreateRoom', { targetMatrixUserId });
        });

        pendingRoomCreations.current.set(targetMatrixUserId, resolvePromise);
        try {
          roomId = await resolvePromise;

          // Update local maps
          setDmRoomMap(prev => new Map(prev).set(targetMatrixUserId, roomId!));
          dmRoomMapRef.current = new Map(dmRoomMapRef.current).set(targetMatrixUserId, roomId);
          roomIdToDMUserIdRef.current = new Map(roomIdToDMUserIdRef.current).set(roomId, targetMatrixUserId);
        } finally {
          pendingRoomCreations.current.delete(targetMatrixUserId);
        }
      }
    }

    // Ensure the SDK has synced the room before sending — the server may have
    // just created it via appservice and the local store doesn't know about it yet.
    if (waitForRoomRef.current) {
      try {
        await waitForRoomRef.current(roomId);
      } catch (err) {
        // Room may not be in local store yet; attempt send anyway
      }
    }

    await client.sendMessage(roomId, { msgtype: MsgType.Text, body: text });
  }, [credentials]);

  const fetchDMHistory = useCallback(async (targetMatrixUserId: string) => {
    const client = clientRef.current;
    if (!client) return;

    const roomId = dmRoomMapRef.current.get(targetMatrixUserId);
    if (!roomId) return;

    const room = client.getRoom(roomId);
    if (!room) return;

    await client.scrollback(room, 50);
  }, []);

  const fetchAvatarUrl = useCallback(async (userId: string): Promise<string | null> => {
    if (!clientRef.current) return null;
    try {
      const profile = await clientRef.current.getProfileInfo(userId);
      if (profile.avatar_url) {
        return clientRef.current.mxcUrlToHttp(profile.avatar_url, 128, 128, 'crop') || null;
      }
    } catch (e) {
      console.debug('Failed to fetch avatar for', userId, e);
    }
    return null;
  }, []);

  const startTyping = useCallback(async (targetId: string) => {
    const roomId = credentials?.roomMap[targetId] ?? dmRoomMapRef.current.get(targetId);
    if (!clientRef.current || !roomId) return;

    const now = Date.now();
    if (
      localTypingRoomRef.current !== roomId
      || localTypingLastSentAtRef.current === null
      || now - localTypingLastSentAtRef.current >= TYPING_REFRESH_MS
    ) {
      try {
        await clientRef.current.sendTyping(roomId, true, TYPING_TIMEOUT_MS);
        localTypingRoomRef.current = roomId;
        localTypingLastSentAtRef.current = now;
        if (localTypingRefreshTimerRef.current !== null) {
          window.clearTimeout(localTypingRefreshTimerRef.current);
        }
        localTypingRefreshTimerRef.current = window.setTimeout(() => {
          void startTyping(targetId);
        }, TYPING_REFRESH_MS);
      } catch (err) {
        console.warn('[Matrix] Failed to send typing update:', err);
      }
    }
  }, [credentials]);

  const stopTyping = useCallback(async (targetId: string) => {
    const roomId = credentials?.roomMap[targetId] ?? dmRoomMapRef.current.get(targetId) ?? localTypingRoomRef.current;
    clearLocalTypingState();
    await stopTypingForRoom(roomId);
  }, [clearLocalTypingState, credentials, stopTypingForRoom]);

  const setActiveChannel = useCallback((channelId: string | null) => {
    const previousRoomId = getActiveMatrixRoomId();
    activeRoomVersionRef.current += 1;
    const myVersion = activeRoomVersionRef.current;
    activeDmContactIdRef.current = null;
    activeChannelIdRef.current = channelId;
    const nextRoomId = getActiveMatrixRoomId();
    if (previousRoomId && previousRoomId !== nextRoomId) {
      void stopTypingForRoom(previousRoomId);
      clearLocalTypingState();
    }

    if (!channelId) {
      setActiveMessages([]);
      hydrateRoomTypingFromCurrentMembers(nextRoomId);
      return;
    }
    const client = clientRef.current;
    if (!credentials || !client) {
      setActiveMessages([]);
      return;
    }
    const roomId = credentials.roomMap[channelId];
    if (!roomId) {
      setActiveMessages([]);
      hydrateRoomTypingFromCurrentMembers(nextRoomId);
      return;
    }
    const messages = loadMessagesFromTimeline(client, roomId, channelId, credentials.userId, reactionEventsRef, ownReactionEventIdsRef, rememberReplacementEdit);

    if (activeRoomVersionRef.current === myVersion) {
      setActiveMessages(messages);
    }
    hydrateRoomTypingFromCurrentMembers(nextRoomId);
  }, [clearLocalTypingState, credentials, getActiveMatrixRoomId, hydrateRoomTypingFromCurrentMembers, rememberReplacementEdit, stopTypingForRoom]);

  // No deps: dmRoomMapRef is mutable and always reflects the latest map.
  const setActiveDmContact = useCallback((matrixUserId: string | null) => {
    const previousRoomId = getActiveMatrixRoomId();
    activeDmVersionRef.current += 1;
    const myVersion = activeDmVersionRef.current;
    activeChannelIdRef.current = null;
    activeDmContactIdRef.current = matrixUserId;
    const nextRoomId = getActiveMatrixRoomId();
    if (previousRoomId && previousRoomId !== nextRoomId) {
      void stopTypingForRoom(previousRoomId);
      clearLocalTypingState();
    }

    if (!matrixUserId) {
      setActiveDmMessages([]);
      hydrateRoomTypingFromCurrentMembers(nextRoomId);
      return;
    }
    const client = clientRef.current;
    if (!client) {
      setActiveDmMessages([]);
      return;
    }
    const roomId = dmRoomMapRef.current.get(matrixUserId);
    if (!roomId) {
      setActiveDmMessages([]);
      hydrateRoomTypingFromCurrentMembers(nextRoomId);
      return;
    }
    const messages = loadMessagesFromTimeline(client, roomId, matrixUserId, credentials?.userId, reactionEventsRef, ownReactionEventIdsRef, rememberReplacementEdit);

    if (activeDmVersionRef.current === myVersion) {
      setActiveDmMessages(messages);
    }
    hydrateRoomTypingFromCurrentMembers(nextRoomId);
  }, [clearLocalTypingState, credentials?.userId, getActiveMatrixRoomId, hydrateRoomTypingFromCurrentMembers, rememberReplacementEdit, stopTypingForRoom]);

  // Resolve display names for DM partners from Matrix room membership.
  // This works even when the other user isn't connected to Mumble.
  const dmUserDisplayNames = useMemo(() => {
    const names = new Map<string, string>();
    if (!client || !dmRoomMap) return names;
    const myUserId = credentials?.userId;
    for (const [matrixUserId, roomId] of dmRoomMap) {
      const room = client.getRoom(roomId);
      if (!room) continue;
      // Try to find the other member's display name from room state
      const member = room.getMember(matrixUserId);
      if (member?.name && member.name !== matrixUserId) {
        names.set(matrixUserId, member.name);
      } else {
        // Fallback: scan all joined/invited members for anyone who isn't us
        const members = room.getMembers();
        for (const m of members) {
          if (m.userId !== myUserId && m.name && m.name !== m.userId) {
            names.set(matrixUserId, m.name);
            break;
          }
        }
      }
    }
    return names;
  }, [client, dmRoomMap, credentials?.userId]);

  // Resolve avatar URLs for DM partners from Matrix room membership.
  // This works even when the other user isn't connected to Mumble.
  const dmUserAvatarUrls = useMemo(() => {
    const urls = new Map<string, string>();
    if (!client || !dmRoomMap) return urls;
    for (const [matrixUserId, roomId] of dmRoomMap) {
      const room = client.getRoom(roomId);
      if (!room) continue;
      const member = room.getMember(matrixUserId);
      if (member) {
        const avatarUrl = member.getAvatarUrl(client.baseUrl, 128, 128, 'crop', false, false);
        if (avatarUrl) {
          urls.set(matrixUserId, avatarUrl);
        }
      }
    }
    return urls;
  }, [client, dmRoomMap]);

  const sendReaction = useCallback(async (targetId: string, eventId: string, emoji: string) => {
    const client = clientRef.current;
    if (!credentials || !client || !eventId || !emoji) return;

    const roomId = credentials.roomMap[targetId] ?? dmRoomMapRef.current.get(targetId);
    if (!roomId) return;

    const optimisticReaction: ReactionEventRecord = {
      reactionEventId: `optimistic-${eventId}-${emoji}`,
      targetEventId: eventId,
      emoji,
      senderId: credentials.userId,
    };

    setActiveMessages(prev => applyReactionToMessages(prev, optimisticReaction));
    setActiveDmMessages(prev => applyReactionToMessages(prev, optimisticReaction));

    try {
      const response = await client.sendEvent(roomId, EventType.Reaction, {
        'm.relates_to': {
          rel_type: RelationType.Annotation,
          event_id: eventId,
          key: emoji,
        },
      });
      const reactionEventId = (response as { event_id?: string })?.event_id;
      if (reactionEventId) {
        reactionEventsRef.current.set(reactionEventId, {
          ...optimisticReaction,
          reactionEventId,
        });
        const ownForMessage = ownReactionEventIdsRef.current.get(eventId) ?? new Map<string, string>();
        ownForMessage.set(emoji, reactionEventId);
        ownReactionEventIdsRef.current.set(eventId, ownForMessage);
      }
    } catch (err) {
      console.warn('[Matrix] Failed to send reaction:', err);
      setActiveMessages(prev => removeReactionFromMessages(prev, optimisticReaction));
      setActiveDmMessages(prev => removeReactionFromMessages(prev, optimisticReaction));
    }
  }, [credentials]);

  const removeReaction = useCallback(async (targetId: string, eventId: string, emoji: string) => {
    const client = clientRef.current;
    if (!credentials || !client || !eventId || !emoji) return;

    const roomId = credentials.roomMap[targetId] ?? dmRoomMapRef.current.get(targetId);
    const reactionEventId = ownReactionEventIdsRef.current.get(eventId)?.get(emoji);
    if (!roomId || !reactionEventId) return;

    const optimisticReaction: ReactionEventRecord = {
      reactionEventId,
      targetEventId: eventId,
      emoji,
      senderId: credentials.userId,
    };

    setActiveMessages(prev => removeReactionFromMessages(prev, optimisticReaction));
    setActiveDmMessages(prev => removeReactionFromMessages(prev, optimisticReaction));

    try {
      await client.redactEvent(roomId, reactionEventId);
      reactionEventsRef.current.delete(reactionEventId);
      const ownForMessage = ownReactionEventIdsRef.current.get(eventId);
      ownForMessage?.delete(emoji);
      if (ownForMessage?.size === 0) {
        ownReactionEventIdsRef.current.delete(eventId);
      }
    } catch (err) {
      console.warn('[Matrix] Failed to remove reaction:', err);
      setActiveMessages(prev => applyReactionToMessages(prev, optimisticReaction));
      setActiveDmMessages(prev => applyReactionToMessages(prev, optimisticReaction));
    }
  }, [credentials]);

  return { lastMessages, activeMessages, setActiveChannel,
           sendMessage, sendImageMessage, uploadContent, fetchHistory,
           sendReaction, removeReaction,
           dmLastMessages, activeDmMessages, setActiveDmContact, dmRoomMap,
           dmUserDisplayNames, dmUserAvatarUrls, sendDMMessage, fetchDMHistory,
           fetchAvatarUrl, client, activeTypingText, startTyping, stopTyping };
}
