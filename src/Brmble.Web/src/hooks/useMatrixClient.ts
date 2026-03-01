import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient, RoomEvent, ClientEvent, EventType, MsgType, Preset } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import type { ChatMessage } from '../types';

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

export interface MatrixCredentials {
  homeserverUrl: string;
  accessToken: string;
  userId: string;
  roomMap: Record<string, string>; // mumbleChannelId → matrixRoomId
}

export function useMatrixClient(credentials: MatrixCredentials | null) {
  const clientRef = useRef<MatrixClient | null>(null);
  const [messages, setMessages] = useState<Map<string, ChatMessage[]>>(new Map());

  // DM room tracking: matrixUserId -> roomId
  const [dmRoomMap, setDmRoomMap] = useState<Map<string, string>>(new Map());
  // DM messages: matrixUserId -> ChatMessage[]
  const [dmMessages, setDmMessages] = useState<Map<string, ChatMessage[]>>(new Map());

  const dmRoomMapRef = useRef<Map<string, string>>(new Map());
  // Keep ref in sync
  useEffect(() => { dmRoomMapRef.current = dmRoomMap; }, [dmRoomMap]);

  const pendingRoomCreations = useRef<Map<string, Promise<string>>>(new Map());

  const roomIdToDMUserIdRef = useRef<Map<string, string>>(new Map());

  // Reverse lookup: matrixRoomId → mumbleChannelId
  const roomIdToChannelId = useMemo(() => {
    if (!credentials) return new Map<string, string>();
    return new Map(
      Object.entries(credentials.roomMap).map(([channelId, roomId]) => [roomId, channelId])
    );
  }, [credentials]);

  useEffect(() => {
    if (!credentials) {
      clientRef.current?.stopClient();
      clientRef.current = null;
      setMessages(new Map());
      setDmRoomMap(new Map());
      setDmMessages(new Map());
      dmRoomMapRef.current = new Map();
      roomIdToDMUserIdRef.current = new Map();
      return;
    }

    const client = createClient({
      baseUrl: credentials.homeserverUrl,
      accessToken: credentials.accessToken,
      userId: credentials.userId,
    });

    const onTimeline = (event: MatrixEvent, room: Room | undefined) => {
      if (event.getType() !== EventType.RoomMessage) return;
      const channelId = roomIdToChannelId.get(room?.roomId ?? '');
      if (channelId) {
        const senderId = event.getSender() ?? 'Unknown';
        const senderMember = room?.getMember(senderId);
        const displayName = senderMember?.name || senderMember?.rawDisplayName || senderId;

        const content = event.getContent() as { body?: string };
        const message: ChatMessage = {
          id: event.getId() ?? crypto.randomUUID(),
          channelId,
          sender: displayName,
          content: content.body ?? '',
          timestamp: new Date(event.getTs()),
        };

        setMessages(prev => {
          const existing = prev.get(channelId) ?? [];
          const updated = insertMessage(existing, message);
          if (updated === existing) return prev;
          return new Map(prev).set(channelId, updated);
        });
        return;
      }

      // DM message handling
      const dmUserId = roomIdToDMUserIdRef.current.get(room?.roomId ?? '');
      if (!dmUserId) return;

      const dmSenderId = event.getSender() ?? 'Unknown';
      const dmSenderMember = room?.getMember(dmSenderId);
      const dmDisplayName = dmSenderMember?.name || dmSenderMember?.rawDisplayName || dmSenderId;

      const dmContent = event.getContent() as { body?: string };
      const dmMessage: ChatMessage = {
        id: event.getId() ?? crypto.randomUUID(),
        channelId: dmUserId, // use matrixUserId as channelId key
        sender: dmDisplayName,
        content: dmContent.body ?? '',
        timestamp: new Date(event.getTs()),
      };

      setDmMessages(prev => {
        const existing = prev.get(dmUserId) ?? [];
        const updated = insertMessage(existing, dmMessage);
        if (updated === existing) return prev;
        return new Map(prev).set(dmUserId, updated);
      });
    };

    client.on(RoomEvent.Timeline, onTimeline);
    client.startClient({ initialSyncLimit: 20 });
    clientRef.current = client;

    const refreshDMRoomMaps = (directContent: Record<string, string[]>) => {
      const newDmRoomMap = new Map<string, string>();
      const newRoomIdToDMUserId = new Map<string, string>();
      for (const [userId, roomIds] of Object.entries(directContent)) {
        if (roomIds && roomIds.length > 0) {
          newDmRoomMap.set(userId, roomIds[0]);
          newRoomIdToDMUserId.set(roomIds[0], userId);
        }
      }
      setDmRoomMap(newDmRoomMap);
      dmRoomMapRef.current = newDmRoomMap;
      roomIdToDMUserIdRef.current = newRoomIdToDMUserId;
    };

    const onSync = (state: string) => {
      if (state === 'PREPARED') {
        const directEvent = client.getAccountData(EventType.Direct);
        if (directEvent) {
          refreshDMRoomMaps(directEvent.getContent() as Record<string, string[]>);
        }
      }
    };

    const onAccountData = (event: MatrixEvent) => {
      if (event.getType() !== EventType.Direct) return;
      refreshDMRoomMaps(event.getContent() as Record<string, string[]>);
    };

    client.once(ClientEvent.Sync, onSync);
    client.on(ClientEvent.AccountData, onAccountData);

    return () => {
      client.off(RoomEvent.Timeline, onTimeline);
      client.off(ClientEvent.Sync, onSync);
      client.off(ClientEvent.AccountData, onAccountData);
      client.stopClient();
      clientRef.current = null;
    };
  }, [credentials, roomIdToChannelId]);

  const sendMessage = useCallback(async (channelId: string, text: string) => {
    if (!credentials || !clientRef.current) return;
    const roomId = credentials.roomMap[channelId];
    if (!roomId) return;
    await clientRef.current.sendMessage(roomId, { msgtype: MsgType.Text, body: text });
  }, [credentials]);

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
      // Check if room creation is already in progress for this user
      let pending = pendingRoomCreations.current.get(targetMatrixUserId);
      if (!pending) {
        pending = (async () => {
          const createResult = await client.createRoom({
            is_direct: true,
            invite: [targetMatrixUserId],
            preset: Preset.TrustedPrivateChat,
          });
          const newRoomId = createResult.room_id;

          // Update m.direct account data
          const directEvent = client.getAccountData(EventType.Direct);
          const directContent = (directEvent?.getContent() ?? {}) as Record<string, string[]>;
          directContent[targetMatrixUserId] = [newRoomId, ...(directContent[targetMatrixUserId] ?? [])];
          await client.setAccountData(EventType.Direct, directContent);

          // Update local state
          setDmRoomMap(prev => new Map(prev).set(targetMatrixUserId, newRoomId));
          dmRoomMapRef.current = new Map(dmRoomMapRef.current).set(targetMatrixUserId, newRoomId);
          roomIdToDMUserIdRef.current = new Map(roomIdToDMUserIdRef.current).set(newRoomId, targetMatrixUserId);

          return newRoomId;
        })();
        pendingRoomCreations.current.set(targetMatrixUserId, pending);
      }

      try {
        roomId = await pending;
      } finally {
        pendingRoomCreations.current.delete(targetMatrixUserId);
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

  return { messages, sendMessage, fetchHistory, dmMessages, dmRoomMap, sendDMMessage, fetchDMHistory };
}
