import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient, RoomEvent, EventType, MsgType } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import type { ChatMessage } from '../types';

export interface MatrixCredentials {
  homeserverUrl: string;
  accessToken: string;
  userId: string;
  roomMap: Record<string, string>; // mumbleChannelId → matrixRoomId
}

export function useMatrixClient(credentials: MatrixCredentials | null) {
  const clientRef = useRef<MatrixClient | null>(null);
  const [messages, setMessages] = useState<Map<string, ChatMessage[]>>(new Map());

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
      if (!channelId) return;

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
        const next = new Map(prev);
        const existing = next.get(channelId) ?? [];
        // Deduplicate by id (scrollback can re-emit events already in state)
        if (existing.some(m => m.id === message.id)) return prev;
        const updated = [...existing, message].sort(
          (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
        );
        next.set(channelId, updated);
        return next;
      });
    };

    client.on(RoomEvent.Timeline, onTimeline);
    client.startClient({ initialSyncLimit: 20 });
    clientRef.current = client;

    return () => {
      client.off(RoomEvent.Timeline, onTimeline);
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

  return { messages, sendMessage, fetchHistory };
}
