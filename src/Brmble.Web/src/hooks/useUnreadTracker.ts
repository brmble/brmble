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
  /** Total unread notification count (server-computed) */
  notificationCount: number;
  /** Unread highlight/mention count */
  highlightCount: number;
  /** Event ID of the m.fully_read marker (for divider positioning) */
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

export function useUnreadTracker(
  client: MatrixClient | null,
  dmRoomIds: Set<string>,
  activeRoomId: string | null,
): UnreadTracker {
  const [roomUnreads, setRoomUnreads] = useState<Map<string, RoomUnreadState>>(new Map());
  const activeRoomIdRef = useRef(activeRoomId);
  activeRoomIdRef.current = activeRoomId;

  const buildRoomUnread = useCallback((room: Room): RoomUnreadState => {
    const notificationCount = room.getUnreadNotificationCount(NotificationCountType.Total) ?? 0;
    const highlightCount = room.getUnreadNotificationCount(NotificationCountType.Highlight) ?? 0;
    const fullyReadEventId = room.getAccountData('m.fully_read')?.getContent()?.event_id ?? null;
    return { notificationCount, highlightCount, fullyReadEventId };
  }, []);

  const refreshAll = useCallback(() => {
    if (!client) return;
    const rooms = client.getRooms();
    const newMap = new Map<string, RoomUnreadState>();
    for (const room of rooms) {
      newMap.set(room.roomId, buildRoomUnread(room));
    }
    setRoomUnreads(newMap);
  }, [client, buildRoomUnread]);

  const refreshRoom = useCallback((roomId: string) => {
    if (!client) return;
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
      if (state === 'PREPARED' || state === 'SYNCING') {
        refreshAll();
      }
    };

    const onTimeline = (_event: unknown, room: Room | undefined) => {
      if (room) refreshRoom(room.roomId);
    };

    const onReceipt = (_event: unknown, room: Room) => {
      refreshRoom(room.roomId);
    };

    const onAccountData = () => {
      // m.fully_read is room account data, but global account data changes
      // can also affect state, so refresh everything
      refreshAll();
    };

    client.on(ClientEvent.Sync, onSync);
    client.on(RoomEvent.Timeline, onTimeline);
    client.on(RoomEvent.Receipt, onReceipt);
    client.on(ClientEvent.AccountData, onAccountData);

    // If the client is already syncing, do an initial refresh
    const syncState = client.getSyncState();
    if (syncState === 'SYNCING' || syncState === 'PREPARED') {
      refreshAll();
    }

    return () => {
      client.off(ClientEvent.Sync, onSync);
      client.off(RoomEvent.Timeline, onTimeline);
      client.off(RoomEvent.Receipt, onReceipt);
      client.off(ClientEvent.AccountData, onAccountData);
    };
  }, [client, refreshAll, refreshRoom]);

  /**
   * Mark a room as read: sets m.fully_read + m.read.private (never m.read).
   *
   * Uses `setRoomReadMarkersHttpRequest` directly because the higher-level
   * `setRoomReadMarkers` expects MatrixEvent objects, and we only have an event ID.
   * Passing: rmEventId (m.fully_read), no rrEventId (skips m.read), rpEventId (m.read.private).
   */
  const markRoomRead = useCallback(async (roomId: string, eventId: string) => {
    if (!client) return;

    try {
      // setRoomReadMarkersHttpRequest(roomId, rmEventId, rrEventId?, rpEventId?)
      // - rmEventId  -> m.fully_read (always sent)
      // - rrEventId  -> m.read (public receipt) — we pass undefined to skip it
      // - rpEventId  -> m.read.private — we pass eventId
      await client.setRoomReadMarkersHttpRequest(roomId, eventId, undefined, eventId);
    } catch {
      // Silently ignore errors — the server may not support m.read.private,
      // but m.fully_read should still have been set.
    }

    // Optimistically update local state
    setRoomUnreads(prev => {
      const next = new Map(prev);
      const existing = prev.get(roomId) ?? EMPTY_UNREAD;
      next.set(roomId, {
        ...existing,
        notificationCount: 0,
        highlightCount: 0,
        fullyReadEventId: eventId,
      });
      return next;
    });
  }, [client]);

  // Auto-mark active room as read when new messages arrive from others
  useEffect(() => {
    if (!client || !activeRoomId) return;

    const onTimeline = (event: { getSender: () => string | undefined; getId: () => string | undefined }, room: Room | undefined) => {
      if (!room || room.roomId !== activeRoomIdRef.current) return;
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

  const getRoomUnread = useCallback((roomId: string): RoomUnreadState => {
    return roomUnreads.get(roomId) ?? EMPTY_UNREAD;
  }, [roomUnreads]);

  const getFullyReadEventId = useCallback((roomId: string): string | null => {
    return roomUnreads.get(roomId)?.fullyReadEventId ?? null;
  }, [roomUnreads]);

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
    totalUnreadCount,
    totalDmUnreadCount,
  };
}
