import { useCallback, useRef, useState, useEffect } from 'react';
import { Room, RoomEvent, Track, RemoteTrackPublication } from 'livekit-client';
import bridge from '../bridge';

export interface ShareInfo {
  roomName: string;
  userName: string;
  userId: number;
  matrixUserId?: string;
  sessionId?: number;
}

/** @deprecated Use ShareInfo instead */
export interface ActiveShare {
  roomName: string;
  userName: string;
  sessionId?: number;
}

export interface ScreenShareSettings {
  captureAudio: boolean;
  resolution: '720p' | '1080p' | '1440p' | '4k';
  fps: 15 | 30 | 60;
  systemAudio: boolean;
}

export type LocalShareStopReason = 'manual' | 'source-closed' | 'interrupted' | 'error' | 'blocked-capture';

type LocalTrackLike = {
  addEventListener?: (event: string, handler: () => void) => void;
  removeEventListener?: (event: string, handler: () => void) => void;
  on?: (event: string, handler: () => void) => void;
  off?: (event: string, handler: () => void) => void;
};

type LiveKitAccessMode = 'publish' | 'subscribe';

type DiscoveryTarget = (({ scope: 'all' } | { roomName: string }) & { requestId?: number; baselineShareEventVersion?: number }) | null;

type PendingRoomRequest = {
  roomName: string;
  accessMode: LiveKitAccessMode;
  generation: number;
  promise: Promise<Room>;
  reject: (err: unknown) => void;
};

type SupersededRoomRequest = Error & { code: 'LIVEKIT_ROOM_REQUEST_SUPERSEDED' };

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  constructor?: {
    name?: unknown;
  };
};

const getErrorLikeDetails = (err: unknown) => {
  if (!err || typeof err !== 'object') {
    return null;
  }

  const { name, message } = err as ErrorLike;
  return {
    name: typeof name === 'string' ? name : '',
    message: typeof message === 'string' ? message : '',
  };
};

const isScreenSharePickerCancel = (err: unknown) => {
  const details = getErrorLikeDetails(err);
  if (!details) {
    return false;
  }

   const normalizedMessage = details.message.trim().toLowerCase();

   if (normalizedMessage === 'permission denied by user') {
     return true;
   }

  const isDomExceptionLike = err instanceof DOMException
    || (typeof (err as ErrorLike).constructor?.name === 'string' && (err as ErrorLike).constructor?.name === 'DOMException');

  if (!isDomExceptionLike) {
    return false;
  }

  const normalizedName = details.name.trim().toLowerCase();

  if (normalizedName === 'aborterror') {
    const knownAbortCancelMessages = new Set([
      'canceled',
      'cancelled',
      'permission denied by user',
      'selection canceled by user',
      'selection cancelled by user',
    ]);

    return knownAbortCancelMessages.has(normalizedMessage);
  }

  if (normalizedName === 'notallowederror') {
    const knownDismissMessages = new Set([
      'permission denied by user',
      'dismissed',
      'permission dismissed',
    ]);

    return knownDismissMessages.has(normalizedMessage);
  }

  return false;
};

const isBlockedWindowCaptureError = (err: unknown) => {
  const details = getErrorLikeDetails(err);
  const message = details?.message.toLowerCase() ?? '';
  const name = details?.name.toLowerCase() ?? '';

  return name === 'aborterror' && message.includes('starting capture pipeline');
};

const createSupersededRoomRequestError = (): SupersededRoomRequest => Object.assign(
  new Error('LiveKit room request was superseded'),
  { code: 'LIVEKIT_ROOM_REQUEST_SUPERSEDED' as const },
);

const isSupersededRoomRequestError = (err: unknown) => (
  !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'LIVEKIT_ROOM_REQUEST_SUPERSEDED'
) || getErrorLikeDetails(err)?.message === 'LiveKit room request was superseded';

export function useScreenShare(
  onDisconnected?: () => void,
  screenShareSettings?: ScreenShareSettings,
  onLocalShareEnded?: (reason: LocalShareStopReason) => void,
) {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeShares, setActiveShares] = useState<ShareInfo[]>([]);
  const [watchingShares, setWatchingShares] = useState<ShareInfo[]>([]);
  const [focusedShare, _setFocusedShare] = useState<ShareInfo | null>(null);
  const [remoteVideoEls, setRemoteVideoEls] = useState<Map<number, HTMLVideoElement>>(new Map());

  // Single room connection per channel — used for both publishing and subscribing
  const roomRef = useRef<Room | null>(null);
  const watchingSharesRef = useRef<ShareInfo[]>([]);
  const isSharingRef = useRef(false);
  const focusedShareRef = useRef<ShareInfo | null>(null);
  const discoveryTargetRef = useRef<DiscoveryTarget>(null);
  const shareEventVersionRef = useRef(0);
  const shareEventVersionByRoomRef = useRef(new Map<string, number>());
  const nextTokenRequestIdRef = useRef(0);
  const onDisconnectedRef = useRef(onDisconnected);
  const onLocalShareEndedRef = useRef(onLocalShareEnded);
  const localShareEndCleanupRef = useRef<(() => void) | null>(null);
  const localShareStopHandledRef = useRef(false);
  const localShareTeardownIntentRef = useRef<LocalShareStopReason | null>(null);
  onDisconnectedRef.current = onDisconnected;
  onLocalShareEndedRef.current = onLocalShareEnded;

  const clearLocalShareEndListener = useCallback(() => {
    localShareEndCleanupRef.current?.();
    localShareEndCleanupRef.current = null;
  }, []);

  const setFocusedShare: typeof _setFocusedShare = useCallback((action) => {
    _setFocusedShare(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      focusedShareRef.current = next;
      return next;
    });
  }, []);

  const updateWatchingShares = useCallback((shares: ShareInfo[]) => {
    watchingSharesRef.current = shares;
    setWatchingShares(shares);
  }, []);

  const markLocalShareTeardownIntent = useCallback((reason: LocalShareStopReason) => {
    localShareTeardownIntentRef.current = reason;
  }, []);

  const setDiscoveryTarget = useCallback((target: DiscoveryTarget) => {
    if (!target) {
      discoveryTargetRef.current = null;
      setActiveShares([]);
      return;
    }

    const baselineShareEventVersion = 'scope' in target
      ? shareEventVersionRef.current
      : shareEventVersionByRoomRef.current.get(target.roomName) ?? 0;
    discoveryTargetRef.current = { ...target, baselineShareEventVersion };
  }, []);

  const addWatchingShare = useCallback((share: ShareInfo) => {
    setWatchingShares(prev => {
      if (prev.some(s => s.userId === share.userId)) return prev;
      let evictedUserId: number | undefined;
      let next: ShareInfo[];
      if (prev.length >= 4) {
        // Evict oldest non-focused share; fall back to oldest if all focused
        const focusId = focusedShareRef.current?.userId;
        const evictIndex = prev.findIndex(s => s.userId !== focusId) ?? 0;
        evictedUserId = prev[evictIndex].userId;
        next = [...prev.slice(0, evictIndex), ...prev.slice(evictIndex + 1), share];
      } else {
        next = [...prev, share];
      }
      watchingSharesRef.current = next;

      // Clean up evicted share state
      if (evictedUserId != null) {
        const evicted = evictedUserId;
        setFocusedShare(p => p?.userId === evicted ? null : p);
        setRemoteVideoEls(p => {
          const m = new Map(p);
          m.delete(evicted);
          return m;
        });
      }
      return next;
    });
  }, []);

  const removeWatchingShare = useCallback((userId: number) => {
    const next = watchingSharesRef.current.filter(s => s.userId !== userId);
    watchingSharesRef.current = next;
    setWatchingShares(next);
    setFocusedShare(prev => prev?.userId === userId ? null : prev);
    setRemoteVideoEls(prev => {
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
    return next;
  }, [setFocusedShare]);

  // Helper: request a LiveKit token via bridge
  const requestToken = useCallback((roomName: string, accessMode: LiveKitAccessMode) => {
    return new Promise<{ token: string; url: string }>((resolve, reject) => {
      const requestId = ++nextTokenRequestIdRef.current;
      const cleanup = () => {
        bridge.off('livekit.token', onToken);
        bridge.off('livekit.tokenError', onError);
        clearTimeout(timer);
      };
      const onToken = (data: unknown) => {
        const responseRequestId = (data as { requestId?: number }).requestId;
        if (responseRequestId !== requestId) {
          return;
        }

        cleanup();
        resolve(data as { token: string; url: string });
      };
      const onError = (data: unknown) => {
        const responseRequestId = (data as { requestId?: number }).requestId;
        if (responseRequestId !== requestId) {
          return;
        }

        cleanup();
        reject(new Error((data as { error: string }).error));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Token request timed out'));
      }, 20000);
      bridge.on('livekit.token', onToken);
      bridge.on('livekit.tokenError', onError);
      bridge.send('livekit.requestToken', { roomName, accessMode, requestId });
    });
  }, []);

  const roomAccessModeRef = useRef<LiveKitAccessMode | null>(null);
  const roomReconnectUpgradeRef = useRef(false);
  const roomLifecycleGenerationRef = useRef(0);
  const pendingRoomRequestRef = useRef<PendingRoomRequest | null>(null);

  const invalidateRoomLifecycle = useCallback(() => {
    roomLifecycleGenerationRef.current += 1;
    pendingRoomRequestRef.current = null;
  }, []);

  // Try to disconnect the room, but only if we're not sharing AND not watching
  const maybeDisconnectRoom = useCallback(async () => {
    const room = roomRef.current;
    if (!isSharingRef.current && watchingSharesRef.current.length === 0 && room) {
      roomRef.current = null;
      roomAccessModeRef.current = null;
      roomReconnectUpgradeRef.current = false;
      invalidateRoomLifecycle();
      try { await room.disconnect(); } catch { /* ignore */ }
    }
  }, [invalidateRoomLifecycle]);

  const stopLocalShare = useCallback(async (
    reason: LocalShareStopReason,
    roomOverride?: Room | null,
  ) => {
    const wasSharing = isSharingRef.current;
    const shouldHandleErrorBeforeShareStarts = (reason === 'error' || reason === 'blocked-capture') && !localShareStopHandledRef.current;

    if (localShareStopHandledRef.current || (!wasSharing && !shouldHandleErrorBeforeShareStarts)) {
      return;
    }

    localShareStopHandledRef.current = true;
    clearLocalShareEndListener();
    localShareTeardownIntentRef.current = null;

    const room = roomOverride ?? roomRef.current;
    const roomName = room?.name;

    if (wasSharing && reason !== 'interrupted' && room) {
      try { await room.localParticipant.setScreenShareEnabled(false); } catch { /* ignore */ }
    }

    isSharingRef.current = false;
    setIsSharing(false);

    if (wasSharing && roomName) {
      bridge.send('livekit.shareStopped', { roomName });
    }

    onLocalShareEndedRef.current?.(reason);

    if (reason === 'interrupted') {
      onDisconnectedRef.current?.();
    }

    await maybeDisconnectRoom();
  }, [clearLocalShareEndListener, maybeDisconnectRoom]);

  const bindLocalShareEndListener = useCallback((room: Room) => {
    clearLocalShareEndListener();

    const publication = (room.localParticipant as {
      getTrackPublication?: (source: string) => { track?: LocalTrackLike } | undefined;
    }).getTrackPublication?.(Track.Source.ScreenShare);
    const track = publication?.track;
    if (!track) {
      return;
    }

    const onEnded = () => {
      void stopLocalShare('source-closed', room);
    };

    if (typeof track.addEventListener === 'function' && typeof track.removeEventListener === 'function') {
      track.addEventListener('ended', onEnded);
      localShareEndCleanupRef.current = () => track.removeEventListener?.('ended', onEnded);
      return;
    }

    if (typeof track.on === 'function' && typeof track.off === 'function') {
      track.on('ended', onEnded);
      localShareEndCleanupRef.current = () => track.off?.('ended', onEnded);
    }
  }, [clearLocalShareEndListener, stopLocalShare]);

  // Ensure we have a connected room for the given channel.
  // Returns the existing room if already connected to this channel, otherwise connects.
  const ensureRoom = useCallback(async (roomName: string, accessMode: LiveKitAccessMode): Promise<Room> => {
    const existing = roomRef.current;
    const currentAccessMode = roomAccessModeRef.current;
    const existingCanSatisfyRequest = currentAccessMode === 'publish' || currentAccessMode === accessMode;
    if (existing?.name === roomName && (existing as Room & { state?: string })?.state === 'connected' && existingCanSatisfyRequest) {
      return existing;
    }

    const pending = pendingRoomRequestRef.current;
    const pendingCanSatisfyRequest = pending?.accessMode === 'publish' || pending?.accessMode === accessMode;
    if (pending?.roomName === roomName && pendingCanSatisfyRequest) {
      return pending.promise;
    }

    if (pending) {
      invalidateRoomLifecycle();
      pending.reject(createSupersededRoomRequestError());
    }

    let lifecycleGeneration = roomLifecycleGenerationRef.current;
    let rejectRoomRequest!: (err: unknown) => void;

    const createRoomPromise = (async () => {
      // Disconnect from any other room
      if (existing) {
        roomReconnectUpgradeRef.current = existing.name === roomName && currentAccessMode === 'subscribe' && accessMode === 'publish';
        roomRef.current = null;
        roomAccessModeRef.current = null;
        invalidateRoomLifecycle();
        lifecycleGeneration = roomLifecycleGenerationRef.current;
        try { await existing.disconnect(); } catch { /* ignore */ }
      }

      const { token, url } = await requestToken(roomName, accessMode);
      if (roomLifecycleGenerationRef.current !== lifecycleGeneration) {
        throw new Error('LiveKit room request was superseded');
      }

      const room = new Room();

      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (roomRef.current !== room) {
          return;
        }

        const watching = watchingSharesRef.current;
        const matchedShare = watching.find(s => {
          const identity = s.matrixUserId ?? String(s.userId);
          return identity === participant.identity;
        });
        if (!matchedShare) return;
        if (
          track.kind === Track.Kind.Video &&
          track.source === Track.Source.ScreenShare
        ) {
          const el = track.attach() as HTMLVideoElement;
          setRemoteVideoEls(prev => new Map(prev).set(matchedShare.userId, el));
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        if (roomRef.current !== room) {
          return;
        }

        const watching = watchingSharesRef.current;
        const matchedShare = watching.find(s => {
          const identity = s.matrixUserId ?? String(s.userId);
          return identity === participant.identity;
        });
        if (!matchedShare) return;
        if (
          track.kind === Track.Kind.Video &&
          track.source === Track.Source.ScreenShare
        ) {
          track.detach();
          const remainingWatchedShares = removeWatchingShare(matchedShare.userId);

          if (remainingWatchedShares.length === 0 && !isSharingRef.current) {
            const room = roomRef.current;
            roomRef.current = null;
            roomAccessModeRef.current = null;
            roomReconnectUpgradeRef.current = false;
            invalidateRoomLifecycle();
            room?.disconnect().catch(() => {});
          }
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== room) {
          return;
        }

        const isUpgradeReconnect = roomReconnectUpgradeRef.current;
        if (isUpgradeReconnect) {
          roomReconnectUpgradeRef.current = false;
          return;
        }

        roomRef.current = null;
        roomAccessModeRef.current = null;
        setRemoteVideoEls(new Map());
        const teardownIntent = localShareTeardownIntentRef.current;
        localShareTeardownIntentRef.current = null;
        if (isSharingRef.current) {
          void stopLocalShare(teardownIntent ?? 'interrupted', room);
        }
        updateWatchingShares([]);
        setFocusedShare(null);
      });

      roomRef.current = room;
      roomAccessModeRef.current = accessMode;

      try {
        await room.connect(url, token);
      } catch (err) {
        if (roomRef.current === room) {
          roomRef.current = null;
          roomAccessModeRef.current = null;
          roomReconnectUpgradeRef.current = false;
          invalidateRoomLifecycle();
        }
        try { await room.disconnect(); } catch { /* ignore */ }
        throw err;
      }
      if (roomLifecycleGenerationRef.current !== lifecycleGeneration || roomRef.current !== room) {
        try { await room.disconnect(); } catch { /* ignore */ }
        throw new Error('LiveKit room request was superseded');
      }

      roomReconnectUpgradeRef.current = false;
      return room;
    })();

    const roomPromise = new Promise<Room>((resolve, reject) => {
      rejectRoomRequest = reject;
      createRoomPromise.then(resolve, reject);
    });

    pendingRoomRequestRef.current = { roomName, accessMode, generation: lifecycleGeneration, promise: roomPromise, reject: rejectRoomRequest };

    try {
      return await roomPromise;
    } finally {
      if (pendingRoomRequestRef.current?.promise === roomPromise) {
        pendingRoomRequestRef.current = null;
      }
    }
  }, [requestToken, updateWatchingShares, stopLocalShare, removeWatchingShare, invalidateRoomLifecycle]);

  const startSharing = useCallback(async (roomName: string) => {
    setError(null);
    localShareStopHandledRef.current = false;

    try {
      const room = await ensureRoom(roomName, 'publish');

      let captureOptions: Record<string, unknown> | undefined;
      if (screenShareSettings) {
        const resolutionMap: Record<string, { width: number; height: number }> = {
          '720p': { width: 1280, height: 720 },
          '1080p': { width: 1920, height: 1080 },
          '1440p': { width: 2560, height: 1440 },
          '4k': { width: 3840, height: 2160 },
        };

        const bitrateMap: Record<string, number> = {
          '720p': 2_000_000,
          '1080p': 4_000_000,
          '1440p': 8_000_000,
          '4k': 15_000_000,
        };

        captureOptions = {};

        if (screenShareSettings.captureAudio) {
          captureOptions.audio = true;
        }

        if (screenShareSettings.captureAudio && screenShareSettings.systemAudio) {
          captureOptions.systemAudio = 'include';
        }

        if (screenShareSettings.resolution || screenShareSettings.fps) {
          const res = resolutionMap[screenShareSettings.resolution];
          captureOptions.resolution = {
            ...res,
            frameRate: screenShareSettings.fps,
          };
          captureOptions.videoEncoding = {
            maxBitrate: bitrateMap[screenShareSettings.resolution],
            maxFramerate: screenShareSettings.fps,
          };
        }

        if (Object.keys(captureOptions).length === 0) {
          captureOptions = undefined;
        }
      }

      await room.localParticipant.setScreenShareEnabled(true, captureOptions);

      isSharingRef.current = true;
      setIsSharing(true);
      bindLocalShareEndListener(room);

      bridge.send('livekit.shareStarted', { roomName });
    } catch (err) {
      clearLocalShareEndListener();

      if (isSupersededRoomRequestError(err)) {
        return;
      }

      if (isScreenSharePickerCancel(err)) {
        await maybeDisconnectRoom();
        return;
      }

      if (isBlockedWindowCaptureError(err)) {
        setError('Windows could not share that app or window. Try sharing your full screen or a different window.');
        await stopLocalShare('blocked-capture', roomRef.current);
      } else {
        setError(getErrorLikeDetails(err)?.message || 'Screen share failed');
        await stopLocalShare('error', roomRef.current);
      }
      // Disconnect room if we're not watching anyone either
      await maybeDisconnectRoom();
    }
  }, [screenShareSettings, ensureRoom, bindLocalShareEndListener, clearLocalShareEndListener, maybeDisconnectRoom, stopLocalShare]);

  const stopSharing = useCallback(async () => {
    await stopLocalShare('manual');
  }, [stopLocalShare]);

  // --- Viewer logic ---

  const connectAsViewer = useCallback(async (roomName: string, targetUserId: number, matrixUserId?: string) => {
    // Toggle: if already watching this user, remove them
    const existingShare = watchingSharesRef.current.find(s => s.userId === targetUserId);
    if (existingShare) {
      // Detach track
      const room = roomRef.current;
      if (room) {
        const identity = existingShare.matrixUserId ?? String(targetUserId);
        const participant = room.remoteParticipants.get(identity);
        if (participant) {
          participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
            if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
              pub.track.detach();
            }
          });
        }
      }
      removeWatchingShare(targetUserId);
      // Disconnect room if nothing left
      if (watchingSharesRef.current.length === 0) {
        await maybeDisconnectRoom();
      }
      return;
    }

    const shareInfo = activeShares.find(s => s.userId === targetUserId && s.roomName === roomName);
    const participantIdentity = matrixUserId ?? shareInfo?.matrixUserId ?? String(targetUserId);
    const newShare: ShareInfo = { ...(shareInfo ?? { roomName, userName: '', userId: targetUserId }), matrixUserId: participantIdentity };

    try {
      const room = await ensureRoom(roomName, 'subscribe');

      // Add to watching list (handles max 4 enforcement via addWatchingShare)
      addWatchingShare(newShare);

      // Subscribe to the target's screen share track
      const participant = room.remoteParticipants.get(participantIdentity);
      if (participant) {
        participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
          if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
            const el = pub.track.attach() as HTMLVideoElement;
            setRemoteVideoEls(prev => new Map(prev).set(targetUserId, el));
          }
        });
      }
      // If track not yet available, TrackSubscribed event will pick it up
    } catch (err) {
      if (isSupersededRoomRequestError(err)) {
        return;
      }

      console.error('Failed to connect as viewer:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect as viewer');
      throw err;
    }
  }, [activeShares, ensureRoom, addWatchingShare, removeWatchingShare, maybeDisconnectRoom]);

  const disconnectViewer = useCallback(async (userId?: number) => {
    const room = roomRef.current;

    if (userId !== undefined) {
      // Remove a specific stream
      const share = watchingSharesRef.current.find(s => s.userId === userId);
      if (share && room) {
        const targetIdentity = share.matrixUserId ?? String(share.userId);
        const participant = room.remoteParticipants.get(targetIdentity);
        if (participant) {
          participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
            if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
              pub.track.detach();
            }
          });
        }
      }
      removeWatchingShare(userId);
      if (watchingSharesRef.current.length === 0) {
        await maybeDisconnectRoom();
      }
      return;
    }

    // No userId: remove all streams (channel switch / full cleanup)
    if (room) {
      for (const share of watchingSharesRef.current) {
        const targetIdentity = share.matrixUserId ?? String(share.userId);
        const participant = room.remoteParticipants.get(targetIdentity);
        if (participant) {
          participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
            if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
              pub.track.detach();
            }
          });
        }
      }
    }
    setRemoteVideoEls(new Map());
    updateWatchingShares([]);
    setFocusedShare(null);
    invalidateRoomLifecycle();
    await maybeDisconnectRoom();
  }, [removeWatchingShare, updateWatchingShares, maybeDisconnectRoom, invalidateRoomLifecycle]);

  // Listen for screen share events from bridge
  useEffect(() => {
    const onShareStarted = (data: unknown) => {
      const d = data as { roomName: string; userName: string; userId: number; matrixUserId?: string; sessionId?: number };
      shareEventVersionRef.current += 1;
      shareEventVersionByRoomRef.current.set(d.roomName, (shareEventVersionByRoomRef.current.get(d.roomName) ?? 0) + 1);
      setActiveShares(prev => {
        if (prev.some(s => s.userId === d.userId && s.roomName === d.roomName)) return prev;
        return [...prev, { roomName: d.roomName, userName: d.userName, userId: d.userId, matrixUserId: d.matrixUserId, sessionId: d.sessionId }];
      });
    };

    const onShareStopped = (data: unknown) => {
      const d = data as { roomName: string; userId: number };
      shareEventVersionRef.current += 1;
      shareEventVersionByRoomRef.current.set(d.roomName, (shareEventVersionByRoomRef.current.get(d.roomName) ?? 0) + 1);
      setActiveShares(prev => prev.filter(s => !(s.roomName === d.roomName && s.userId === d.userId)));

      // If we were watching this user, remove their tile
      const wasWatching = watchingSharesRef.current.some(s => s.roomName === d.roomName && s.userId === d.userId);
      if (wasWatching) {
        const room = roomRef.current;
        if (room) {
          const share = watchingSharesRef.current.find(s => s.userId === d.userId);
          if (share) {
            const targetIdentity = share.matrixUserId ?? String(share.userId);
            const participant = room.remoteParticipants.get(targetIdentity);
            if (participant) {
              participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
                if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
                  pub.track.detach();
                }
              });
            }
          }
        }
        removeWatchingShare(d.userId);
        // Disconnect room if nothing left and not sharing
        if (watchingSharesRef.current.length === 0 && !isSharingRef.current && room) {
          room.disconnect().catch(() => {});
          roomRef.current = null;
          roomAccessModeRef.current = null;
          roomReconnectUpgradeRef.current = false;
          invalidateRoomLifecycle();
        }
      }
    };

    const onActiveShareResult = (data: unknown) => {
      const d = data as {
        roomName?: string;
        scope?: string;
        requestId?: number;
        shares: Array<{ roomName?: string; userId: number; userName: string; matrixUserId?: string; sessionId?: number }>;
      };
      const nextRoomShares = (d.shares ?? []).map(s => ({
        roomName: s.roomName ?? d.roomName ?? '',
        userName: s.userName,
        userId: s.userId,
        matrixUserId: s.matrixUserId,
        sessionId: s.sessionId,
      })).filter(s => s.roomName);
      const target = discoveryTargetRef.current;

      if (!target) {
        return;
      }

      if (target.requestId != null && d.requestId !== target.requestId) {
        return;
      }

      if (d.scope === 'all') {
        if (!('scope' in target)) {
          return;
        }

        if (target.baselineShareEventVersion !== shareEventVersionRef.current) {
          return;
        }

        setActiveShares(nextRoomShares);
        return;
      }

      if (!d.roomName) {
        return;
      }

      if ('scope' in target || target.roomName !== d.roomName) {
        return;
      }

      if (target.baselineShareEventVersion !== (shareEventVersionByRoomRef.current.get(d.roomName) ?? 0)) {
        return;
      }

      const nextScopedRoomShares = nextRoomShares.filter(s => s.roomName === d.roomName);

      setActiveShares(prev => [
        ...prev.filter(s => s.roomName !== d.roomName),
        ...nextScopedRoomShares,
      ]);
    };

    const onActiveShareError = (data: unknown) => {
      const d = data as { roomName?: string; reason?: string; statusCode?: number; message?: string };
      console.warn('[LiveKit] activeShare discovery failed', d);
    };

    bridge.on('livekit.screenShareStarted', onShareStarted);
    bridge.on('livekit.screenShareStopped', onShareStopped);
    bridge.on('livekit.activeShareResult', onActiveShareResult);
    bridge.on('livekit.activeShareError', onActiveShareError);

    return () => {
      bridge.off('livekit.screenShareStarted', onShareStarted);
      bridge.off('livekit.screenShareStopped', onShareStopped);
      bridge.off('livekit.activeShareResult', onActiveShareResult);
      bridge.off('livekit.activeShareError', onActiveShareError);
    };
  }, [removeWatchingShare, invalidateRoomLifecycle]);

  useEffect(() => {
    return () => {
      clearLocalShareEndListener();
    };
  }, [clearLocalShareEndListener]);

  // Backward compat: expose first active share as activeShare
  const activeShare: ActiveShare | null = activeShares.length > 0
    ? { roomName: activeShares[0].roomName, userName: activeShares[0].userName, sessionId: activeShares[0].sessionId }
    : null;

  // Backward compat
  const watchingShare = watchingShares.length > 0 ? watchingShares[0] : null;
  const remoteVideoEl = remoteVideoEls.size > 0 ? remoteVideoEls.values().next().value ?? null : null;

  return {
    isSharing,
    startSharing,
    stopSharing,
    markLocalShareTeardownIntent,
    error,
    activeShare,       // backward compat
    activeShares,      // new: all active shares
    watchingShare,     // backward compat
    watchingShares,    // new
    focusedShare,      // new
    setFocusedShare,   // new
    setDiscoveryTarget,
    remoteVideoEl,     // backward compat
    remoteVideoEls,    // new
    addWatchingShare,      // new
    removeWatchingShare,   // new
    disconnectViewer,
    connectAsViewer,
  };
}
