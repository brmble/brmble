import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient, RoomEvent, ClientEvent, EventType, MsgType, Preset, KnownMembership } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import type { ChatMessage, MediaAttachment } from '../types';
import { useServiceStatus } from './useServiceStatus';

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
  const [client, setClient] = useState<MatrixClient | null>(null);
  const [messages, setMessages] = useState<Map<string, ChatMessage[]>>(new Map());
  const { updateStatus } = useServiceStatus();

  // DM room tracking: matrixUserId -> roomId
  const [dmRoomMap, setDmRoomMap] = useState<Map<string, string>>(new Map());
  // DM messages: matrixUserId -> ChatMessage[]
  const [dmMessages, setDmMessages] = useState<Map<string, ChatMessage[]>>(new Map());

  const dmRoomMapRef = useRef<Map<string, string>>(new Map());
  // Keep ref in sync
  useEffect(() => { dmRoomMapRef.current = dmRoomMap; }, [dmRoomMap]);

  const roomIdToDMUserIdRef = useRef<Map<string, string>>(new Map());
  const lastSyncStateRef = useRef<string | null>(null);

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
      setClient(null);
      setMessages(new Map());
      setDmRoomMap(new Map());
      setDmMessages(new Map());
      dmRoomMapRef.current = new Map();
      roomIdToDMUserIdRef.current = new Map();
      lastSyncStateRef.current = null;
      updateStatus('chat', { state: 'idle', error: undefined });
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
        const displayName = senderMember?.rawDisplayName || senderMember?.name || senderId;

        const content = event.getContent() as {
          body?: string;
          msgtype?: string;
          url?: string;
          info?: { thumbnail_url?: string; w?: number; h?: number; mimetype?: string; size?: number };
        };

        let media: MediaAttachment[] | undefined;
        if (content.msgtype === 'm.image' && content.url) {
          const cl = clientRef.current;
          const fullUrl = cl?.mxcUrlToHttp(content.url) ?? content.url;
          const thumbUrl = content.info?.thumbnail_url
            ? (cl?.mxcUrlToHttp(content.info.thumbnail_url, 400, 400, 'scale') ?? undefined)
            : (cl?.mxcUrlToHttp(content.url, 400, 400, 'scale') ?? undefined);

          media = [{
            type: content.info?.mimetype?.toLowerCase() === 'image/gif' ? 'gif' : 'image',
            url: fullUrl,
            thumbnailUrl: thumbUrl,
            width: content.info?.w,
            height: content.info?.h,
            mimetype: content.info?.mimetype,
            size: content.info?.size,
          }];
        }

        const rawBody = content.body ?? '';
        // Only parse bridged "[Name]: " prefixes for events sent by the bridge bot
        const isBridgeBotSender = /^@brmble[_-]?/.test(senderId);
        const bridgeMatch = isBridgeBotSender ? rawBody.match(/^\[(.+?)\]:\s*/) : null;
        const messageSender = bridgeMatch ? bridgeMatch[1] : displayName;
        const messageContent = bridgeMatch ? rawBody.slice(bridgeMatch[0].length) : rawBody;

        const message: ChatMessage = {
          id: event.getId() ?? crypto.randomUUID(),
          channelId,
          sender: messageSender,
          senderMatrixUserId: senderId,
          content: messageContent,
          timestamp: new Date(event.getTs()),
          ...(media && { media }),
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
      const dmDisplayName = dmSenderMember?.rawDisplayName || dmSenderMember?.name || dmSenderId;

      const dmContent = event.getContent() as {
        body?: string;
        msgtype?: string;
        url?: string;
        info?: { thumbnail_url?: string; w?: number; h?: number; mimetype?: string; size?: number };
      };

      let dmMedia: MediaAttachment[] | undefined;
      if (dmContent.msgtype === 'm.image' && dmContent.url) {
        const cl = clientRef.current;
        const fullUrl = cl?.mxcUrlToHttp(dmContent.url) ?? dmContent.url;
        const thumbUrl = dmContent.info?.thumbnail_url
          ? (cl?.mxcUrlToHttp(dmContent.info.thumbnail_url, 400, 400, 'scale') ?? undefined)
          : (cl?.mxcUrlToHttp(dmContent.url, 400, 400, 'scale') ?? undefined);

        dmMedia = [{
          type: dmContent.info?.mimetype?.toLowerCase() === 'image/gif' ? 'gif' : 'image',
          url: fullUrl,
          thumbnailUrl: thumbUrl,
          width: dmContent.info?.w,
          height: dmContent.info?.h,
          mimetype: dmContent.info?.mimetype,
          size: dmContent.info?.size,
        }];
      }

      const dmRawBody = dmContent.body ?? '';
      // Only parse bridged "[Name]: " prefixes for events sent by the bridge bot
      const isDmBridgeBotSender = /^@brmble[_-]?/.test(dmSenderId);
      const dmBridgeMatch = isDmBridgeBotSender ? dmRawBody.match(/^\[(.+?)\]:\s*/) : null;
      const dmSender = dmBridgeMatch ? dmBridgeMatch[1] : dmDisplayName;
      const dmMessageContent = dmBridgeMatch ? dmRawBody.slice(dmBridgeMatch[0].length) : dmRawBody;

      const dmMessage: ChatMessage = {
        id: event.getId() ?? crypto.randomUUID(),
        channelId: dmUserId,
        sender: dmSender,
        senderMatrixUserId: dmSenderId,
        content: dmMessageContent,
        timestamp: new Date(event.getTs()),
        ...(dmMedia && { media: dmMedia }),
      };

      setDmMessages(prev => {
        const existing = prev.get(dmUserId) ?? [];
        const updated = insertMessage(existing, dmMessage);
        if (updated === existing) return prev;
        return new Map(prev).set(dmUserId, updated);
      });
    };

    client.on(RoomEvent.Timeline, onTimeline);
    updateStatus('chat', { state: 'connecting', error: undefined });
    client.startClient({ initialSyncLimit: 20 });
    clientRef.current = client;
    setClient(client);

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
      let derivedState: string;
      if (state === 'PREPARED' || state === 'SYNCING') {
        derivedState = 'connected';
        if (state === 'PREPARED') {
          const directEvent = client.getAccountData(EventType.Direct);
          if (directEvent) {
            refreshDMRoomMaps(directEvent.getContent() as Record<string, string[]>);
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

    const onAccountData = (event: MatrixEvent) => {
      if (event.getType() !== EventType.Direct) return;
      refreshDMRoomMaps(event.getContent() as Record<string, string[]>);
    };

    const onMyMembership = (room: Room, membership: string) => {
      if (membership === KnownMembership.Invite && room.getDMInviter()) {
        client.joinRoom(room.roomId).then(() => {
          const inviter = room.getDMInviter();
          if (inviter) {
            // Update local DM maps so timeline handler can route messages immediately
            setDmRoomMap(prev => new Map(prev).set(inviter, room.roomId));
            dmRoomMapRef.current = new Map(dmRoomMapRef.current).set(inviter, room.roomId);
            roomIdToDMUserIdRef.current = new Map(roomIdToDMUserIdRef.current).set(room.roomId, inviter);

            // Update m.direct account data
            const directEvent = client.getAccountData(EventType.Direct);
            const directContent = (directEvent?.getContent() ?? {}) as Record<string, string[]>;
            if (!directContent[inviter]?.includes(room.roomId)) {
              directContent[inviter] = [room.roomId, ...(directContent[inviter] ?? [])];
              client.setAccountData(EventType.Direct, directContent).catch(console.warn);
            }
          }
        }).catch(err => {
          console.warn(`[Matrix] Failed to auto-join DM room ${room.roomId}:`, err);
        });
      }
    };

    client.on(ClientEvent.Sync, onSync);
    client.on(ClientEvent.AccountData, onAccountData);
    client.on(RoomEvent.MyMembership, onMyMembership);

    return () => {
      client.off(RoomEvent.Timeline, onTimeline);
      client.off(ClientEvent.Sync, onSync);
      client.off(ClientEvent.AccountData, onAccountData);
      client.off(RoomEvent.MyMembership, onMyMembership);
      client.stopClient();
      clientRef.current = null;
      setClient(null);
      updateStatus('chat', { state: 'idle', error: undefined });
    };
  }, [credentials, roomIdToChannelId, updateStatus]);

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

    // Create DM room if it doesn't exist
    if (!roomId) {
      const createResult = await client.createRoom({
        is_direct: true,
        invite: [targetMatrixUserId],
        preset: Preset.TrustedPrivateChat,
      });
      roomId = createResult.room_id;

      // Update m.direct account data
      const directEvent = client.getAccountData(EventType.Direct);
      const directContent = (directEvent?.getContent() ?? {}) as Record<string, string[]>;
      directContent[targetMatrixUserId] = [roomId, ...(directContent[targetMatrixUserId] ?? [])];
      await client.setAccountData(EventType.Direct, directContent);

      // Update local state
      setDmRoomMap(prev => new Map(prev).set(targetMatrixUserId, roomId!));
      dmRoomMapRef.current = new Map(dmRoomMapRef.current).set(targetMatrixUserId, roomId);
      roomIdToDMUserIdRef.current = new Map(roomIdToDMUserIdRef.current).set(roomId, targetMatrixUserId);
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

  return { messages, sendMessage, fetchHistory, dmMessages, dmRoomMap, sendDMMessage, fetchDMHistory, fetchAvatarUrl, client };
}
