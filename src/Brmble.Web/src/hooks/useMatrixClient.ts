import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createClient, RoomEvent, ClientEvent, EventType, MsgType, KnownMembership } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import type { ChatMessage, MediaAttachment } from '../types';
import { useServiceStatus } from './useServiceStatus';
import bridge from '../bridge';

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
  dmRoomMap?: Record<string, string>; // matrixUserId → matrixRoomId (from server)
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
  const pendingRoomCreations = useRef(new Map<string, Promise<string>>());
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

    let isPrepared = false;
    const bufferedDmEvents: Array<{ room: Room | undefined; event: MatrixEvent }> = [];

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
        // Only parse bridged "[Name]: " prefixes for events sent by the bridge bot
        const isBridgeBotSender = /^@brmble[_-]?/.test(senderId);
        const bridgeMatch = isBridgeBotSender ? rawBody.match(/^\[(.+?)\]:\s*/) : null;
        const messageSender = bridgeMatch ? bridgeMatch[1] : displayName;
        const messageContent = bridgeMatch ? rawBody.slice(bridgeMatch[0].length) : rawBody;

        // For image-only messages, body is just the filename — don't show it as text
        const displayContent = media ? '' : messageContent;

        const message: ChatMessage = {
          id: event.getId() ?? crypto.randomUUID(),
          channelId,
          sender: messageSender,
          senderMatrixUserId: senderId,
          content: displayContent,
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
      if (!dmUserId) {
        if (!isPrepared && room?.roomId) {
          bufferedDmEvents.push({ room, event });
        }
        return;
      }

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

        dmMedia = [{
          type: dmContent.info?.mimetype?.toLowerCase() === 'image/gif' ? 'gif' : 'image',
          url: fullUrl,
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

      // For image-only messages, body is just the filename — don't show it as text
      const dmDisplayContent = dmMedia ? '' : dmMessageContent;

      const dmMessage: ChatMessage = {
        id: event.getId() ?? crypto.randomUUID(),
        channelId: dmUserId,
        sender: dmSender,
        senderMatrixUserId: dmSenderId,
        content: dmDisplayContent,
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
          isPrepared = true;
          const directEvent = client.getAccountData(EventType.Direct);
          if (directEvent) {
            refreshDMRoomMaps(directEvent.getContent() as Record<string, string[]>);
          }

          // Merge server-provided DM room mappings (authoritative, takes priority)
          if (credentials.dmRoomMap) {
            for (const [userId, roomId] of Object.entries(credentials.dmRoomMap)) {
              dmRoomMapRef.current = new Map(dmRoomMapRef.current).set(userId, roomId);
              roomIdToDMUserIdRef.current = new Map(roomIdToDMUserIdRef.current).set(roomId, userId);
            }
            setDmRoomMap(new Map(dmRoomMapRef.current));
          }

          // Replay any DM timeline events that arrived before room maps were ready
          for (const { room, event } of bufferedDmEvents) {
            onTimeline(event, room);
          }
          bufferedDmEvents.length = 0;
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
      const inviter = room.getDMInviter();
      if (!inviter) return;

      if (membership === KnownMembership.Invite) {
        // Auto-join DM invites
        client.joinRoom(room.roomId).then(() => {
          trackDMRoom(room.roomId, inviter);
        }).catch(err => {
          console.warn(`[Matrix] Failed to auto-join DM room ${room.roomId}:`, err);
        });
      } else if (membership === KnownMembership.Join) {
        // Already joined — ensure it's tracked (covers rooms created by the other user
        // that we joined but never added to m.direct)
        if (!roomIdToDMUserIdRef.current.has(room.roomId)) {
          trackDMRoom(room.roomId, inviter);
        }
      }
    };

    /** Add a DM room to local maps, persist to m.direct, and backfill messages from SDK timeline */
    const trackDMRoom = (roomId: string, otherUserId: string) => {
      // Update local DM maps so timeline handler can route messages immediately
      setDmRoomMap(prev => new Map(prev).set(otherUserId, roomId));
      dmRoomMapRef.current = new Map(dmRoomMapRef.current).set(otherUserId, roomId);
      roomIdToDMUserIdRef.current = new Map(roomIdToDMUserIdRef.current).set(roomId, otherUserId);

      // Update m.direct account data
      const directEvent = client.getAccountData(EventType.Direct);
      const directContent = (directEvent?.getContent() ?? {}) as Record<string, string[]>;
      if (!directContent[otherUserId]?.includes(roomId)) {
        directContent[otherUserId] = [roomId, ...(directContent[otherUserId] ?? [])];
        client.setAccountData(EventType.Direct, directContent).catch(console.warn);
      }

      // Backfill: the SDK already has timeline events for this room that we missed
      // because the room wasn't in our maps when onTimeline fired
      const sdkRoom = client.getRoom(roomId);
      if (sdkRoom) {
        const timelineEvents = sdkRoom.getLiveTimeline().getEvents();
        const backfillMsgs: ChatMessage[] = [];
        for (const ev of timelineEvents) {
          if (ev.getType() !== EventType.RoomMessage) continue;
          const senderId = ev.getSender() ?? 'Unknown';
          const senderMember = sdkRoom.getMember(senderId);
          const displayName = senderMember?.rawDisplayName || senderMember?.name || senderId;

          const content = ev.getContent() as {
            body?: string;
            msgtype?: string;
            url?: string;
            info?: { thumbnail_url?: string; w?: number; h?: number; mimetype?: string; size?: number };
          };

          let media: MediaAttachment[] | undefined;
          if (content.msgtype === 'm.image' && content.url) {
            const cl = clientRef.current;
            const fullUrl = cl?.mxcUrlToHttp(content.url) ?? content.url;
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
          const messageContent = bridgeMatch ? rawBody.slice(bridgeMatch[0].length) : rawBody;

          backfillMsgs.push({
            id: ev.getId() ?? crypto.randomUUID(),
            channelId: otherUserId,
            sender: messageSender,
            senderMatrixUserId: senderId,
            content: media ? '' : messageContent,
            timestamp: new Date(ev.getTs()),
            ...(media && { media }),
          });
        }

        if (backfillMsgs.length > 0) {
          setDmMessages(prev => {
            const existing = prev.get(otherUserId) ?? [];
            let merged = existing;
            for (const msg of backfillMsgs) {
              merged = insertMessage(merged, msg);
            }
            if (merged === existing) return prev;
            return new Map(prev).set(otherUserId, merged);
          });
        }
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
          const onResolved = (data: unknown) => {
            const d = data as { targetMatrixUserId?: string; roomId?: string };
            if (d?.targetMatrixUserId === targetMatrixUserId && d?.roomId) {
              bridge.off('dm.roomResolved', onResolved);
              bridge.off('dm.roomError', onError);
              resolve(d.roomId);
            }
          };
          const onError = (data: unknown) => {
            const d = data as { targetMatrixUserId?: string; error?: string };
            if (d?.targetMatrixUserId === targetMatrixUserId) {
              bridge.off('dm.roomResolved', onResolved);
              bridge.off('dm.roomError', onError);
              reject(new Error(d?.error || 'Failed to get DM room'));
            }
          };
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

  return { messages, sendMessage, sendImageMessage, uploadContent, fetchHistory, dmMessages, dmRoomMap,
           dmUserDisplayNames, dmUserAvatarUrls, sendDMMessage, fetchDMHistory,
           fetchAvatarUrl, client };
}
