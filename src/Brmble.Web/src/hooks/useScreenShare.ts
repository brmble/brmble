import { useCallback, useRef, useState, useEffect, type SetStateAction } from 'react';
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

export type LocalShareStopReason = 'manual' | 'source-closed' | 'interrupted' | 'error' | 'blocked-capture' | 'moved-channel';
export type WatchedShareEndReason = 'ended' | 'unexpected';
export type WatchedShareEndedCallback = (share: ShareInfo, reason: WatchedShareEndReason) => void;

type LocalTrackLike = {
  addEventListener?: (event: string, handler: () => void) => void;
  removeEventListener?: (event: string, handler: () => void) => void;
  on?: (event: string, handler: () => void) => void;
  off?: (event: string, handler: () => void) => void;
};

type LiveKitAccessMode = 'publish' | 'subscribe';
type LiveKitTokenResponse = { token: string; url: string; expiresAt?: string };

type DiscoveryTarget = (({ scope: 'all' } | { roomName: string }) & { requestId?: number; baselineShareEventVersion?: number }) | null;

type PendingRoomRequest = {
  roomName: string;
  accessMode: LiveKitAccessMode;
  promise: Promise<Room>;
  reject: (err: unknown) => void;
};

type PendingTokenRequest = {
  cancel: () => void;
};

type ActiveTokenLease = {
  roomName: string;
  accessMode: LiveKitAccessMode;
  token: string;
  url: string;
  expiresAt: string;
  isRefreshed: boolean;
  generation: number;
};

type PendingViewerAttempt = {
  id: number;
  roomName: string;
  userId: number;
  cancel: () => void;
  promise: Promise<never>;
};

type SupersededRoomRequest = Error & { code: 'LIVEKIT_ROOM_REQUEST_SUPERSEDED' };

const TOKEN_REFRESH_SAFETY_WINDOW_MS = 2 * 60 * 1000;
const MIN_TOKEN_REFRESH_DELAY_MS = 5 * 1000;

const watchedShareKey = (roomName: string, userId: number) => `${roomName}:${userId}`;

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
);

export function useScreenShare(
  onDisconnected?: () => void,
  screenShareSettings?: ScreenShareSettings,
  onLocalShareEnded?: (reason: LocalShareStopReason) => void,
  onWatchedShareEnded?: WatchedShareEndedCallback,
) {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeShares, setActiveShares] = useState<ShareInfo[]>([]);
  const [watchingShares, setWatchingShares] = useState<ShareInfo[]>([]);
  const [isViewerConnectPending, setIsViewerConnectPending] = useState(false);
  const [focusedShare, _setFocusedShare] = useState<ShareInfo | null>(null);
  const [remoteVideoEls, setRemoteVideoEls] = useState<Map<number, HTMLVideoElement>>(new Map());

  // Single room connection per channel — used for both publishing and subscribing
  const roomRef = useRef<Room | null>(null);
  const watchingSharesRef = useRef<ShareInfo[]>([]);
  const activeSharesRef = useRef<ShareInfo[]>([]);
  const isSharingRef = useRef(false);
  const isStartingShareRef = useRef(false);
  const focusedShareRef = useRef<ShareInfo | null>(null);
  const discoveryTargetRef = useRef<DiscoveryTarget>(null);
  const shareEventVersionRef = useRef(0);
  const shareEventVersionByRoomRef = useRef(new Map<string, number>());
  const nextTokenRequestIdRef = useRef(0);
  const pendingTokenRequestRef = useRef<PendingTokenRequest | null>(null);
  const activeTokenLeaseRef = useRef<ActiveTokenLease | null>(null);
  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDisconnectedRef = useRef(onDisconnected);
  const onLocalShareEndedRef = useRef(onLocalShareEnded);
  const onWatchedShareEndedRef = useRef<WatchedShareEndedCallback | undefined>(onWatchedShareEnded);
  const localShareEndCleanupRef = useRef<(() => void) | null>(null);
  const localShareStopHandledRef = useRef(false);
  const localShareTeardownIntentRef = useRef<LocalShareStopReason | null>(null);
  const viewerConnectPendingCountRef = useRef(0);
  const pendingViewerAttemptIdRef = useRef(0);
  const pendingViewerAttemptsRef = useRef(new Map<number, PendingViewerAttempt>());
  const endedWatchedShareKeysRef = useRef(new Set<string>());
  const pendingUnsubscribedWatchedSharesRef = useRef(new Map<string, ShareInfo>());
  onDisconnectedRef.current = onDisconnected;
  onLocalShareEndedRef.current = onLocalShareEnded;
  onWatchedShareEndedRef.current = onWatchedShareEnded;

  const clearLocalShareEndListener = useCallback(() => {
    localShareEndCleanupRef.current?.();
    localShareEndCleanupRef.current = null;
  }, []);

  const beginViewerConnectAttempt = useCallback(() => {
    viewerConnectPendingCountRef.current += 1;
    setIsViewerConnectPending(true);
  }, []);

  const endViewerConnectAttempt = useCallback(() => {
    viewerConnectPendingCountRef.current = Math.max(0, viewerConnectPendingCountRef.current - 1);
    setIsViewerConnectPending(viewerConnectPendingCountRef.current > 0);
  }, []);

  const registerPendingViewerAttempt = useCallback((roomName: string, userId: number) => {
    const id = ++pendingViewerAttemptIdRef.current;
    let cancel!: () => void;
    const promise = new Promise<never>((_, reject) => {
      cancel = () => reject(createSupersededRoomRequestError());
    });
    const attempt: PendingViewerAttempt = { id, roomName, userId, cancel, promise };
    pendingViewerAttemptsRef.current.set(id, attempt);
    return attempt;
  }, []);

  const unregisterPendingViewerAttempt = useCallback((attempt: PendingViewerAttempt) => {
    pendingViewerAttemptsRef.current.delete(attempt.id);
  }, []);

  const setFocusedShare: typeof _setFocusedShare = useCallback((action) => {
    _setFocusedShare(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      focusedShareRef.current = next;
      return next;
    });
  }, []);

  const updateActiveShares = useCallback((action: SetStateAction<ShareInfo[]>) => {
    setActiveShares(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      activeSharesRef.current = next;
      return next;
    });
  }, []);

  const updateWatchingShares = useCallback((shares: ShareInfo[]) => {
    watchingSharesRef.current = shares;
    setWatchingShares(shares);
  }, []);

  const clearTokenRefreshTimer = useCallback(() => {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current);
      tokenRefreshTimerRef.current = null;
    }
  }, []);

  const clearTokenLease = useCallback(() => {
    clearTokenRefreshTimer();
    activeTokenLeaseRef.current = null;
  }, [clearTokenRefreshTimer]);

  const markLocalShareTeardownIntent = useCallback((reason: LocalShareStopReason) => {
    localShareTeardownIntentRef.current = reason;
  }, []);

  const setDiscoveryTarget = useCallback((target: DiscoveryTarget) => {
    if (!target) {
      discoveryTargetRef.current = null;
      updateActiveShares([]);
      return;
    }

    const baselineShareEventVersion = 'scope' in target
      ? shareEventVersionRef.current
      : shareEventVersionByRoomRef.current.get(target.roomName) ?? 0;
    discoveryTargetRef.current = { ...target, baselineShareEventVersion };
  }, [updateActiveShares]);

  const addWatchingShare = useCallback((share: ShareInfo) => {
    endedWatchedShareKeysRef.current.delete(watchedShareKey(share.roomName, share.userId));
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

  const removeWatchingShare = useCallback((userId: number, options?: { clearPending?: boolean }) => {
    const removedShares = watchingSharesRef.current.filter(s => s.userId === userId);
    if (options?.clearPending !== false) {
      for (const share of removedShares) {
        pendingUnsubscribedWatchedSharesRef.current.delete(watchedShareKey(share.roomName, share.userId));
      }
    }
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

  const clearWatchingState = useCallback(() => {
    setRemoteVideoEls(new Map());
    updateWatchingShares([]);
    setFocusedShare(null);
  }, [setFocusedShare, updateWatchingShares]);

  const endWatchedShare = useCallback((share: ShareInfo, reason: WatchedShareEndReason) => {
    const key = watchedShareKey(share.roomName, share.userId);
    if (!endedWatchedShareKeysRef.current.has(key)) {
      endedWatchedShareKeysRef.current.add(key);
      onWatchedShareEndedRef.current?.(share, reason);
    }
    pendingUnsubscribedWatchedSharesRef.current.delete(key);
    return removeWatchingShare(share.userId);
  }, [removeWatchingShare]);

  const clearPendingUnsubscribedWatchedShare = useCallback((userId: number) => {
    for (const [key, share] of pendingUnsubscribedWatchedSharesRef.current) {
      if (share.userId === userId) {
        pendingUnsubscribedWatchedSharesRef.current.delete(key);
      }
    }
  }, []);

  const notifyUnexpectedWatchedShareEnds = useCallback(() => {
    for (const share of [...watchingSharesRef.current]) {
      endWatchedShare(share, 'unexpected');
    }
    for (const share of [...pendingUnsubscribedWatchedSharesRef.current.values()]) {
      endWatchedShare(share, 'unexpected');
    }
  }, [endWatchedShare]);

  // Helper: request a LiveKit token via bridge
  const requestToken = useCallback((roomName: string, accessMode: LiveKitAccessMode) => {
    return new Promise<LiveKitTokenResponse>((resolve, reject) => {
      const requestId = ++nextTokenRequestIdRef.current;
      let settled = false;
      const cancel = () => {
        settle(() => reject(createSupersededRoomRequestError()));
      };
      const cleanup = () => {
        if (pendingTokenRequestRef.current?.cancel === cancel) {
          pendingTokenRequestRef.current = null;
        }
        bridge.off('livekit.token', onToken);
        bridge.off('livekit.tokenError', onError);
        clearTimeout(timer);
      };
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };
      const onToken = (data: unknown) => {
        const responseRequestId = (data as { requestId?: number }).requestId;
        if (responseRequestId !== requestId) {
          return;
        }

        settle(() => resolve(data as LiveKitTokenResponse));
      };
      const onError = (data: unknown) => {
        const responseRequestId = (data as { requestId?: number }).requestId;
        if (responseRequestId !== requestId) {
          return;
        }

        settle(() => reject(new Error((data as { error: string }).error)));
      };
      const timer = setTimeout(() => {
        settle(() => reject(new Error('Token request timed out')));
      }, 20000);
      pendingTokenRequestRef.current = { cancel };
      bridge.on('livekit.token', onToken);
      bridge.on('livekit.tokenError', onError);
      bridge.send('livekit.requestToken', { roomName, accessMode, requestId });
    });
  }, []);

  const roomAccessModeRef = useRef<LiveKitAccessMode | null>(null);
  const roomReconnectUpgradeRef = useRef(false);
  const roomLifecycleGenerationRef = useRef(0);
  const shareStartCancelGenerationRef = useRef(0);
  const pendingRoomRequestRef = useRef<PendingRoomRequest | null>(null);

  const cancelPendingRoomRequest = useCallback(() => {
    pendingTokenRequestRef.current?.cancel();
    pendingTokenRequestRef.current = null;
    const pending = pendingRoomRequestRef.current;
    pendingRoomRequestRef.current = null;
    pending?.reject(createSupersededRoomRequestError());
  }, []);

  const invalidateRoomLifecycle = useCallback(() => {
    roomLifecycleGenerationRef.current += 1;
    cancelPendingRoomRequest();
  }, [cancelPendingRoomRequest]);

  const maybeCancelPendingRoomForViewerRoom = useCallback((roomName: string) => {
    const hasRemainingPendingViewersForRoom = Array.from(pendingViewerAttemptsRef.current.values()).some(attempt => attempt.roomName === roomName);
    if (pendingRoomRequestRef.current?.roomName === roomName && !hasRemainingPendingViewersForRoom && watchingSharesRef.current.length === 0 && !isSharingRef.current) {
      invalidateRoomLifecycle();
    }
  }, [invalidateRoomLifecycle]);

  const cancelPendingViewerAttempts = useCallback((predicate?: (attempt: PendingViewerAttempt) => boolean) => {
    const canceledRooms = new Set<string>();
    for (const attempt of pendingViewerAttemptsRef.current.values()) {
      if (!predicate || predicate(attempt)) {
        pendingViewerAttemptsRef.current.delete(attempt.id);
        canceledRooms.add(attempt.roomName);
        attempt.cancel();
      }
    }
    for (const roomName of canceledRooms) {
      maybeCancelPendingRoomForViewerRoom(roomName);
    }
  }, [maybeCancelPendingRoomForViewerRoom]);

  // Try to disconnect the room, but only if we're not sharing AND not watching
  const maybeDisconnectRoom = useCallback(async () => {
    const room = roomRef.current;
    if (!isSharingRef.current && watchingSharesRef.current.length === 0 && room) {
      roomRef.current = null;
      roomAccessModeRef.current = null;
      roomReconnectUpgradeRef.current = false;
      clearTokenLease();
      invalidateRoomLifecycle();
      try { await room.disconnect(); } catch { /* ignore */ }
    }
  }, [clearTokenLease, invalidateRoomLifecycle]);

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

  const scheduleTokenRefresh = useCallback((lease: ActiveTokenLease) => {
    clearTokenRefreshTimer();

    const expiresAtMs = Date.parse(lease.expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      return;
    }

    const delayMs = Math.max(MIN_TOKEN_REFRESH_DELAY_MS, expiresAtMs - Date.now() - TOKEN_REFRESH_SAFETY_WINDOW_MS);
    tokenRefreshTimerRef.current = setTimeout(() => {
      void (async () => {
        const currentLease = activeTokenLeaseRef.current;
        if (!currentLease || currentLease.generation !== lease.generation) {
          return;
        }

        try {
          const refreshed = await requestToken(currentLease.roomName, currentLease.accessMode);
          if (!refreshed.expiresAt || activeTokenLeaseRef.current?.generation !== currentLease.generation) {
            return;
          }

          const nextLease = { ...currentLease, token: refreshed.token, url: refreshed.url, expiresAt: refreshed.expiresAt, isRefreshed: true };
          activeTokenLeaseRef.current = nextLease;
          scheduleTokenRefresh(nextLease);
        } catch {
          if (activeTokenLeaseRef.current?.generation !== currentLease.generation) {
            return;
          }

          setError('LiveKit access could not be renewed');
          const room = roomRef.current;
          roomRef.current = null;
          roomAccessModeRef.current = null;
          roomReconnectUpgradeRef.current = false;
          clearTokenLease();
          invalidateRoomLifecycle();
          cancelPendingViewerAttempts();
          notifyUnexpectedWatchedShareEnds();
          clearWatchingState();
          if (isSharingRef.current) {
            await stopLocalShare('interrupted', room);
          }
          try { await room?.disconnect(); } catch { /* ignore */ }
        }
      })();
    }, delayMs);
  }, [cancelPendingViewerAttempts, clearTokenLease, clearTokenRefreshTimer, clearWatchingState, invalidateRoomLifecycle, notifyUnexpectedWatchedShareEnds, requestToken, stopLocalShare]);

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

  const bindRoomEvents = useCallback((room: Room) => {
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
        pendingUnsubscribedWatchedSharesRef.current.set(watchedShareKey(matchedShare.roomName, matchedShare.userId), matchedShare);
        removeWatchingShare(matchedShare.userId, { clearPending: false });
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
      clearTokenLease();
      invalidateRoomLifecycle();
      notifyUnexpectedWatchedShareEnds();
      clearWatchingState();
      const teardownIntent = localShareTeardownIntentRef.current;
      localShareTeardownIntentRef.current = null;
      if (isSharingRef.current) {
        void stopLocalShare(teardownIntent ?? 'interrupted', room);
      }
    });
  }, [clearTokenLease, clearWatchingState, invalidateRoomLifecycle, notifyUnexpectedWatchedShareEnds, removeWatchingShare, stopLocalShare]);

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
    }

    let lifecycleGeneration = roomLifecycleGenerationRef.current;
    let isUpgradeReconnect = false;
    let rejectRoomRequest!: (err: unknown) => void;

    const createRoomPromise = (async () => {
      // Disconnect from any other room
      if (existing) {
        isUpgradeReconnect = existing.name === roomName && currentAccessMode === 'subscribe' && accessMode === 'publish';
        roomReconnectUpgradeRef.current = isUpgradeReconnect;
        roomRef.current = null;
        roomAccessModeRef.current = null;
        clearTokenLease();
        invalidateRoomLifecycle();
        lifecycleGeneration = roomLifecycleGenerationRef.current;
        try { await existing.disconnect(); } catch { /* ignore */ }
      }

      const tokenResponse = await requestToken(roomName, accessMode);
      const { token, url } = tokenResponse;
      if (roomLifecycleGenerationRef.current !== lifecycleGeneration) {
        throw createSupersededRoomRequestError();
      }

      const room = new Room();
      bindRoomEvents(room);

      roomRef.current = room;
      roomAccessModeRef.current = accessMode;

      try {
        await room.connect(url, token);
      } catch (err) {
        if (roomRef.current === room) {
          roomRef.current = null;
          roomAccessModeRef.current = null;
          roomReconnectUpgradeRef.current = false;
          clearTokenLease();
          roomLifecycleGenerationRef.current += 1;
        }
        try { await room.disconnect(); } catch { /* ignore */ }
        throw err;
      }
      if (roomLifecycleGenerationRef.current !== lifecycleGeneration || roomRef.current !== room) {
        try { await room.disconnect(); } catch { /* ignore */ }
        throw createSupersededRoomRequestError();
      }

      if (tokenResponse.expiresAt) {
        const lease = {
          roomName,
          accessMode,
          token,
          url,
          expiresAt: tokenResponse.expiresAt,
          isRefreshed: false,
          generation: roomLifecycleGenerationRef.current,
        };
        activeTokenLeaseRef.current = lease;
        scheduleTokenRefresh(lease);
      } else {
        clearTokenLease();
      }

      roomReconnectUpgradeRef.current = false;
      return room;
    })();

    const roomPromise = new Promise<Room>((resolve, reject) => {
      rejectRoomRequest = reject;
      createRoomPromise.then(resolve, reject);
    });
    roomPromise.catch(() => {});

    pendingRoomRequestRef.current = { roomName, accessMode, promise: roomPromise, reject: rejectRoomRequest };

    try {
      return await roomPromise;
    } finally {
      if (isUpgradeReconnect) {
        roomReconnectUpgradeRef.current = false;
        if (roomRef.current === null && !isSharingRef.current) {
          clearWatchingState();
        }
      }
      if (pendingRoomRequestRef.current?.promise === roomPromise) {
        pendingRoomRequestRef.current = null;
      }
    }
  }, [requestToken, clearWatchingState, invalidateRoomLifecycle, clearTokenLease, scheduleTokenRefresh, bindRoomEvents]);

  const startSharing = useCallback(async (roomName: string): Promise<boolean> => {
    if (isStartingShareRef.current) {
      return false;
    }

    isStartingShareRef.current = true;
    setError(null);
    localShareStopHandledRef.current = false;
    const shareStartCancelGeneration = shareStartCancelGenerationRef.current;

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

      if (shareStartCancelGenerationRef.current !== shareStartCancelGeneration || roomRef.current !== room) {
        try { await room.localParticipant.setScreenShareEnabled(false); } catch { /* ignore */ }
        try { await maybeDisconnectRoom(); } catch { /* ignore */ }
        return false;
      }

      isSharingRef.current = true;
      setIsSharing(true);
      bindLocalShareEndListener(room);

      bridge.send('livekit.shareStarted', { roomName });
      return true;
    } catch (err) {
      clearLocalShareEndListener();

      if (isSupersededRoomRequestError(err)) {
        return false;
      }

      if (isScreenSharePickerCancel(err)) {
        await maybeDisconnectRoom();
        return false;
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
      return false;
    } finally {
      isStartingShareRef.current = false;
    }
  }, [screenShareSettings, ensureRoom, bindLocalShareEndListener, clearLocalShareEndListener, maybeDisconnectRoom, stopLocalShare]);

  const stopSharing = useCallback(async () => {
    if (isStartingShareRef.current) {
      shareStartCancelGenerationRef.current += 1;
      invalidateRoomLifecycle();
    }
    await stopLocalShare('manual');
  }, [invalidateRoomLifecycle, stopLocalShare]);

  // --- Viewer logic ---

  const connectAsViewer = useCallback(async (roomName: string, targetUserId: number, matrixUserId?: string) => {
    // Toggle: if already watching this user, remove them
    const existingShare = watchingSharesRef.current.find(s => s.userId === targetUserId);
    if (existingShare) {
      setError(null);
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

    beginViewerConnectAttempt();
    const pendingAttempt = registerPendingViewerAttempt(roomName, targetUserId);
    setError(null);

    try {
      const shareInfo = activeShares.find(s => s.userId === targetUserId && s.roomName === roomName);
      const participantIdentity = matrixUserId ?? shareInfo?.matrixUserId ?? String(targetUserId);
      const newShare: ShareInfo = { ...(shareInfo ?? { roomName, userName: '', userId: targetUserId }), matrixUserId: participantIdentity };

      const room = await Promise.race([
        ensureRoom(roomName, 'subscribe'),
        pendingAttempt.promise,
      ]);

      if (!pendingViewerAttemptsRef.current.has(pendingAttempt.id)) {
        return;
      }
      const isShareStillActive = activeSharesRef.current.some(s => s.roomName === roomName && s.userId === targetUserId);
      if (!isShareStillActive) {
        await maybeDisconnectRoom();
        return;
      }

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
    } finally {
      unregisterPendingViewerAttempt(pendingAttempt);
      endViewerConnectAttempt();
    }
  }, [activeShares, ensureRoom, addWatchingShare, removeWatchingShare, maybeDisconnectRoom, beginViewerConnectAttempt, endViewerConnectAttempt, registerPendingViewerAttempt, unregisterPendingViewerAttempt]);

  const disconnectViewer = useCallback(async (userId?: number) => {
    const room = roomRef.current;

    if (userId !== undefined) {
      cancelPendingViewerAttempts(attempt => attempt.userId === userId);
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
      clearPendingUnsubscribedWatchedShare(userId);
      if (watchingSharesRef.current.length === 0) {
        await maybeDisconnectRoom();
      }
      return;
    }

    // No userId: remove all streams (channel switch / full cleanup)
    cancelPendingViewerAttempts();
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
    pendingUnsubscribedWatchedSharesRef.current.clear();
    setFocusedShare(null);
    clearTokenLease();
    invalidateRoomLifecycle();
    await maybeDisconnectRoom();
  }, [removeWatchingShare, updateWatchingShares, maybeDisconnectRoom, invalidateRoomLifecycle, cancelPendingViewerAttempts, clearTokenLease, clearPendingUnsubscribedWatchedShare]);

  // Listen for screen share events from bridge
  useEffect(() => {
    const onShareStarted = (data: unknown) => {
      const d = data as { roomName: string; userName: string; userId: number; matrixUserId?: string; sessionId?: number };
      shareEventVersionRef.current += 1;
      shareEventVersionByRoomRef.current.set(d.roomName, (shareEventVersionByRoomRef.current.get(d.roomName) ?? 0) + 1);
      updateActiveShares(prev => {
        if (prev.some(s => s.userId === d.userId && s.roomName === d.roomName)) return prev;
        return [...prev, { roomName: d.roomName, userName: d.userName, userId: d.userId, matrixUserId: d.matrixUserId, sessionId: d.sessionId }];
      });
    };

    const onShareStopped = (data: unknown) => {
      const d = data as { roomName: string; userId: number };
      shareEventVersionRef.current += 1;
      shareEventVersionByRoomRef.current.set(d.roomName, (shareEventVersionByRoomRef.current.get(d.roomName) ?? 0) + 1);
      updateActiveShares(prev => prev.filter(s => !(s.roomName === d.roomName && s.userId === d.userId)));

      // If we were watching this user, remove their tile
      const pendingUnsubscribedShare = pendingUnsubscribedWatchedSharesRef.current.get(watchedShareKey(d.roomName, d.userId));
      const wasWatching = watchingSharesRef.current.some(s => s.roomName === d.roomName && s.userId === d.userId) || !!pendingUnsubscribedShare;
      cancelPendingViewerAttempts(attempt => attempt.roomName === d.roomName && attempt.userId === d.userId);
      if (wasWatching) {
        const stoppedShare = watchingSharesRef.current.find(s => s.roomName === d.roomName && s.userId === d.userId)
          ?? pendingUnsubscribedShare
          ?? activeSharesRef.current.find(s => s.roomName === d.roomName && s.userId === d.userId);
        const room = roomRef.current;
        if (room && stoppedShare) {
          const targetIdentity = stoppedShare.matrixUserId ?? String(stoppedShare.userId);
          const participant = room.remoteParticipants.get(targetIdentity);
          if (participant) {
            participant.trackPublications.forEach((pub: RemoteTrackPublication) => {
              if (pub.track && pub.track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
                pub.track.detach();
              }
            });
          }
        }
        if (stoppedShare) {
          endWatchedShare(stoppedShare, 'ended');
        }
        // Disconnect room if nothing left and not sharing
        if (watchingSharesRef.current.length === 0 && !isSharingRef.current && room) {
          room.disconnect().catch(() => {});
          roomRef.current = null;
          roomAccessModeRef.current = null;
          roomReconnectUpgradeRef.current = false;
          clearTokenLease();
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

        updateActiveShares(nextRoomShares);
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

      updateActiveShares(prev => [
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
  }, [endWatchedShare, removeWatchingShare, updateActiveShares, invalidateRoomLifecycle, cancelPendingViewerAttempts, clearTokenLease]);

  useEffect(() => {
    return () => {
      clearLocalShareEndListener();
      cancelPendingViewerAttempts();
      clearTokenLease();
      invalidateRoomLifecycle();
    };
  }, [clearLocalShareEndListener, cancelPendingViewerAttempts, clearTokenLease, invalidateRoomLifecycle]);

  // Backward compat: expose first active share as activeShare
  const activeShare: ActiveShare | null = activeShares.length > 0
    ? { roomName: activeShares[0].roomName, userName: activeShares[0].userName, sessionId: activeShares[0].sessionId }
    : null;

  // Backward compat
  const watchingShare = watchingShares.length > 0 ? watchingShares[0] : null;
  const remoteVideoEl = remoteVideoEls.size > 0 ? remoteVideoEls.values().next().value ?? null : null;

  const handleScreenShareServiceUnavailable = useCallback(async () => {
    cancelPendingViewerAttempts();
    const room = roomRef.current;
    roomRef.current = null;
    roomAccessModeRef.current = null;
    roomReconnectUpgradeRef.current = false;
    clearTokenLease();
    invalidateRoomLifecycle();
    setDiscoveryTarget(null);
    notifyUnexpectedWatchedShareEnds();
    clearWatchingState();
    if (isSharingRef.current) {
      await stopLocalShare('interrupted', room);
    }
    try { await room?.disconnect(); } catch { /* ignore */ }
  }, [cancelPendingViewerAttempts, clearTokenLease, clearWatchingState, invalidateRoomLifecycle, notifyUnexpectedWatchedShareEnds, setDiscoveryTarget, stopLocalShare]);

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
    isViewerConnectPending,
    focusedShare,      // new
    setFocusedShare,   // new
    setDiscoveryTarget,
    remoteVideoEl,     // backward compat
    remoteVideoEls,    // new
    addWatchingShare,      // new
    removeWatchingShare,   // new
    disconnectViewer,
    connectAsViewer,
    handleScreenShareServiceUnavailable,
  };
}
