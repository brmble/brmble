// src/Brmble.Web/src/hooks/useUnreadTracker.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  type MatrixClient,
  type Room,
  RoomEvent,
  ClientEvent,
  NotificationCountType,
} from 'matrix-js-sdk';

export interface RoomUnreadState {
  /** Total unread message count */
  notificationCount: number;
  /** Unread highlight/mention count */
  highlightCount: number;
  /** Event ID of the last-read m.room.message (for divider positioning) */
  fullyReadEventId: string | null;
}

export interface UnreadTracker {
  /** Map of matrixRoomId -> unread state */
  roomUnreads: Map<string, RoomUnreadState>;
  /** Get unread state for a specific room */
  getRoomUnread: (roomId: string) => RoomUnreadState;
  /** Mark a room as read up to a given event ID (sends m.read.private + m.fully_read) */
  markRoomRead: (roomId: string, eventId: string) => Promise<void>;
  /** Get the fully_read event ID for a room (for divider placement) */
  getFullyReadEventId: (roomId: string) => string | null;
  /** Get the localStorage marker timestamp for a room (for divider placement) */
  getMarkerTimestamp: (roomId: string) => number | null;
  /** Total unread count across all tracked rooms */
  totalUnreadCount: number;
  /** Total unread count across DM rooms only */
  totalDmUnreadCount: number;
}

const EMPTY_UNREAD: RoomUnreadState = {
  notificationCount: 0,
  highlightCount: 0,
  fullyReadEventId: null,
};

const STORAGE_KEY = 'brmble-read-markers';

// ── localStorage-backed read markers ──────────────────────────────────
// Conduwuit doesn't reliably return m.fully_read in /sync responses, so
// we persist read markers locally. The HTTP call to /read_markers is still
// sent (for other clients / future server fixes) but localStorage is the
// authoritative source for this client.
//
// Each marker stores an eventId AND a timestamp. The timestamp is the
// client wall-clock time (Date.now()) at the moment the room was marked
// as read. Using wall-clock time instead of the event's origin_server_ts
// ensures that ALL events currently in the timeline are treated as "read"
// — even rapid-fire messages that arrived just after the marked event.
// When counting unreads, we only count messages whose origin_server_ts is
// strictly greater than this wall-clock timestamp.

interface StoredMarker {
  eventId: string;
  /** Client wall-clock time when the room was marked as read (ms since epoch) */
  ts: number;
}

// In-memory cache of markers. Loaded once from localStorage; all subsequent
// reads use this cache to avoid JSON.parse on every timeline event / refresh.
let markersCache: Record<string, StoredMarker> | null = null;

function loadMarkers(): Record<string, StoredMarker> {
  if (markersCache) return markersCache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      markersCache = {};
      return markersCache;
    }
    const parsed = JSON.parse(raw);
    // Migration: old format stored just strings, new format stores { eventId, ts }
    const result: Record<string, StoredMarker> = {};
    for (const [roomId, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        // Old format — migrate with ts=Date.now() so existing rooms are NOT
        // shown as unread after migration. Only truly new messages will count.
        result[roomId] = { eventId: value, ts: Date.now() };
      } else {
        result[roomId] = value as StoredMarker;
      }
    }
    markersCache = result;
    return markersCache;
  } catch {
    markersCache = {};
    return markersCache;
  }
}

function saveMarker(roomId: string, eventId: string, ts: number): void {
  const markers = loadMarkers();
  markers[roomId] = { eventId, ts };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(markers));
  } catch {
    // localStorage may be full or unavailable
  }
}

function getMarker(roomId: string): StoredMarker | null {
  return loadMarkers()[roomId] ?? null;
}

// ── Timeline counting ─────────────────────────────────────────────────

/**
 * Find the last m.room.message event ID in the timeline at or before a given
 * event ID. This ensures our read marker always points to a message event,
 * which is what groupMessages needs to place the divider.
 */
function findLastMessageEventId(room: Room, targetEventId: string): string | null {
  const timeline = room.getLiveTimeline().getEvents();
  let foundTarget = false;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const event = timeline[i];
    if (event.getId() === targetEventId) {
      foundTarget = true;
    }
    if (foundTarget && event.getType() === 'm.room.message') {
      return event.getId() ?? null;
    }
  }
  // If the target wasn't in the timeline, or no message event was found before it,
  // fall back to the target itself (better than null).
  return targetEventId;
}

/**
 * Count unread messages and @mentions after the read marker.
 *
 * Only counts m.room.message events from other users whose
 * origin_server_ts is strictly greater than the marker's saved timestamp.
 * This prevents backfilled/paginated old events from being counted as unread.
 *
 * Returns { count: 0, mentionCount: 0 } if no marker exists (room never opened).
 * mentionCount tracks @DisplayName patterns in message bodies (client-side detection).
 */
function countUnreadFromTimeline(
  room: Room,
  marker: StoredMarker | null,
  myUserId: string | null,
  currentDisplayName?: string | null,
): { count: number; mentionCount: number } {
  if (!marker) return { count: 0, mentionCount: 0 };

  const timeline = room.getLiveTimeline().getEvents();
  if (timeline.length === 0) return { count: 0, mentionCount: 0 };

  // If the marker IS the last event, there's nothing unread
  const lastEvent = timeline[timeline.length - 1];
  if (lastEvent.getId() === marker.eventId) return { count: 0, mentionCount: 0 };

  const mentionPattern = currentDisplayName
    ? new RegExp(`@${currentDisplayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$|[.,!?;:])`, 'i')
    : null;

  // Count only messages that are:
  // 1. After the marker's timestamp (truly new, not backfilled)
  // 2. m.room.message type
  // 3. From other users
  let count = 0;
  let mentionCount = 0;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const event = timeline[i];
    // Stop if we've reached the marker event itself
    if (event.getId() === marker.eventId) break;
    // Only count events strictly newer than when we marked read
    if (event.getTs() <= marker.ts) continue;
    if (event.getType() === 'm.room.message' && event.getSender() !== myUserId) {
      count++;
      if (mentionPattern) {
        const body = (event.getContent() as { body?: string }).body ?? '';
        if (mentionPattern.test(body)) {
          mentionCount++;
        }
      }
    }
  }

  return { count, mentionCount };
}

export function useUnreadTracker(
  client: MatrixClient | null,
  dmRoomIds: Set<string>,
  activeRoomId: string | null,
  currentDisplayName?: string | null,
): UnreadTracker {
  const [roomUnreads, setRoomUnreads] = useState<Map<string, RoomUnreadState>>(new Map());
  const activeRoomIdRef = useRef(activeRoomId);
  activeRoomIdRef.current = activeRoomId;

  // Debounce timer for the server-side markRoomRead HTTP call.
  // We batch rapid-fire calls (e.g. multiple messages arriving at once).
  const markReadTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingMarkRef = useRef<Map<string, string>>(new Map());

  const buildRoomUnread = useCallback((room: Room): RoomUnreadState => {
    const localMarker = getMarker(room.roomId);
    const sdkMarkerId = room.getAccountData('m.fully_read')?.getContent()?.event_id ?? null;
    const fullyReadEventId = localMarker?.eventId ?? sdkMarkerId;

    const serverCount = room.getUnreadNotificationCount(NotificationCountType.Total) ?? 0;
    const serverHighlight = room.getUnreadNotificationCount(NotificationCountType.Highlight) ?? 0;

    // Always run client-side mention detection when we have a marker,
    // because the Matrix server doesn't know about @DisplayName mentions
    // (it only detects Matrix-ID-based mentions via push rules).
    // The two sources are disjoint: serverHighlight counts Matrix-ID push rule
    // matches, mentionCount counts @DisplayName text patterns. We add them
    // together to get the total highlight count.
    const myUserId = client?.getUserId() ?? null;
    const { count: clientCount, mentionCount } = localMarker
      ? countUnreadFromTimeline(room, localMarker, myUserId, currentDisplayName)
      : { count: 0, mentionCount: 0 };

    if (serverCount > 0) {
      return {
        notificationCount: serverCount,
        highlightCount: serverHighlight + mentionCount,
        fullyReadEventId,
      };
    }

    // Only count client-side unreads when we have a localStorage marker with
    // a real timestamp. Without one, we can't distinguish new from backfilled.
    if (!localMarker) {
      return { notificationCount: 0, highlightCount: 0, fullyReadEventId };
    }

    return {
      notificationCount: clientCount,
      highlightCount: serverHighlight + mentionCount,
      fullyReadEventId,
    };
  }, [client, currentDisplayName]);

  const refreshAll = useCallback(() => {
    if (!client) return;
    const rooms = client.getRooms();
    const newMap = new Map<string, RoomUnreadState>();
    const activeId = activeRoomIdRef.current;
    for (const room of rooms) {
      if (room.roomId === activeId) {
        // Active room always shows 0 unreads — the user is looking at it.
        const localMarker = getMarker(room.roomId);
        const sdkMarkerId = room.getAccountData('m.fully_read')?.getContent()?.event_id ?? null;
        newMap.set(room.roomId, {
          notificationCount: 0,
          highlightCount: 0,
          fullyReadEventId: localMarker?.eventId ?? sdkMarkerId,
        });
      } else {
        newMap.set(room.roomId, buildRoomUnread(room));
      }
    }
    setRoomUnreads(newMap);
  }, [client, buildRoomUnread]);

  const refreshRoom = useCallback((roomId: string) => {
    if (!client) return;
    if (roomId === activeRoomIdRef.current) return;
    const room = client.getRoom(roomId);
    if (!room) return;
    setRoomUnreads(prev => {
      const next = new Map(prev);
      next.set(roomId, buildRoomUnread(room));
      return next;
    });
  }, [client, buildRoomUnread]);

  // Subscribe to Matrix events that affect unread state
  useEffect(() => {
    if (!client) return;

    const onSync = (state: string) => {
      if (state === 'PREPARED') {
        refreshAll();
      }
    };

    const onTimeline = (_event: unknown, room: Room | undefined) => {
      if (room) refreshRoom(room.roomId);
    };

    const onReceipt = (_event: unknown, room: Room) => {
      refreshRoom(room.roomId);
    };

    const onRoomAccountData = (_event: unknown, room: Room) => {
      refreshRoom(room.roomId);
    };

    client.on(ClientEvent.Sync, onSync);
    client.on(RoomEvent.Timeline, onTimeline);
    client.on(RoomEvent.Receipt, onReceipt);
    client.on(RoomEvent.AccountData, onRoomAccountData);

    const syncState = client.getSyncState();
    if (syncState === 'SYNCING' || syncState === 'PREPARED') {
      refreshAll();
    }

    return () => {
      client.off(ClientEvent.Sync, onSync);
      client.off(RoomEvent.Timeline, onTimeline);
      client.off(RoomEvent.Receipt, onReceipt);
      client.off(RoomEvent.AccountData, onRoomAccountData);
    };
  }, [client, refreshAll, refreshRoom, dmRoomIds]);

  /**
   * Send the read marker to the server (debounced, fire-and-forget).
   * This is best-effort — localStorage is the source of truth.
   */
  const flushMarkToServer = useCallback((roomId: string, eventId: string) => {
    if (!client) return;
    client.setRoomReadMarkersHttpRequest(roomId, eventId, undefined, eventId)
      .catch(() => {
        // Best-effort: server may not support m.read.private, or may be unreachable.
      });
  }, [client]);

  /**
   * Mark a room as read up to the given event ID.
   *
   * Persists to localStorage immediately, updates React state, and sends
   * the marker to the server (debounced to avoid flooding).
   */
  const markRoomRead = useCallback(async (roomId: string, eventId: string) => {
    if (!client) return;

    // Find the last m.room.message event at or before eventId so the marker
    // always points to a message (needed for divider matching in groupMessages).
    const room = client.getRoom(roomId);
    const messageEventId = room
      ? (findLastMessageEventId(room, eventId) ?? eventId)
      : eventId;

    // Use a marker timestamp that is at least as new as the last marked
    // event's origin_server_ts to avoid false unreads due to clock skew
    // between the homeserver and the client.
    let markerTs = Date.now();
    if (room) {
      const lastMarkedEvent = room.findEventById(messageEventId);
      if (lastMarkedEvent) {
        markerTs = Math.max(markerTs, lastMarkedEvent.getTs());
      }
    }

    // Persist locally (authoritative source)
    saveMarker(roomId, messageEventId, markerTs);

    // Update React state immediately
    setRoomUnreads(prev => {
      const next = new Map(prev);
      const existing = prev.get(roomId) ?? EMPTY_UNREAD;
      next.set(roomId, {
        ...existing,
        notificationCount: 0,
        highlightCount: 0,
        fullyReadEventId: messageEventId,
      });
      return next;
    });

    // Debounce the server call: cancel any pending call for this room
    // and schedule a new one. This avoids firing dozens of HTTP requests
    // when messages stream in rapidly.
    const existingTimer = markReadTimerRef.current.get(roomId);
    if (existingTimer) clearTimeout(existingTimer);
    pendingMarkRef.current.set(roomId, messageEventId);
    markReadTimerRef.current.set(roomId, setTimeout(() => {
      const pending = pendingMarkRef.current.get(roomId);
      if (pending) {
        flushMarkToServer(roomId, pending);
        pendingMarkRef.current.delete(roomId);
      }
      markReadTimerRef.current.delete(roomId);
    }, 1000));
  }, [client, flushMarkToServer]);

  // Auto-mark active room as read when new m.room.message events arrive
  useEffect(() => {
    if (!client || !activeRoomId) return;

    const onTimeline = (event: { getType: () => string; getSender: () => string | undefined; getId: () => string | undefined }, room: Room | undefined) => {
      if (!room || room.roomId !== activeRoomIdRef.current) return;
      // Only act on actual messages, not state events or reactions
      if (event.getType() !== 'm.room.message') return;
      // Don't mark as read for our own messages
      if (event.getSender() === client.getUserId()) return;
      const eventId = event.getId();
      if (eventId) {
        markRoomRead(room.roomId, eventId);
      }
    };

    client.on(RoomEvent.Timeline, onTimeline);
    return () => {
      client.off(RoomEvent.Timeline, onTimeline);
    };
  }, [client, activeRoomId, markRoomRead]);

  // Clean up debounce timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of markReadTimerRef.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const getRoomUnread = useCallback((roomId: string): RoomUnreadState => {
    return roomUnreads.get(roomId) ?? EMPTY_UNREAD;
  }, [roomUnreads]);

  const getFullyReadEventId = useCallback((roomId: string): string | null => {
    return roomUnreads.get(roomId)?.fullyReadEventId ?? null;
  }, [roomUnreads]);

  const getMarkerTimestamp = useCallback((roomId: string): number | null => {
    const marker = getMarker(roomId);
    return marker?.ts ?? null;
  }, []);

  // Compute totals from the current state (derived, not stored)
  let totalUnreadCount = 0;
  let totalDmUnreadCount = 0;
  for (const [roomId, state] of roomUnreads) {
    totalUnreadCount += state.notificationCount;
    if (dmRoomIds.has(roomId)) {
      totalDmUnreadCount += state.notificationCount;
    }
  }

  return {
    roomUnreads,
    getRoomUnread,
    markRoomRead,
    getFullyReadEventId,
    getMarkerTimestamp,
    totalUnreadCount,
    totalDmUnreadCount,
  };
}
